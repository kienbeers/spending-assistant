"use server";

// App chạy local cho 1 người dùng nên không có bước xác thực trong các action.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isValidDate, isValidMonth, todayVN } from "@/lib/format";
import {
  createGoal,
  createPlan,
  deleteGoal,
  deletePlan,
  EXPECTED_INCOME_KEY,
  saveBudgets,
  setPlanStatus,
  updateGoal,
  updatePlan,
} from "@/lib/planning";
import { DEBT_ACTION_DIRECTION, DEBT_ACTION_TX_TYPE } from "@/lib/quick-parse";
import { txSchema } from "@/lib/tx-schema";
import * as repo from "@/lib/repo";

export type ActionResult = { ok: true; id: number } | { ok: false; error: string };

const id = z.coerce.number().int().positive();

export async function saveTransaction(txId: number | null, input: unknown): Promise<ActionResult> {
  const parsed = txSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const tx = parsed.data;

  let savedId: number;
  try {
    const record =
      tx.type === "debt"
        ? resolveDebtEntry(tx)
        : {
            ...tx,
            type: tx.type,
            debtId: null,
            // Ghi "thanh toán tiền nhà 2175 shb" → tự gắn vào khoản định kỳ "Tiền nhà"
            recurringId:
              tx.recurringId ?? (tx.type === "expense" && txId === null ? repo.findRecurringByNote(tx.note) : null),
          };
    if (txId === null) {
      savedId = repo.insertTransaction(record);
    } else {
      repo.updateTransaction(id.parse(txId), record);
      savedId = txId;
    }
    if (tx.type === "expense" || tx.type === "income") {
      if (tx.categoryId && tx.note) repo.learnKeyword(tx.note, tx.categoryId);
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Không lưu được" };
  }
  revalidatePath("/", "layout");
  return { ok: true, id: savedId };
}

/** Giao dịch nợ → giao dịch thu/chi gắn khoản nợ; tạo khoản nợ mới khi cần. */
function resolveDebtEntry(tx: z.infer<typeof txSchema>): repo.TxInput {
  const action = tx.debtAction!;
  const direction = DEBT_ACTION_DIRECTION[action];
  let debtId = tx.debtId;

  if (debtId) {
    const debt = repo.getDebt(debtId);
    if (!debt) throw new Error("Không tìm thấy khoản nợ");
    if (debt.direction !== direction) throw new Error("Khoản nợ không khớp loại giao dịch");
  } else {
    const name = tx.debtName.trim();
    if (action === "collect" || action === "repay") throw new Error("Chọn khoản nợ cần trả / thu");
    if (!name) throw new Error(action === "lend" ? "Nhập tên người vay" : "Nhập tên người / nơi cho vay");
    debtId = repo.createDebt({
      direction,
      name,
      aliases: "",
      openingAmount: 0,
      interestRate: null,
      monthlyPayment: null,
      paymentDay: null,
      dueDate: null,
      note: "",
      paymentIsInterest: false,
      createdOn: tx.date,
    });
  }
  return {
    type: DEBT_ACTION_TX_TYPE[action],
    amount: tx.amount,
    walletId: tx.walletId,
    toWalletId: null,
    categoryId: null,
    note: tx.note,
    date: tx.date,
    debtId,
  };
}

export async function removeTransaction(txId: number): Promise<void> {
  repo.deleteTransaction(id.parse(txId));
  revalidatePath("/", "layout");
}

// --- Ví (gọi từ <form>) ----------------------------------------------------------

/** Ô nhập tiền để trống → null */
const moneyOrNull = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? null : String(v).replace(/[^\d]/g, "") || null),
  z.coerce.number().int().min(0).nullable(),
);

const walletSchema = z
  .object({
    name: z.string().trim().min(1).max(50),
    kind: z.enum(["bank", "ewallet", "cash", "credit"]),
    aliases: z.string().max(200).default(""),
    color: z.string().regex(/^#[0-9a-f]{6}$/i).default("#64748b"),
    balance: z.preprocess((v) => String(v ?? "0").replace(/[^\d-]/g, "") || "0", z.coerce.number().int()),
    creditLimit: moneyOrNull.default(null),
    available: moneyOrNull.default(null),
    monthlyPayment: moneyOrNull.default(null),
    paymentDay: z.preprocess(
      (v) => (v === "" || v === undefined ? null : v),
      z.coerce.number().int().min(1).max(31).nullable(),
    ).default(null),
  })
  // Thẻ tín dụng: nhập "còn dùng được" → số dư = còn dùng được − hạn mức (âm = đang nợ thẻ)
  .transform((w) =>
    w.kind === "credit" && w.available !== null && w.creditLimit !== null
      ? { ...w, balance: w.available - w.creditLimit }
      : w,
  );

export async function createWalletAction(formData: FormData) {
  repo.createWallet(walletSchema.parse(Object.fromEntries(formData)));
  revalidatePath("/", "layout");
}

export async function updateWalletAction(formData: FormData) {
  repo.updateWallet(id.parse(formData.get("id")), walletSchema.parse(Object.fromEntries(formData)));
  revalidatePath("/", "layout");
}

export async function setDefaultWalletAction(formData: FormData) {
  repo.setDefaultWallet(id.parse(formData.get("id")));
  revalidatePath("/", "layout");
}

export async function deleteWalletAction(formData: FormData) {
  repo.deleteWallet(id.parse(formData.get("id")));
  revalidatePath("/", "layout");
}

// --- Danh mục & từ khóa ------------------------------------------------------------

const categorySchema = z.object({
  name: z.string().trim().min(1).max(50),
  icon: z.string().trim().min(1).max(16).catch("📦"),
});

export async function createCategoryAction(formData: FormData) {
  const data = categorySchema.extend({ type: z.enum(["expense", "income"]) }).parse(Object.fromEntries(formData));
  repo.createCategory(data);
  revalidatePath("/", "layout");
}

export async function updateCategoryAction(formData: FormData) {
  repo.updateCategory(id.parse(formData.get("id")), categorySchema.parse(Object.fromEntries(formData)));
  revalidatePath("/", "layout");
}

export async function toggleCategoryFixedAction(formData: FormData) {
  repo.setCategoryFixed(id.parse(formData.get("id")), formData.get("isFixed") === "1");
  revalidatePath("/", "layout");
}

export async function deleteCategoryAction(formData: FormData) {
  repo.deleteCategory(id.parse(formData.get("id")));
  revalidatePath("/", "layout");
}

export async function addKeywordAction(formData: FormData) {
  const keyword = z.string().trim().min(1).max(60).parse(formData.get("keyword"));
  repo.upsertKeyword(keyword, id.parse(formData.get("categoryId")));
  revalidatePath("/", "layout");
}

export async function deleteKeywordAction(formData: FormData) {
  repo.deleteKeyword(id.parse(formData.get("id")));
  revalidatePath("/", "layout");
}

// --- Nợ ---------------------------------------------------------------------------

const optionalInt = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? null : String(v).replace(/[^\d]/g, "")),
  z.coerce.number().int().positive().nullable(),
);
const optionalDate = z.preprocess(
  (v) => (v === "" || v === undefined ? null : v),
  z.string().refine(isValidDate, "Ngày không hợp lệ").nullable(),
);

const debtSchema = z.object({
  name: z.string().trim().min(1, "Nhập tên").max(80),
  aliases: z.string().max(200).default(""),
  openingAmount: z.preprocess((v) => String(v ?? "0").replace(/[^\d]/g, "") || "0", z.coerce.number().int().min(0)),
  interestRate: z.preprocess(
    (v) => (v === "" || v === undefined ? null : String(v).replace(",", ".")),
    z.coerce.number().min(0).max(100).nullable(),
  ),
  monthlyPayment: optionalInt,
  paymentDay: z.preprocess((v) => (v === "" || v === undefined ? null : v), z.coerce.number().int().min(1).max(31).nullable()),
  dueDate: optionalDate,
  note: z.string().max(500).default(""),
  // Vay lãi ngoài: tiền trả mỗi tháng chỉ là lãi, gốc không giảm
  paymentIsInterest: z.preprocess((v) => v === "on" || v === "1" || v === true, z.boolean()).default(false),
});

export async function createDebtAction(formData: FormData) {
  const raw = Object.fromEntries(formData);
  const base = debtSchema.parse(raw);
  const direction = z.enum(["lend", "borrow"]).parse(raw.direction);
  const createdOn = optionalDate.parse(raw.createdOn) ?? todayVN();
  const walletId = z.coerce.number().int().nonnegative().parse(raw.walletId || 0);
  const amount = base.openingAmount;

  // Có chọn ví → tiền thực sự đi qua ví: ghi giao dịch nợ thay vì nợ ban đầu
  const debtId = repo.createDebt({ ...base, direction, createdOn, openingAmount: walletId ? 0 : amount });
  if (walletId && amount > 0) {
    repo.insertTransaction({
      type: direction === "lend" ? "expense" : "income",
      amount,
      walletId,
      toWalletId: null,
      categoryId: null,
      note: "",
      date: createdOn,
      debtId,
    });
  }
  revalidatePath("/", "layout");
}

export async function updateDebtAction(formData: FormData) {
  repo.updateDebt(id.parse(formData.get("id")), debtSchema.parse(Object.fromEntries(formData)));
  revalidatePath("/", "layout");
}

/** Trả hết khoản nợ: gốc + tiền lãi kỳ này trong một lần. */
export async function payOffDebtAction(formData: FormData) {
  const money = z.preprocess((v) => String(v ?? "0").replace(/[^\d]/g, "") || "0", z.coerce.number().int().min(0));
  const data = z
    .object({
      debtId: id,
      walletId: id,
      date: z.string().refine(isValidDate, "Ngày không hợp lệ"),
      principal: money,
      interest: money,
    })
    .parse(Object.fromEntries(formData));
  repo.payOffDebt(data);
  revalidatePath("/", "layout");
}

export async function setDebtClosedAction(formData: FormData) {
  repo.setDebtClosed(id.parse(formData.get("id")), formData.get("closed") === "1");
  revalidatePath("/", "layout");
}

export async function deleteDebtAction(formData: FormData) {
  repo.deleteDebt(id.parse(formData.get("id")));
  revalidatePath("/", "layout");
}

// --- Ngân sách & mục tiêu ------------------------------------------------------------

export async function saveBudgetsAction(month: string, items: { categoryId: number; amount: number }[]) {
  const data = z
    .object({
      month: z.string().refine(isValidMonth),
      items: z.array(z.object({ categoryId: z.number().int().positive(), amount: z.number().int().min(0).max(1e13) })),
    })
    .parse({ month, items });
  saveBudgets(data.month, data.items);
  revalidatePath("/", "layout");
}

export async function saveExpectedIncomeAction(formData: FormData) {
  const amount = z
    .preprocess((v) => String(v ?? "0").replace(/[^\d]/g, "") || "0", z.coerce.number().int().min(0).max(1e13))
    .parse(formData.get("expectedIncome"));
  repo.setSetting(EXPECTED_INCOME_KEY, String(amount));
  revalidatePath("/", "layout");
}

const goalSchema = z.object({
  name: z.string().trim().min(1).max(80),
  targetAmount: z.preprocess((v) => String(v ?? "").replace(/[^\d]/g, ""), z.coerce.number().int().positive()),
  savedAmount: z.preprocess((v) => String(v ?? "0").replace(/[^\d]/g, "") || "0", z.coerce.number().int().min(0)),
  targetDate: z.preprocess(
    (v) => (v === "" || v === undefined ? null : v),
    z.string().refine(isValidDate).nullable(),
  ),
});

export async function createGoalAction(formData: FormData) {
  createGoal(goalSchema.parse(Object.fromEntries(formData)));
  revalidatePath("/", "layout");
}

export async function updateGoalAction(formData: FormData) {
  updateGoal(id.parse(formData.get("id")), goalSchema.parse(Object.fromEntries(formData)));
  revalidatePath("/", "layout");
}

export async function deleteGoalAction(formData: FormData) {
  deleteGoal(id.parse(formData.get("id")));
  revalidatePath("/", "layout");
}

// --- Khoản định kỳ ------------------------------------------------------------------

const recurringSchema = z.object({
  name: z.string().trim().min(1, "Nhập tên khoản").max(80),
  kind: z.enum(["expense", "income"]).default("expense"),
  amount: moneyOrNull.default(null),
  amountUsd: z.preprocess(
    (v) => (v === "" || v === undefined || v === null ? null : String(v).replace(",", ".")),
    z.coerce.number().min(0).max(100000).nullable(),
  ).default(null),
  categoryId: z.preprocess((v) => (v === "" || v === "0" || v === undefined ? null : v), z.coerce.number().int().positive().nullable()).default(null),
  walletId: z.preprocess((v) => (v === "" || v === "0" || v === undefined ? null : v), z.coerce.number().int().positive().nullable()).default(null),
  dayOfMonth: z.preprocess((v) => (v === "" || v === undefined ? null : v), z.coerce.number().int().min(1).max(31).nullable()).default(null),
  note: z.string().max(200).default(""),
});

export async function createRecurringAction(formData: FormData) {
  repo.createRecurring(recurringSchema.parse(Object.fromEntries(formData)));
  revalidatePath("/", "layout");
}

export async function updateRecurringAction(formData: FormData) {
  repo.updateRecurring(id.parse(formData.get("id")), recurringSchema.parse(Object.fromEntries(formData)));
  revalidatePath("/", "layout");
}

export async function setRecurringActiveAction(formData: FormData) {
  repo.setRecurringActive(id.parse(formData.get("id")), formData.get("active") === "1");
  revalidatePath("/", "layout");
}

export async function deleteRecurringAction(formData: FormData) {
  repo.deleteRecurring(id.parse(formData.get("id")));
  revalidatePath("/", "layout");
}

// --- Kế hoạch mục tiêu ---------------------------------------------------------------

const planSchema = z.object({
  title: z.string().trim().min(1, "Nhập mục tiêu").max(120),
  goalText: z.string().max(1000).default(""),
  targetAmount: moneyOrNull.default(null),
  targetDate: z.preprocess(
    (v) => (v === "" || v === undefined ? null : v),
    z.string().refine(isValidDate, "Ngày không hợp lệ").nullable(),
  ).default(null),
  extraPerMonth: z.preprocess(
    (v) => String(v ?? "0").replace(/[^\d]/g, "") || "0",
    z.coerce.number().int().min(0).max(1e13),
  ),
});

export async function createPlanAction(formData: FormData) {
  createPlan(planSchema.parse(Object.fromEntries(formData)));
  revalidatePath("/", "layout");
}

export async function updatePlanAction(formData: FormData) {
  updatePlan(id.parse(formData.get("id")), planSchema.parse(Object.fromEntries(formData)));
  revalidatePath("/", "layout");
}

export async function setPlanStatusAction(formData: FormData) {
  setPlanStatus(id.parse(formData.get("id")), z.enum(["active", "done", "archived"]).parse(formData.get("status")));
  revalidatePath("/", "layout");
}

export async function deletePlanAction(formData: FormData) {
  deletePlan(id.parse(formData.get("id")));
  revalidatePath("/", "layout");
}
