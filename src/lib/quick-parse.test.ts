import { describe, expect, it } from "vitest";
import { quickParse, type ParseContext } from "./quick-parse";
import { SEED_CATEGORIES, SEED_WALLETS } from "./seed";

const wallets = SEED_WALLETS.map((w, i) => ({ id: i + 1, ...w }));
const categories = SEED_CATEGORIES.map((c, i) => ({ id: i + 1, name: c.name, type: c.type }));
const keywords = SEED_CATEGORIES.flatMap((c, i) => c.keywords.map((keyword) => ({ keyword, categoryId: i + 1 })));

const ctx: ParseContext = { today: "2026-09-11", wallets, categories, keywords };

const W = (name: string) => wallets.find((w) => w.name === name)!.id;
const C = (name: string) => categories.find((c) => c.name === name)!.id;
const MB = W("MB Bank");
const SHB = W("SHB");
const MOMO = W("Ví MoMo");
const CASH = W("Tiền mặt");

const parse = (s: string) => quickParse(s, ctx);

describe("số tiền", () => {
  it.each([
    ["35k cafe", 35_000],
    ["cafe 35 nghìn", 35_000],
    ["2.5k gửi xe", 2_500],
    ["tiền nhà 3tr", 3_000_000],
    ["tiền nhà 3tr5", 3_500_000],
    ["học phí 2tr250", 2_250_000],
    ["1.5tr giày", 1_500_000],
    ["1,5 triệu giày", 1_500_000],
    ["lương 15 củ", 15_000_000],
    ["1 triệu rưỡi", 1_500_000],
    ["2 trăm đổ xăng", 200_000],
    ["cafe 35.000đ", 35_000],
    ["1,200,000 vnd tiền điện", 1_200_000],
    ["cafe 35", 35_000],
    ["mua sách 150000", 150_000],
    ["taxi 35000", 35_000],
    // Quy ước: k = nghìn · l = trăm nghìn · m = triệu
    ["2k gửi xe", 2_000],
    ["4l đi chợ", 400_000],
    ["4.5l đi chợ", 450_000],
    ["tiền nhà 2.175 m", 2_175_000],
    ["tiền nhà 2.175m", 2_175_000],
    ["lương 15m", 15_000_000],
    ["1.5m giày", 1_500_000],
    ["cafe 35k", 35_000],
    ["1.500k", 1_500_000],
  ])("%s → %d", (input, amount) => {
    expect(parse(input).amount).toBe(amount);
  });

  it("không có số → null", () => {
    expect(parse("cafe").amount).toBeNull();
  });
});

describe("loại, ví, danh mục", () => {
  it("chi tiêu mặc định vào ví mặc định", () => {
    expect(parse("35k cafe")).toMatchObject({
      type: "expense",
      walletId: CASH,
      categoryId: C("Cà phê & trà sữa"),
      note: "cafe",
      date: "2026-09-11",
    });
  });

  it("nhận ra ví và bỏ khỏi ghi chú", () => {
    expect(parse("ăn trưa 45k bằng momo")).toMatchObject({
      walletId: MOMO,
      categoryId: C("Ăn uống"),
      note: "ăn trưa",
    });
    expect(parse("đổ xăng 80k mb")).toMatchObject({ walletId: MB, categoryId: C("Di chuyển"), note: "đổ xăng" });
  });

  it("thu nhập theo danh mục", () => {
    expect(parse("lương 15tr shb")).toMatchObject({
      type: "income",
      amount: 15_000_000,
      walletId: SHB,
      categoryId: C("Lương"),
      note: "lương",
    });
  });

  it("dấu + ép thành thu, dấu - ép thành chi", () => {
    expect(parse("+500k bán đồ cũ")).toMatchObject({ type: "income", categoryId: C("Thu nhập khác") });
    expect(parse("+200k")).toMatchObject({ type: "income", amount: 200_000, categoryId: null });
    expect(parse("-50k linh tinh")).toMatchObject({ type: "expense", note: "linh tinh" });
  });

  it("từ khóa dài thắng từ khóa ngắn", () => {
    expect(parse("tiền điện 600k").categoryId).toBe(C("Hóa đơn"));
    expect(parse("ăn cưới 500k").categoryId).toBe(C("Hiếu hỉ & quà"));
    expect(parse("mẹ cho 1tr").categoryId).toBe(C("Được cho & lì xì"));
    expect(parse("gửi mẹ 2tr").categoryId).toBe(C("Gia đình"));
  });

  it("không nhầm từ đồng dạng sau khi bỏ dấu", () => {
    // "thường" không được hiểu là "thưởng", "quán" không phải "quần"
    expect(parse("cơm bình thường 40k")).toMatchObject({ type: "expense", categoryId: C("Ăn uống") });
    expect(parse("quán nước 20k").categoryId).not.toBe(C("Mua sắm"));
  });

  it("không khớp được danh mục → null", () => {
    expect(parse("linh tinh 20k").categoryId).toBeNull();
  });
});

describe("câu nhập thật", () => {
  it("thanh toán tiền nhà 2.175m shb", () => {
    expect(parse("thanh toán tiền nhà 2.175m shb")).toMatchObject({
      type: "expense",
      amount: 2_175_000,
      walletId: SHB,
      categoryId: C("Nhà ở"),
      note: "thanh toán tiền nhà",
    });
  });

  it("không nhầm 'l' với chữ trong từ", () => {
    expect(parse("3 lần gửi xe 15k").amount).toBe(15_000);
    expect(parse("đổ 2 lít xăng 50k").amount).toBe(50_000);
  });
});

describe("tiền người khác đưa", () => {
  it("“<tên> chuyển/trả/gửi <số tiền>” là khoản thu", () => {
    expect(parse("em Thịnh chuyển 100k")).toMatchObject({ type: "income", amount: 100_000, note: "em Thịnh chuyển" });
    expect(parse("em Thịnh trả 300k shb")).toMatchObject({ type: "income", amount: 300_000, walletId: SHB });
    expect(parse("mẹ gửi cho 1m")).toMatchObject({ type: "income", amount: 1_000_000 });
    expect(parse("Hùng chuyển khoản 250k momo")).toMatchObject({ type: "income", walletId: MOMO });
  });

  it("không nhầm với khoản chi có chữ chuyển/trả", () => {
    expect(parse("chuyển tiền nhà 3m mb")).toMatchObject({ type: "expense", categoryId: C("Nhà ở") });
    expect(parse("trả tiền điện 600k")).toMatchObject({ type: "expense", categoryId: C("Hóa đơn") });
    expect(parse("chuyển 5l mb sang momo")).toMatchObject({ type: "transfer" });
    expect(parse("35k cafe")).toMatchObject({ type: "expense" });
  });
});

describe("ngày", () => {
  it("hôm qua / hôm kia", () => {
    expect(parse("hôm qua đổ xăng 80k")).toMatchObject({ date: "2026-09-10", amount: 80_000, note: "đổ xăng" });
    expect(parse("cafe 30k hôm kia").date).toBe("2026-09-09");
  });

  it("dd/mm không bị hiểu là số tiền", () => {
    expect(parse("5/9 tiền nhà 3tr")).toMatchObject({ date: "2026-09-05", amount: 3_000_000, note: "tiền nhà" });
    expect(parse("ngày 1/9/2026 internet 250k")).toMatchObject({ date: "2026-09-01", note: "internet" });
  });

  it("ngày trong tương lai của năm nay → năm ngoái", () => {
    expect(parse("30/12 quà sinh nhật 500k").date).toBe("2025-12-30");
  });

  it("ngày không hợp lệ bị bỏ qua", () => {
    expect(parse("31/2 cafe 30k").date).toBe("2026-09-11");
  });
});

describe("chuyển tiền giữa ví", () => {
  it("X sang Y", () => {
    expect(parse("chuyển 500k mb sang momo")).toMatchObject({
      type: "transfer",
      amount: 500_000,
      walletId: MB,
      toWalletId: MOMO,
      categoryId: null,
      note: "chuyển",
    });
  });

  it("nạp Y từ X", () => {
    expect(parse("nạp momo 200k từ shb")).toMatchObject({ type: "transfer", walletId: SHB, toWalletId: MOMO });
    expect(parse("nạp 200k vào momo từ mb")).toMatchObject({ walletId: MB, toWalletId: MOMO });
    expect(parse("nạp momo 200k mb")).toMatchObject({ walletId: MB, toWalletId: MOMO });
  });

  it("rút tiền về tiền mặt", () => {
    expect(parse("rút 2tr mb")).toMatchObject({ type: "transfer", walletId: MB, toWalletId: CASH, amount: 2_000_000 });
  });

  it("chỉ 1 ví + 'chuyển' vẫn là chi tiêu", () => {
    expect(parse("chuyển tiền nhà 3tr mb")).toMatchObject({ type: "expense", walletId: MB, categoryId: C("Nhà ở") });
  });
});

describe("nợ", () => {
  const debts = [
    { id: 1, name: "Nam", aliases: "", direction: "lend" as const },
    { id: 2, name: "Mẹ", aliases: "me", direction: "borrow" as const },
    { id: 3, name: "Trả góp xe", aliases: "", direction: "borrow" as const },
  ];
  const p = (s: string) => quickParse(s, { ...ctx, debts });

  it("cho vay người mới", () => {
    expect(p("cho Tuấn mượn 500k mb")).toMatchObject({
      type: "debt",
      debtAction: "lend",
      debtId: null,
      debtName: "Tuấn",
      amount: 500_000,
      walletId: MB,
      categoryId: null,
    });
  });

  it("cho vay thêm người đã có", () => {
    expect(p("cho nam vay 200k")).toMatchObject({ debtAction: "lend", debtId: 1, debtName: "Nam" });
  });

  it("thu nợ", () => {
    expect(p("Nam trả 200k")).toMatchObject({ type: "debt", debtAction: "collect", debtId: 1 });
    expect(p("thu nợ nam 100k momo")).toMatchObject({ debtAction: "collect", debtId: 1, walletId: MOMO });
  });

  it("đi vay", () => {
    expect(p("vay mẹ 5tr")).toMatchObject({ debtAction: "borrow", debtId: 2 });
    expect(p("mượn tiền của Hùng 1tr")).toMatchObject({ debtAction: "borrow", debtId: null, debtName: "Hùng" });
  });

  it("trả nợ", () => {
    expect(p("trả nợ mẹ 1tr shb")).toMatchObject({ debtAction: "repay", debtId: 2, walletId: SHB });
    expect(p("trả mẹ 500k")).toMatchObject({ debtAction: "repay", debtId: 2 });
    expect(p("trả góp xe 1tr2 mb")).toMatchObject({ debtAction: "repay", debtId: 3, amount: 1_200_000 });
  });

  it("cùng tên nhưng khác chiều: trả nợ vs người ta trả", () => {
    const both = [
      { id: 10, name: "Em Nguyên", aliases: "em nguyen, nguyen", direction: "borrow" as const },
      { id: 11, name: "Em Nguyên", aliases: "em nguyen, nguyen", direction: "lend" as const },
    ];
    const q = (s: string) => quickParse(s, { ...ctx, debts: both });
    // Mình trả cho Nguyên → khoản mình đi vay
    expect(q("trả nợ em nguyên 500k shb")).toMatchObject({ debtAction: "repay", debtId: 10 });
    // Nguyên trả cho mình → khoản Nguyên đang nợ mình
    expect(q("nguyên trả 200k shb")).toMatchObject({ debtAction: "collect", debtId: 11 });
  });

  it("trả lãi là khoản chi “Lãi vay”, không trừ vào gốc", () => {
    expect(p("trả lãi em nguyên 500k shb")).toMatchObject({
      type: "expense",
      amount: 500_000,
      debtId: null,
      categoryId: C("Lãi vay"),
      walletId: SHB,
    });
    expect(p("tiền lãi anh tuân 750k mb")).toMatchObject({ type: "expense", categoryId: C("Lãi vay") });
  });

  it("không ghi số tiền thì tự lấy số đã biết", () => {
    const full = [
      {
        id: 20,
        name: "Anh Tuân",
        aliases: "anh tuan, tuan",
        direction: "borrow" as const,
        monthlyPayment: 750_000,
        outstanding: 5_000_000,
        payoffAmount: 5_750_000,
        paymentIsInterest: true,
      },
      {
        id: 21,
        name: "Anh Hoàng",
        aliases: "anh hoang, hoang",
        direction: "lend" as const,
        monthlyPayment: null,
        outstanding: 2_500_000,
        payoffAmount: 2_500_000,
        paymentIsInterest: false,
      },
    ];
    const q = (s: string) => quickParse(s, { ...ctx, debts: full });

    // Đóng lãi: lấy tiền lãi hằng tháng
    expect(q("đóng lãi bác tuân shb")).toMatchObject({
      type: "expense",
      amount: 750_000,
      categoryId: C("Lãi vay"),
      walletId: SHB,
    });
    // Trả nợ không ghi số = trả hết (gốc + lãi kỳ này)
    expect(q("trả nợ anh tuân shb")).toMatchObject({ debtAction: "repay", amount: 5_750_000 });
    // Ghi số thì dùng đúng số đó
    expect(q("trả nợ 1m anh tuân shb")).toMatchObject({ debtAction: "repay", amount: 1_000_000 });
    // Thu nợ không ghi số = thu hết
    expect(q("hoàng trả mb")).toMatchObject({ debtAction: "collect", amount: 2_500_000 });
    // "thanh toán <số> cho <ai>" cũng là trả nợ
    expect(q("thanh toán 500k cho anh tuân shb")).toMatchObject({ debtAction: "repay", amount: 500_000 });
  });

  it("không nhầm với chi tiêu thường", () => {
    expect(p("cho mẹ 2tr").type).toBe("expense");
    expect(p("trả tiền nhà 3tr").type).toBe("expense");
    expect(p("ăn với Nam 50k").type).toBe("expense");
    expect(quickParse("Nam trả 200k", ctx).type).not.toBe("debt"); // không có khoản nợ nào
  });
});
