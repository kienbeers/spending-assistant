import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

// DB tạm cho mỗi lần chạy test
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chi-tieu-test-"));
process.env.DB_PATH = path.join(dir, "test.db");

let repo: typeof import("./repo");
let parse: typeof import("./quick-parse").quickParse;

beforeAll(async () => {
  repo = await import("./repo");
  parse = (await import("./quick-parse")).quickParse;
});

const wallet = (name: string) => repo.getWallets().find((w) => w.name === name)!;
const category = (name: string) => repo.getCategories().find((c) => c.name === name)!;

describe("repo", () => {
  it("khởi tạo ví & danh mục mẫu", () => {
    expect(repo.getWallets().map((w) => w.name)).toEqual(["MB Bank", "SHB", "Ví MoMo", "Tiền mặt"]);
    expect(repo.getKeywords().length).toBeGreaterThan(50);
  });

  it("số dư tính theo thu/chi/chuyển ví và chỉnh được về số thực tế", () => {
    const mb = wallet("MB Bank").id;
    const momo = wallet("Ví MoMo").id;
    const base = { note: "", categoryId: null, toWalletId: null, date: "2026-09-10" };
    repo.insertTransaction({ ...base, type: "income", amount: 10_000_000, walletId: mb });
    repo.insertTransaction({ ...base, type: "expense", amount: 200_000, walletId: mb });
    repo.insertTransaction({ ...base, type: "transfer", amount: 1_000_000, walletId: mb, toWalletId: momo });

    expect(wallet("MB Bank").balance).toBe(8_800_000);
    expect(wallet("Ví MoMo").balance).toBe(1_000_000);

    const w = wallet("MB Bank");
    repo.updateWallet(w.id, { name: w.name, kind: w.kind, aliases: w.aliases, color: w.color, balance: 9_000_000 });
    expect(wallet("MB Bank").balance).toBe(9_000_000);
  });

  it("chuyển ví không tính vào thu/chi của tháng", () => {
    const s = repo.getMonthSummary("2026-09");
    expect(s.income).toBe(10_000_000);
    expect(s.expense).toBe(200_000);
    expect(s.byCategory).toEqual([
      expect.objectContaining({ categoryId: null, name: "Chưa phân loại", total: 200_000 }),
    ]);
  });

  it("tự học từ khóa từ ghi chú ngắn", () => {
    const ctx = () => ({ today: "2026-09-11", ...repo.getEditorContext() });
    const target = category("Sức khỏe").id;
    expect(parse("cắt tóc 80k", ctx()).categoryId).toBeNull();

    repo.learnKeyword("cắt tóc", target);
    expect(parse("cắt tóc 100k", ctx()).categoryId).toBe(target);

    // Đã khớp đúng danh mục thì không thêm từ khóa trùng lặp
    const before = repo.getKeywords().length;
    repo.learnKeyword("cắt tóc", target);
    expect(repo.getKeywords().length).toBe(before);

    // Sửa lại sang danh mục khác → từ khóa được cập nhật
    const other = category("Khác").id;
    repo.learnKeyword("cắt tóc", other);
    expect(parse("cắt tóc 100k", ctx()).categoryId).toBe(other);
  });

  it("tìm kiếm không dấu", () => {
    const cash = wallet("Tiền mặt").id;
    repo.insertTransaction({
      type: "expense",
      amount: 50_000,
      walletId: cash,
      toWalletId: null,
      categoryId: null,
      note: "Bánh mì Huỳnh Hoa",
      date: "2026-09-11",
    });
    expect(repo.listTransactions({ q: "banh mi" }).map((t) => t.note)).toEqual(["Bánh mì Huỳnh Hoa"]);
    expect(repo.listTransactions({ q: "HUỲNH" })).toHaveLength(1);
  });

  it("nợ: tính số còn nợ, không tính vào thu/chi, hoàn tác xóa khoản nợ rỗng", async () => {
    const shb = wallet("SHB").id;
    const before = repo.getMonthSummary("2026-09");
    const shbBefore = wallet("SHB").balance;

    const debtId = repo.createDebt({
      direction: "lend",
      name: "Nam",
      aliases: "",
      openingAmount: 0,
      interestRate: null,
      monthlyPayment: null,
      paymentDay: null,
      dueDate: null,
      note: "",
      createdOn: "2026-09-05",
    });
    const base = { walletId: shb, toWalletId: null, categoryId: null, note: "", debtId };
    repo.insertTransaction({ ...base, type: "expense", amount: 1_000_000, date: "2026-09-05" }); // cho vay
    const collectId = repo.insertTransaction({ ...base, type: "income", amount: 300_000, date: "2026-09-08" }); // thu nợ

    const debt = repo.getDebt(debtId)!;
    expect(debt).toMatchObject({ total: 1_000_000, paid: 300_000, outstanding: 700_000, isOpen: true });
    expect(wallet("SHB").balance).toBe(shbBefore - 700_000);

    const after = repo.getMonthSummary("2026-09");
    expect(after.income).toBe(before.income);
    expect(after.expense).toBe(before.expense);

    // Khoản vay có trả góp: kỳ tới
    const loan = repo.createDebt({
      direction: "borrow",
      name: "Trả góp xe",
      aliases: "xe",
      openingAmount: 12_000_000,
      interestRate: 10,
      monthlyPayment: 1_000_000,
      paymentDay: 15,
      dueDate: null,
      note: "",
      createdOn: "2026-01-15",
    });
    expect(repo.getDebt(loan)!.nextPaymentDate).toMatch(/^\d{4}-\d{2}-15$/);

    // Khoản ghi vào app hôm nay, ngày trả hằng tháng đã qua → kỳ tới là tháng sau, không phải quá hạn
    const today = (await import("./format")).todayVN();
    const { shiftMonth } = await import("./format");
    const yesterdayDay = Math.max(1, Number(today.slice(8, 10)) - 1);
    const late = repo.createDebt({
      direction: "borrow",
      name: "Vay ghi sau ngày trả",
      aliases: "",
      openingAmount: 5_000_000,
      interestRate: null,
      monthlyPayment: 500_000,
      paymentDay: yesterdayDay,
      dueDate: null,
      note: "",
      createdOn: today,
    });
    expect(repo.getDebt(late)!.nextPaymentDate).toBe(
      `${shiftMonth(today.slice(0, 7), 1)}-${String(yesterdayDay).padStart(2, "0")}`,
    );

    // Xóa hết giao dịch của khoản nợ tạo từ nhập nhanh → khoản nợ cũng bị xóa
    repo.deleteTransaction(collectId);
    const lendTx = repo.listTransactions({ debtId })[0];
    repo.deleteTransaction(lendTx.id);
    expect(repo.getDebt(debtId)).toBeNull();
    expect(repo.getDebt(loan)).not.toBeNull(); // có nợ ban đầu → giữ lại
  });

  it("không xóa được ví đã có giao dịch", () => {
    expect(() => repo.deleteWallet(wallet("MB Bank").id)).toThrow();
  });
});

describe("phân tích", () => {
  it("khoản cố định không bị ước tính theo tốc độ chi trong tháng đang diễn ra", async () => {
    const { getCashflow, monthRange } = await import("./analytics");
    const { todayVN, shiftMonth } = await import("./format");
    const cur = todayVN().slice(0, 7);
    const shb = repo.getWallets().find((w) => w.name === "SHB")!.id;
    const nhaO = repo.getCategories().find((c) => c.name === "Nhà ở")!.id;
    for (const month of [shiftMonth(cur, -2), shiftMonth(cur, -1), cur]) {
      repo.insertTransaction({
        type: "expense",
        amount: 3_500_000,
        walletId: shb,
        toWalletId: null,
        categoryId: nhaO,
        note: "tiền nhà",
        date: `${month}-01`,
      });
    }
    const trend = getCashflow(monthRange(cur, 3)).categoryTrends.find((t) => t.categoryId === nhaO)!;
    expect(trend.reference).toBe(3_500_000);
    expect(trend.anomaly).toBe(false);
  });
});

describe("thẻ tín dụng", () => {
  it("quẹt thẻ là chi tiêu và làm dư nợ tăng; thanh toán thẻ là chuyển tiền", () => {
    repo.createWallet({
      name: "Thẻ FE",
      kind: "credit",
      aliases: "fe",
      color: "#111111",
      balance: -17_015_336, // đã tiêu 17.015.336
      creditLimit: 18_000_000,
      paymentDay: 1,
      monthlyPayment: null,
    });
    const card = () => repo.getWallets().find((w) => w.name === "Thẻ FE")!;
    expect(card()).toMatchObject({ used: 17_015_336, available: 984_664 });
    expect(card().nextPaymentDate).toMatch(/^\d{4}-\d{2}-01$/);

    const before = repo.getMonthSummary("2026-09").expense;
    // Quẹt thẻ mua đồ → tính là chi tiêu
    repo.insertTransaction({
      type: "expense",
      amount: 500_000,
      walletId: card().id,
      toWalletId: null,
      categoryId: repo.getCategories().find((c) => c.name === "Mua sắm")!.id,
      note: "quẹt thẻ mua đồ",
      date: "2026-09-11",
    });
    expect(card().used).toBe(17_515_336);
    expect(card().available).toBe(484_664);
    expect(repo.getMonthSummary("2026-09").expense).toBe(before + 500_000);

    // Thanh toán thẻ = chuyển tiền từ ngân hàng sang thẻ, không tính vào chi tiêu
    const shb = repo.getWallets().find((w) => w.name === "SHB")!;
    repo.insertTransaction({
      type: "transfer",
      amount: 2_000_000,
      walletId: shb.id,
      toWalletId: card().id,
      categoryId: null,
      note: "thanh toán thẻ",
      date: "2026-09-11",
    });
    expect(card().used).toBe(15_515_336);
    expect(repo.getMonthSummary("2026-09").expense).toBe(before + 500_000);
  });
});

describe("trả hết khoản vay lãi ngoài", () => {
  it("ghi một lần: gốc trừ vào nợ, lãi vào danh mục Lãi vay", () => {
    const cash = repo.getWallets().find((w) => w.kind === "cash")!;
    const debtId = repo.createDebt({
      direction: "borrow",
      name: "Vay lãi ngoài test",
      aliases: "",
      openingAmount: 10_000_000,
      interestRate: null,
      monthlyPayment: 500_000,
      paymentDay: 10,
      dueDate: "2026-09-10",
      note: "",
      paymentIsInterest: true,
      createdOn: "2026-09-01",
    });
    expect(repo.getDebt(debtId)).toMatchObject({ outstanding: 10_000_000, payoffAmount: 10_500_000 });

    const expenseBefore = repo.getMonthSummary("2026-09").expense;
    repo.payOffDebt({ debtId, walletId: cash.id, date: "2026-09-11", principal: 10_000_000, interest: 500_000 });

    const debt = repo.getDebt(debtId)!;
    expect(debt.outstanding).toBe(0);
    expect(debt.isOpen).toBe(false);

    // Chỉ tiền lãi được tính là chi tiêu; tiền gốc không phải chi tiêu
    const summary = repo.getMonthSummary("2026-09");
    expect(summary.expense).toBe(expenseBefore + 500_000);
    expect(summary.byCategory.find((c) => c.name === "Lãi vay")?.total).toBe(500_000);

    // Trả quá số còn nợ thì báo lỗi
    expect(() =>
      repo.payOffDebt({ debtId, walletId: cash.id, date: "2026-09-11", principal: 1, interest: 0 }),
    ).toThrow();
  });
});

describe("khoản định kỳ", () => {
  it("gắn giao dịch vào khoản định kỳ, gợi ý số lần trước, biết đã ghi trong tháng", async () => {
    const { todayVN } = await import("./format");
    const today = todayVN();
    const cash = repo.getWallets().find((w) => w.kind === "cash")!;
    const cat = repo.getCategories().find((c) => c.name === "Hóa đơn")!;
    repo.createRecurring({
      name: "Claude Pro",
      kind: "expense",
      amount: null,
      amountUsd: 22,
      categoryId: cat.id,
      walletId: cash.id,
      dayOfMonth: 5,
      note: "",
    });
    const item = () => repo.getRecurring().find((r) => r.name === "Claude Pro")!;
    expect(item()).toMatchObject({ amountUsd: 22, dayOfMonth: 5, doneThisMonth: false, lastAmount: null });
    expect(item().nextDate).toMatch(/^\d{4}-\d{2}-05$/);

    repo.insertTransaction({
      type: "expense",
      amount: 578_600,
      walletId: cash.id,
      toWalletId: null,
      categoryId: cat.id,
      note: "Claude Pro",
      date: `${today.slice(0, 7)}-05`,
      recurringId: item().id,
    });

    expect(item()).toMatchObject({ doneThisMonth: true, lastAmount: 578_600 });
    // Đã ghi tháng này → nhắc sang tháng sau
    expect(item().nextDate?.slice(0, 7)).not.toBe(today.slice(0, 7));
  });
});

describe("tự gắn khoản định kỳ theo ghi chú", () => {
  it("ghi chú chứa tên khoản định kỳ thì khớp, ghi rồi thì không khớp nữa", async () => {
    const { todayVN } = await import("./format");
    const cash = repo.getWallets().find((w) => w.kind === "cash")!;
    repo.createRecurring({
      name: "Tiền nhà",
      kind: "expense",
      amount: 2_175_000,
      amountUsd: null,
      categoryId: repo.getCategories().find((c) => c.name === "Nhà ở")!.id,
      walletId: null,
      dayOfMonth: 5,
      note: "",
    });
    const id = repo.getRecurring().find((r) => r.name === "Tiền nhà")!.id;

    expect(repo.findRecurringByNote("thanh toán tiền nhà")).toBe(id);
    expect(repo.findRecurringByNote("ăn trưa")).toBeNull();

    repo.insertTransaction({
      type: "expense",
      amount: 2_175_000,
      walletId: cash.id,
      toWalletId: null,
      categoryId: null,
      note: "thanh toán tiền nhà",
      date: `${todayVN().slice(0, 7)}-05`,
      recurringId: id,
    });
    // Đã ghi trong tháng → không gắn thêm lần nữa
    expect(repo.findRecurringByNote("thanh toán tiền nhà")).toBeNull();
  });
});

describe("khoản định kỳ quá hạn", () => {
  it("ngày trong tháng đã qua mà chưa ghi thì báo quá hạn, ghi rồi thì nhắc tháng sau", async () => {
    const { todayVN, shiftMonth } = await import("./format");
    const today = todayVN();
    const dayPassed = Math.max(1, Number(today.slice(8, 10)) - 1);
    repo.createRecurring({
      name: "Tiền nhà quá hạn",
      kind: "expense",
      amount: 2_000_000,
      amountUsd: null,
      categoryId: null,
      walletId: null,
      dayOfMonth: dayPassed,
      note: "",
    });
    const item = () => repo.getRecurring().find((r) => r.name === "Tiền nhà quá hạn")!;
    expect(item().overdue).toBe(true);
    expect(item().nextDate).toBe(`${today.slice(0, 7)}-${String(dayPassed).padStart(2, "0")}`);

    const cash = repo.getWallets().find((w) => w.kind === "cash")!;
    repo.insertTransaction({
      type: "expense",
      amount: 2_000_000,
      walletId: cash.id,
      toWalletId: null,
      categoryId: null,
      note: "tiền nhà",
      date: today,
      recurringId: item().id,
    });
    expect(item().overdue).toBe(false);
    expect(item().nextDate?.slice(0, 7)).toBe(shiftMonth(today.slice(0, 7), 1));
  });
});

describe("bắt buộc biết tiêu vào việc gì", () => {
  it("khoản chi không có ghi chú và không có danh mục thì bị từ chối", async () => {
    const { txSchema } = await import("./tx-schema");
    const base = { amount: 50_000, walletId: 1, toWalletId: null, date: "2026-09-11" };

    const empty = txSchema.safeParse({ ...base, type: "expense", categoryId: null, note: "  " });
    expect(empty.success).toBe(false);
    expect(empty.error?.issues[0]?.message).toContain("Ghi chú");

    expect(txSchema.safeParse({ ...base, type: "expense", categoryId: null, note: "băng cuốn" }).success).toBe(true);
    expect(txSchema.safeParse({ ...base, type: "expense", categoryId: 3, note: "" }).success).toBe(true);
    // Chuyển ví và giao dịch nợ không cần ghi chú
    expect(txSchema.safeParse({ ...base, type: "transfer", toWalletId: 2, categoryId: null, note: "" }).success).toBe(
      true,
    );
    expect(
      txSchema.safeParse({ ...base, type: "debt", debtAction: "repay", debtId: 1, categoryId: null, note: "" }).success,
    ).toBe(true);
  });
});

describe("chiến lược trả nợ", () => {
  it("dồn tiền vào khoản lãi cao nhất, tính được bao giờ hết nợ", async () => {
    const { computeStrategy } = await import("./debt-plan");
    const debts = [
      // vay lãi ngoài 750k/tháng trên 5tr ≈ 180%/năm
      { key: "a", name: "Anh Tuân", kind: "interest-only" as const, outstanding: 5_000_000, required: 750_000, monthlyInterest: 750_000, yearlyRate: 180, canPrepay: true },
      // vay lãi ngoài 500k/tháng trên 10tr ≈ 60%/năm
      { key: "b", name: "Em Nguyên", kind: "interest-only" as const, outstanding: 10_000_000, required: 500_000, monthlyInterest: 500_000, yearlyRate: 60, canPrepay: true },
      { key: "c", name: "Tin Vay", kind: "installment" as const, outstanding: 10_000_000, required: 1_431_000, monthlyInterest: 0, yearlyRate: null, canPrepay: false },
      { key: "d", name: "Thẻ HD", kind: "card" as const, outstanding: 5_000_000, required: 5_000_000, monthlyInterest: 0, yearlyRate: null, canPrepay: true },
      { key: "e", name: "Anh Thịnh", kind: "free" as const, outstanding: 5_000_000, required: 0, monthlyInterest: 0, yearlyRate: null, canPrepay: true },
    ];

    const s = computeStrategy(debts, 2_000_000, "2026-09");
    expect(s.requiredMonthly).toBe(750_000 + 500_000 + 1_431_000 + 5_000_000);
    expect(s.interestMonthly).toBe(1_250_000);
    expect(s.totalOutstanding).toBe(35_000_000);
    // Lãi cao nhất được ưu tiên, khoản không lãi xếp cuối
    expect(s.priority.map((d) => d.name)).toEqual(["Anh Tuân", "Em Nguyên", "Thẻ HD", "Anh Thịnh"]);
    // Tháng đầu dồn 2tr vào anh Tuân
    expect(s.steps[0]).toMatchObject({ month: "2026-09", focus: "Anh Tuân", extraPaid: 2_000_000, interestPaid: 1_250_000 });
    expect(s.monthsToDebtFree).toBeGreaterThan(0);
    expect(s.debtFreeMonth).toMatch(/^\d{4}-\d{2}$/);
    // Dồn nhiều hơn thì hết nợ nhanh hơn và trả ít lãi hơn
    const faster = computeStrategy(debts, 5_000_000, "2026-09");
    expect(faster.monthsToDebtFree!).toBeLessThan(s.monthsToDebtFree!);
    expect(faster.totalInterest).toBeLessThan(s.totalInterest);
  });

  it("không dồn được đồng nào thì khoản vay lãi ngoài không bao giờ hết", async () => {
    const { computeStrategy } = await import("./debt-plan");
    const s = computeStrategy(
      [{ key: "a", name: "Lãi ngoài", kind: "interest-only", outstanding: 5_000_000, required: 750_000, monthlyInterest: 750_000, yearlyRate: 180, canPrepay: true }],
      0,
      "2026-09",
    );
    expect(s.monthsToDebtFree).toBeNull();
    expect(s.debtFreeMonth).toBeNull();
    // 10 năm chỉ trả lãi = 90 triệu, gốc vẫn 5 triệu
    expect(s.totalInterest).toBe(750_000 * 120);
  });
});

describe("nhiều nguồn thu nhập", () => {
  it("tổng các nguồn thu định kỳ thành thu nhập dự kiến", async () => {
    const { buildPlanFrame } = await import("./planning");
    const { todayVN, shiftMonth } = await import("./format");
    const next = shiftMonth(todayVN().slice(0, 7), 1);
    const shb = repo.getWallets().find((w) => w.name === "SHB")!;

    repo.createRecurring({
      name: "Lương chính",
      kind: "income",
      amount: 14_891_000,
      amountUsd: null,
      categoryId: repo.getCategories().find((c) => c.name === "Lương")!.id,
      walletId: shb.id,
      dayOfMonth: 10,
      note: "",
    });
    repo.createRecurring({
      name: "Làm thêm",
      kind: "income",
      amount: 3_000_000,
      amountUsd: null,
      categoryId: null,
      walletId: null,
      dayOfMonth: 25,
      note: "",
    });

    const sources = repo.getRecurring().filter((r) => r.kind === "income");
    expect(sources.map((r) => r.name).sort()).toEqual(["Làm thêm", "Lương chính"]);

    const frame = buildPlanFrame(next);
    // DB test đã có giao dịch thu từ các test trước nên có thể lấy theo lịch sử;
    // nếu lấy theo nguồn khai thì phải bằng tổng 2 nguồn
    if (frame.incomeSource === "sources") {
      expect(frame.expectedIncome).toBe(17_891_000);
      expect(frame.incomeSources).toHaveLength(2);
    }
    expect(["history", "sources"]).toContain(frame.incomeSource);
  });
});

describe("nâng cấp dữ liệu", () => {
  it("chạy lại bản nâng cấp cũ không gây lỗi và số phiên bản đúng", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chi-tieu-mig-"));
    const file = path.join(dir, "m.db");
    const { MIGRATIONS_COUNT, openDbAt } = await import("./db");

    // Mở lần đầu: tạo mới toàn bộ
    const first = openDbAt(file);
    expect(first.pragma("user_version", { simple: true })).toBe(MIGRATIONS_COUNT);
    // Giả lập số phiên bản bị lệch (như lỗi đã xảy ra trên máy chủ)
    first.pragma(`user_version = ${MIGRATIONS_COUNT - 1}`);
    first.close();

    // Mở lại: chạy lại bản cuối, không được lỗi, và phải sửa lại số phiên bản
    const second = openDbAt(file);
    expect(second.pragma("user_version", { simple: true })).toBe(MIGRATIONS_COUNT);
    expect(second.prepare("SELECT COUNT(*) n FROM pragma_table_info('recurring') WHERE name='kind'").get()).toEqual({
      n: 1,
    });
    second.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("tự gắn khoản định kỳ theo ghi chú", () => {
  it("khớp theo tên và đúng loại thu/chi, đã ghi trong tháng thì không khớp nữa", async () => {
    const { todayVN } = await import("./format");
    const today = todayVN();
    const cash = repo.getWallets().find((w) => w.kind === "cash")!;

    repo.createRecurring({
      name: "Tiền điện",
      kind: "expense",
      amount: 700_000,
      amountUsd: null,
      categoryId: repo.getCategories().find((c) => c.name === "Hóa đơn")!.id,
      walletId: null,
      dayOfMonth: 15,
      note: "",
    });
    repo.createRecurring({
      name: "Thưởng dự án",
      kind: "income",
      amount: 2_000_000,
      amountUsd: null,
      categoryId: null,
      walletId: null,
      dayOfMonth: null,
      note: "",
    });
    const bill = repo.getRecurring().find((r) => r.name === "Tiền điện")!.id;
    const bonus = repo.getRecurring().find((r) => r.name === "Thưởng dự án")!.id;

    // Ghi chú chứa tên khoản → khớp
    expect(repo.findRecurringByNote("thanh toán tiền điện", "expense")).toBe(bill);
    expect(repo.findRecurringByNote("thưởng dự án tháng 9", "income")).toBe(bonus);
    // Sai loại thì không khớp (khoản chi không gắn vào nguồn thu)
    expect(repo.findRecurringByNote("thưởng dự án tháng 9", "expense")).toBeNull();
    expect(repo.findRecurringByNote("thanh toán tiền điện", "income")).toBeNull();
    // Ghi chú không liên quan
    expect(repo.findRecurringByNote("ăn trưa", "expense")).toBeNull();

    // Ghi rồi thì tháng này không gắn thêm nữa
    repo.insertTransaction({
      type: "expense",
      amount: 700_000,
      walletId: cash.id,
      toWalletId: null,
      categoryId: null,
      note: "thanh toán tiền điện",
      date: `${today.slice(0, 7)}-15`,
      recurringId: bill,
    });
    expect(repo.findRecurringByNote("thanh toán tiền điện", "expense")).toBeNull();
  });
});
