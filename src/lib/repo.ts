// Truy vấn & ghi dữ liệu. Chỉ dùng phía server.
import { getDb } from "./db";
import { shiftMonth, todayVN } from "./format";
import type { DebtDirection, TxType } from "./quick-parse";
import type { CategoryType, WalletKind } from "./seed";
import { fold, wordRegex } from "./text";

export interface Wallet {
  id: number;
  name: string;
  kind: WalletKind;
  aliases: string;
  color: string;
  isDefault: boolean;
  /** Thẻ tín dụng: số dư âm = đang nợ thẻ */
  balance: number;
  txCount: number;
  // --- chỉ dùng cho thẻ tín dụng ---
  creditLimit: number | null;
  paymentDay: number | null;
  /** Để trống = thanh toán toàn bộ dư nợ mỗi kỳ */
  monthlyPayment: number | null;
  /** Đã tiêu trong thẻ (số dư âm đổi dấu) */
  used: number;
  /** Còn dùng được = hạn mức − đã tiêu */
  available: number | null;
  /** Ngày thanh toán thẻ kỳ tới */
  nextPaymentDate: string | null;
}

export interface WalletInput {
  name: string;
  kind: WalletKind;
  aliases: string;
  color: string;
  balance: number;
  creditLimit?: number | null;
  paymentDay?: number | null;
  monthlyPayment?: number | null;
}

export interface Category {
  id: number;
  name: string;
  type: CategoryType;
  icon: string;
  /** Khoản chi cố định hằng tháng (tiền nhà, hóa đơn...) */
  isFixed: boolean;
}

export interface Keyword {
  id: number;
  keyword: string;
  categoryId: number;
}

export interface Tx {
  id: number;
  type: TxType;
  amount: number;
  walletId: number;
  walletName: string;
  walletColor: string;
  toWalletId: number | null;
  toWalletName: string | null;
  categoryId: number | null;
  categoryName: string | null;
  categoryIcon: string | null;
  note: string;
  date: string;
  debtId: number | null;
  debtName: string | null;
  debtDirection: DebtDirection | null;
}

export interface TxInput {
  type: TxType;
  amount: number;
  walletId: number;
  toWalletId: number | null;
  categoryId: number | null;
  note: string;
  date: string;
  debtId?: number | null;
  recurringId?: number | null;
}

const monthStart = (month: string) => `${month}-01`;

// --- Ví ----------------------------------------------------------------------

export function getWallets(userId: number): Wallet[] {
  const today = todayVN();
  const rows = getDb()
    .prepare(
      `SELECT w.id, w.name, w.kind, w.aliases, w.color, w.is_default AS isDefault,
         w.credit_limit AS creditLimit, w.payment_day AS paymentDay, w.monthly_payment AS monthlyPayment,
         w.initial_balance
           + COALESCE((SELECT SUM(CASE t.type WHEN 'income' THEN t.amount ELSE -t.amount END)
                       FROM transactions t WHERE t.wallet_id = w.id), 0)
           + COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.to_wallet_id = w.id), 0) AS balance,
         (SELECT COUNT(*) FROM transactions t WHERE t.wallet_id = w.id OR t.to_wallet_id = w.id) AS txCount
       FROM wallets w WHERE w.user_id = ? ORDER BY w.sort, w.id`,
    )
    .all(userId) as (Omit<Wallet, "isDefault" | "used" | "available" | "nextPaymentDate"> & { isDefault: number })[];
  return rows.map((r) => {
    const isCredit = r.kind === "credit";
    const used = isCredit ? Math.max(0, -r.balance) : 0;
    return {
      ...r,
      isDefault: r.isDefault === 1,
      used,
      available: isCredit && r.creditLimit !== null ? r.creditLimit - used : null,
      nextPaymentDate: isCredit ? nextCardPaymentDate(r.paymentDay, today) : null,
    };
  });
}

/** Ngày `day` trong tháng `month`, tự lùi nếu tháng không có ngày đó (31/2 → 28/2) */
function dayInMonth(month: string, day: number | null): string | null {
  if (!day) return null;
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(Math.min(day, last)).padStart(2, "0")}`;
}

/** Ngày thanh toán thẻ kỳ tới: tháng này nếu chưa qua, ngược lại tháng sau. */
function nextCardPaymentDate(day: number | null, today: string): string | null {
  if (!day) return null;
  const onDay = (month: string) => {
    const [y, m] = month.split("-").map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return `${month}-${String(Math.min(day, last)).padStart(2, "0")}`;
  };
  const thisMonth = onDay(today.slice(0, 7));
  return thisMonth >= today ? thisMonth : onDay(shiftMonth(today.slice(0, 7), 1));
}

export function createWallet(userId: number, input: WalletInput) {
  const db = getDb();
  const sort = (db.prepare("SELECT COALESCE(MAX(sort), 0) + 1 AS s FROM wallets WHERE user_id = ?").get(userId) as { s: number }).s;
  db.prepare(
    `INSERT INTO wallets (user_id, name, kind, aliases, color, initial_balance, sort, credit_limit, payment_day, monthly_payment)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    userId,
    input.name,
    input.kind,
    normalizeAliases(input.aliases),
    input.color,
    input.balance,
    sort,
    creditCols(input).limit,
    creditCols(input).day,
    creditCols(input).monthly,
  );
}

/** Hạn mức, ngày thanh toán, trả mỗi tháng chỉ áp dụng cho thẻ tín dụng. */
function creditCols(input: WalletInput) {
  const isCredit = input.kind === "credit";
  return {
    limit: isCredit ? (input.creditLimit ?? null) : null,
    day: isCredit ? (input.paymentDay ?? null) : null,
    monthly: isCredit ? (input.monthlyPayment ?? null) : null,
  };
}

/** Cập nhật ví; `balance` là số dư THỰC TẾ hiện tại → tự tính lại số dư ban đầu. */
export function updateWallet(userId: number, id: number, input: WalletInput) {
  const db = getDb();
  db.transaction(() => {
    const current = getWallets(userId).find((w) => w.id === id);
    if (!current) throw new Error("Không tìm thấy ví");
    const cols = creditCols(input);
    db.prepare(
      `UPDATE wallets SET name = ?, kind = ?, aliases = ?, color = ?,
         initial_balance = initial_balance + ?, credit_limit = ?, payment_day = ?, monthly_payment = ?
       WHERE id = ? AND user_id = ?`,
    ).run(
      input.name,
      input.kind,
      normalizeAliases(input.aliases),
      input.color,
      input.balance - current.balance,
      cols.limit,
      cols.day,
      cols.monthly,
      id,
      userId,
    );
  })();
}

export function setDefaultWallet(userId: number, id: number) {
  getDb().prepare("UPDATE wallets SET is_default = (id = ?) WHERE user_id = ?").run(id, userId);
}

export function deleteWallet(userId: number, id: number) {
  const db = getDb();
  const used = db
    .prepare("SELECT COUNT(*) AS n FROM transactions WHERE user_id = ? AND (wallet_id = ? OR to_wallet_id = ?)")
    .get(userId, id, id) as { n: number };
  if (used.n > 0) throw new Error("Ví đã có giao dịch, không xóa được");
  db.prepare("DELETE FROM wallets WHERE id = ? AND user_id = ?").run(id, userId);
}

function normalizeAliases(aliases: string): string {
  return [...new Set(aliases.split(",").map((a) => fold(a.normalize("NFC")).trim().replace(/\s+/g, " ")))]
    .filter(Boolean)
    .join(", ");
}

// --- Danh mục & từ khóa --------------------------------------------------------

export function getCategories(userId: number): Category[] {
  const rows = getDb()
    .prepare(
      "SELECT id, name, type, icon, is_fixed AS isFixed FROM categories WHERE user_id = ? ORDER BY type DESC, sort, id",
    )
    .all(userId) as (Omit<Category, "isFixed"> & { isFixed: number })[];
  return rows.map((r) => ({ ...r, isFixed: r.isFixed === 1 }));
}

export function setCategoryFixed(userId: number, id: number, isFixed: boolean) {
  getDb().prepare("UPDATE categories SET is_fixed = ? WHERE id = ? AND user_id = ?").run(isFixed ? 1 : 0, id, userId);
}

export function getKeywords(userId: number): Keyword[] {
  return getDb()
    .prepare("SELECT id, keyword, category_id AS categoryId FROM keywords WHERE user_id = ? ORDER BY keyword")
    .all(userId) as Keyword[];
}

export function createCategory(userId: number, input: { name: string; type: CategoryType; icon: string }) {
  const db = getDb();
  const sort = (db.prepare("SELECT COALESCE(MAX(sort), 0) + 1 AS s FROM categories WHERE user_id = ?").get(userId) as { s: number }).s;
  db.prepare("INSERT INTO categories (user_id, name, type, icon, sort) VALUES (?, ?, ?, ?, ?)").run(
    userId,
    input.name,
    input.type,
    input.icon,
    sort,
  );
}

export function updateCategory(userId: number, id: number, input: { name: string; icon: string }) {
  getDb()
    .prepare("UPDATE categories SET name = ?, icon = ? WHERE id = ? AND user_id = ?")
    .run(input.name, input.icon, id, userId);
}

export function deleteCategory(userId: number, id: number) {
  getDb().prepare("DELETE FROM categories WHERE id = ? AND user_id = ?").run(id, userId);
}

export function upsertKeyword(userId: number, keyword: string, categoryId: number) {
  const k = fold(keyword.normalize("NFC")).trim().replace(/\s+/g, " ");
  if (!k) return;
  getDb()
    .prepare(
      `INSERT INTO keywords (user_id, keyword, category_id) VALUES (?, ?, ?)
       ON CONFLICT(user_id, keyword) DO UPDATE SET category_id = excluded.category_id`,
    )
    .run(userId, k, categoryId);
}

export function deleteKeyword(userId: number, id: number) {
  getDb().prepare("DELETE FROM keywords WHERE id = ? AND user_id = ?").run(id, userId);
}

/**
 * Học từ khóa từ ghi chú ngắn: lần sau gõ lại ghi chú đó sẽ tự ra đúng danh mục.
 * Chỉ học khi từ khóa hiện có không cho ra đúng danh mục đã chọn.
 */
export function learnKeyword(userId: number, note: string, categoryId: number) {
  const phrase = fold(note.normalize("NFC")).trim().replace(/\s+/g, " ");
  const words = phrase.split(" ").length;
  if (phrase.length < 2 || words > 4 || /^[\d\s.,]+$/.test(phrase)) return;

  const matches = getKeywords(userId)
    .filter((k) => wordRegex(k.keyword, "").test(phrase))
    .sort((a, b) => b.keyword.length - a.keyword.length);
  if (matches[0]?.categoryId === categoryId) return;
  upsertKeyword(userId, phrase, categoryId);
}

// --- Giao dịch -----------------------------------------------------------------

const TX_SELECT = `
  SELECT t.id, t.type, t.amount, t.wallet_id AS walletId, w.name AS walletName, w.color AS walletColor,
    t.to_wallet_id AS toWalletId, tw.name AS toWalletName,
    t.category_id AS categoryId, c.name AS categoryName, c.icon AS categoryIcon,
    t.note, t.occurred_on AS date,
    t.debt_id AS debtId, d.name AS debtName, d.direction AS debtDirection
  FROM transactions t
  JOIN wallets w ON w.id = t.wallet_id
  LEFT JOIN wallets tw ON tw.id = t.to_wallet_id
  LEFT JOIN categories c ON c.id = t.category_id
  LEFT JOIN debts d ON d.id = t.debt_id`;

export interface TxFilter {
  month?: string;
  walletId?: number;
  categoryId?: number;
  debtId?: number;
  type?: TxType;
  q?: string;
  limit?: number;
  /** Khoảng ngày [dateFrom, dateTo) */
  dateFrom?: string;
  dateTo?: string;
  /** Chỉ giao dịch thu/chi thường (bỏ chuyển ví & nợ) */
  plainOnly?: boolean;
  /** "recent" = mới nhập trước (theo thứ tự tạo), "amount" = số tiền lớn trước */
  order?: "date" | "recent" | "amount";
}

const ORDER_BY = {
  date: "t.occurred_on DESC, t.id DESC",
  recent: "t.id DESC",
  amount: "t.amount DESC, t.occurred_on DESC",
} as const;

export function listTransactions(userId: number, filter: TxFilter = {}): Tx[] {
  const where: string[] = ["t.user_id = ?"];
  const params: (string | number)[] = [userId];
  if (filter.month) {
    where.push("t.occurred_on >= ? AND t.occurred_on < ?");
    params.push(monthStart(filter.month), monthStart(shiftMonth(filter.month, 1)));
  }
  if (filter.walletId) {
    where.push("(t.wallet_id = ? OR t.to_wallet_id = ?)");
    params.push(filter.walletId, filter.walletId);
  }
  if (filter.categoryId) {
    where.push("t.category_id = ?");
    params.push(filter.categoryId);
  }
  if (filter.dateFrom) {
    where.push("t.occurred_on >= ?");
    params.push(filter.dateFrom);
  }
  if (filter.dateTo) {
    where.push("t.occurred_on < ?");
    params.push(filter.dateTo);
  }
  if (filter.plainOnly) where.push("t.debt_id IS NULL AND t.type != 'transfer'");
  if (filter.debtId) {
    where.push("t.debt_id = ?");
    params.push(filter.debtId);
  }
  if (filter.type) {
    where.push("t.type = ?");
    params.push(filter.type);
  }
  const q = filter.q ? fold(filter.q.normalize("NFC")).trim() : "";
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
    where.push(
      "(fold(t.note) LIKE ? ESCAPE '\\' OR fold(c.name) LIKE ? ESCAPE '\\' OR fold(d.name) LIKE ? ESCAPE '\\')",
    );
    params.push(like, like, like);
  }
  const sql = `${TX_SELECT} WHERE ${where.join(" AND ")}
    ORDER BY ${ORDER_BY[filter.order ?? "date"]} LIMIT ?`;
  params.push(filter.limit ?? 1000);
  return getDb().prepare(sql).all(...params) as Tx[];
}

export function getTransaction(userId: number, id: number): Tx | null {
  return (
    (getDb().prepare(`${TX_SELECT} WHERE t.id = ? AND t.user_id = ?`).get(id, userId) as Tx | undefined) ?? null
  );
}

export function insertTransaction(userId: number, input: TxInput): number {
  const r = getDb()
    .prepare(
      `INSERT INTO transactions (user_id, type, amount, wallet_id, to_wallet_id, category_id, note, occurred_on, debt_id, recurring_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(userId, ...txParams(input));
  return Number(r.lastInsertRowid);
}

export function updateTransaction(userId: number, id: number, input: TxInput) {
  getDb()
    .prepare(
      `UPDATE transactions SET type = ?, amount = ?, wallet_id = ?, to_wallet_id = ?, category_id = ?,
         note = ?, occurred_on = ?, debt_id = ?, recurring_id = ? WHERE id = ? AND user_id = ?`,
    )
    .run(...txParams(input), id, userId);
}

export function deleteTransaction(userId: number, id: number) {
  const db = getDb();
  db.transaction(() => {
    const row = db.prepare("SELECT debt_id AS debtId FROM transactions WHERE id = ? AND user_id = ?").get(id, userId) as
      | { debtId: number | null }
      | undefined;
    db.prepare("DELETE FROM transactions WHERE id = ? AND user_id = ?").run(id, userId);
    // Khoản nợ tạo từ ô nhập nhanh mà không còn giao dịch nào → xóa luôn (vd. bấm Hoàn tác)
    if (row?.debtId) {
      db.prepare(
        `DELETE FROM debts WHERE id = ? AND opening_amount = 0
           AND NOT EXISTS (SELECT 1 FROM transactions WHERE debt_id = debts.id)`,
      ).run(row.debtId);
    }
  })();
}

function txParams(t: TxInput) {
  const isTransfer = t.type === "transfer";
  const debtId = isTransfer ? null : (t.debtId ?? null);
  return [
    t.type,
    t.amount,
    t.walletId,
    isTransfer ? t.toWalletId : null,
    isTransfer || debtId ? null : t.categoryId,
    t.note,
    t.date,
    debtId,
    t.recurringId ?? null,
  ] as const;
}

// --- Khoản định kỳ ----------------------------------------------------------------

export interface Recurring {
  id: number;
  name: string;
  /** Khoản thu (nguồn thu nhập) hay khoản chi */
  kind: "expense" | "income";
  amount: number | null;
  amountUsd: number | null;
  categoryId: number | null;
  categoryName: string | null;
  categoryIcon: string | null;
  walletId: number | null;
  walletName: string | null;
  dayOfMonth: number | null;
  note: string;
  active: boolean;
  /** Số tiền lần ghi gần nhất (dùng làm gợi ý vì giá đổi theo tháng) */
  lastAmount: number | null;
  lastDate: string | null;
  /** Đã ghi trong tháng này chưa */
  doneThisMonth: boolean;
  /** Ngày cần ghi tới */
  nextDate: string | null;
  /** Ngày trong tháng này đã qua mà chưa ghi */
  overdue: boolean;
}

export interface RecurringInput {
  name: string;
  kind: "expense" | "income";
  amount: number | null;
  amountUsd: number | null;
  categoryId: number | null;
  walletId: number | null;
  dayOfMonth: number | null;
  note: string;
}

export function getRecurring(userId: number): Recurring[] {
  const today = todayVN();
  const month = today.slice(0, 7);
  const rows = getDb()
    .prepare(
      `SELECT r.id, r.name, r.kind, r.amount, r.amount_usd AS amountUsd, r.category_id AS categoryId,
         c.name AS categoryName, c.icon AS categoryIcon, r.wallet_id AS walletId, w.name AS walletName,
         r.day_of_month AS dayOfMonth, r.note, r.active,
         (SELECT t.amount FROM transactions t WHERE t.recurring_id = r.id ORDER BY t.occurred_on DESC, t.id DESC LIMIT 1) AS lastAmount,
         (SELECT t.occurred_on FROM transactions t WHERE t.recurring_id = r.id ORDER BY t.occurred_on DESC, t.id DESC LIMIT 1) AS lastDate,
         EXISTS (SELECT 1 FROM transactions t WHERE t.recurring_id = r.id AND substr(t.occurred_on, 1, 7) = @month) AS doneThisMonth
       FROM recurring r
       LEFT JOIN categories c ON c.id = r.category_id
       LEFT JOIN wallets w ON w.id = r.wallet_id
       WHERE r.user_id = @userId
       ORDER BY r.active DESC, r.day_of_month IS NULL, r.day_of_month, r.id`,
    )
    .all({ month, userId }) as (Omit<Recurring, "active" | "doneThisMonth" | "nextDate" | "overdue"> & {
    active: number;
    doneThisMonth: number;
  })[];

  return rows.map((r) => {
    const done = r.doneThisMonth === 1;
    // Chưa ghi tháng này thì hạn là ngày của THÁNG NÀY (đã qua = quá hạn); ghi rồi thì nhắc tháng sau
    const thisMonth = dayInMonth(month, r.dayOfMonth);
    const nextDate = done ? dayInMonth(shiftMonth(month, 1), r.dayOfMonth) : thisMonth;
    return {
      ...r,
      active: r.active === 1,
      doneThisMonth: done,
      nextDate,
      overdue: !done && thisMonth !== null && thisMonth < today,
    };
  });
}

/**
 * Tìm khoản định kỳ khớp với ghi chú (vd. "thanh toán tiền nhà" → "Tiền nhà"),
 * chỉ lấy khoản đúng loại (thu/chi), đang bật và chưa ghi trong tháng này.
 */
export function findRecurringByNote(
  userId: number,
  note: string,
  kind: "expense" | "income" = "expense",
): number | null {
  const folded = fold(note.normalize("NFC"));
  if (!folded.trim()) return null;
  const matches = getRecurring(userId)
    .filter((r) => r.active && !r.doneThisMonth && r.kind === kind)
    .map((r) => ({ id: r.id, phrase: fold(r.name.normalize("NFC")).trim() }))
    .filter((r) => r.phrase && wordRegex(r.phrase, "").test(folded))
    .sort((a, b) => b.phrase.length - a.phrase.length);
  return matches[0]?.id ?? null;
}

export function createRecurring(userId: number, input: RecurringInput) {
  const db = getDb();
  const sort = (db.prepare("SELECT COALESCE(MAX(sort), 0) + 1 AS s FROM recurring WHERE user_id = ?").get(userId) as { s: number }).s;
  db.prepare(
    `INSERT INTO recurring (user_id, name, kind, amount, amount_usd, category_id, wallet_id, day_of_month, note, sort)
     VALUES (@userId, @name, @kind, @amount, @amountUsd, @categoryId, @walletId, @dayOfMonth, @note, @sort)`,
  ).run({ ...input, sort, userId });
}

export function updateRecurring(userId: number, id: number, input: RecurringInput) {
  getDb()
    .prepare(
      `UPDATE recurring SET name = @name, kind = @kind, amount = @amount, amount_usd = @amountUsd,
         category_id = @categoryId, wallet_id = @walletId, day_of_month = @dayOfMonth, note = @note
       WHERE id = @id AND user_id = @userId`,
    )
    .run({ ...input, id, userId });
}

export function setRecurringActive(userId: number, id: number, active: boolean) {
  getDb().prepare("UPDATE recurring SET active = ? WHERE id = ? AND user_id = ?").run(active ? 1 : 0, id, userId);
}

export function deleteRecurring(userId: number, id: number) {
  getDb().prepare("DELETE FROM recurring WHERE id = ? AND user_id = ?").run(id, userId);
}

// --- Cài đặt -------------------------------------------------------------------

export function getSetting(userId: number, key: string): string | null {
  return (
    (getDb().prepare("SELECT value FROM settings WHERE user_id = ? AND key = ?").pluck().get(userId, key) as
      | string
      | undefined) ?? null
  );
}

export function setSetting(userId: number, key: string, value: string) {
  getDb()
    .prepare(
      `INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?)
       ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`,
    )
    .run(userId, key, value);
}

export function getNumberSetting(userId: number, key: string): number | null {
  const raw = getSetting(userId, key);
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) ? n : null;
}

// --- Nợ ------------------------------------------------------------------------

export interface Debt {
  id: number;
  direction: DebtDirection;
  name: string;
  aliases: string;
  openingAmount: number;
  interestRate: number | null;
  monthlyPayment: number | null;
  paymentDay: number | null;
  dueDate: string | null;
  note: string;
  /** Tiền trả mỗi tháng chỉ là lãi, không giảm gốc (vay lãi ngoài) */
  paymentIsInterest: boolean;
  closed: boolean;
  createdOn: string;
  /** Tổng nợ = nợ ban đầu + phát sinh thêm */
  total: number;
  paid: number;
  outstanding: number;
  paidThisMonth: number;
  lastActivity: string | null;
  isOpen: boolean;
  /** Kỳ trả góp tới (nếu có lịch trả hằng tháng) */
  nextPaymentDate: string | null;
  /** Số tiền để tất toán: gốc còn lại + kỳ lãi hiện tại (với khoản vay lãi ngoài) */
  payoffAmount: number;
}

export interface DebtInput {
  direction: DebtDirection;
  name: string;
  aliases: string;
  openingAmount: number;
  interestRate: number | null;
  monthlyPayment: number | null;
  paymentDay: number | null;
  dueDate: string | null;
  note: string;
  paymentIsInterest?: boolean;
  createdOn: string;
}

export function getDebts(userId: number): Debt[] {
  const today = todayVN();
  const month = today.slice(0, 7);
  const rows = getDb()
    .prepare(
      `SELECT d.id, d.direction, d.name, d.aliases, d.opening_amount AS openingAmount,
         d.interest_rate AS interestRate, d.monthly_payment AS monthlyPayment, d.payment_day AS paymentDay,
         d.due_date AS dueDate, d.note, d.closed, d.created_on AS createdOn,
         d.payment_is_interest AS paymentIsInterest,
         COALESCE(SUM(CASE WHEN (d.direction = 'lend' AND t.type = 'expense') OR (d.direction = 'borrow' AND t.type = 'income')
                           THEN t.amount END), 0) AS added,
         COALESCE(SUM(CASE WHEN (d.direction = 'lend' AND t.type = 'income') OR (d.direction = 'borrow' AND t.type = 'expense')
                           THEN t.amount END), 0) AS paid,
         COALESCE(SUM(CASE WHEN ((d.direction = 'lend' AND t.type = 'income') OR (d.direction = 'borrow' AND t.type = 'expense'))
                                AND t.occurred_on >= @monthStart THEN t.amount END), 0) AS paidThisMonth,
         MAX(t.occurred_on) AS lastActivity
       FROM debts d LEFT JOIN transactions t ON t.debt_id = d.id
       WHERE d.user_id = @userId
       GROUP BY d.id
       ORDER BY d.closed, d.due_date IS NULL, d.due_date, d.id`,
    )
    .all({ monthStart: monthStart(month), userId }) as (Omit<
    Debt,
    "closed" | "total" | "outstanding" | "isOpen" | "nextPaymentDate" | "paymentIsInterest" | "payoffAmount"
  > & {
    closed: number;
    added: number;
    paymentIsInterest: number;
  })[];

  return rows.map(({ added, ...r }) => {
    const total = r.openingAmount + added;
    const outstanding = total - r.paid;
    const isOpen = r.closed === 0 && outstanding > 0;
    return {
      ...r,
      closed: r.closed === 1,
      paymentIsInterest: r.paymentIsInterest === 1,
      total,
      outstanding,
      isOpen,
      nextPaymentDate: isOpen
        ? nextPaymentDate(r.paymentDay, r.monthlyPayment, r.paidThisMonth, today, r.createdOn)
        : null,
      // Vay lãi ngoài: tất toán = gốc còn lại + tiền lãi kỳ này
      payoffAmount: outstanding + (r.paymentIsInterest === 1 ? (r.monthlyPayment ?? 0) : 0),
    };
  });
}

/**
 * Ngày trả kỳ tới. Sang tháng sau nếu tháng này đã trả đủ, hoặc nếu ngày trả của tháng này
 * đã qua TRƯỚC khi khoản nợ được ghi vào app (kỳ đó coi như đã trả bên ngoài app).
 */
function nextPaymentDate(
  day: number | null,
  monthly: number | null,
  paidThisMonth: number,
  today: string,
  createdOn: string,
) {
  if (!day || !monthly) return null;
  const onDay = (month: string) => {
    const [y, m] = month.split("-").map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return `${month}-${String(Math.min(day, last)).padStart(2, "0")}`;
  };
  const thisMonth = onDay(today.slice(0, 7));
  const paidEnough = paidThisMonth >= monthly;
  const beforeTracking = thisMonth < createdOn;
  return paidEnough || beforeTracking ? onDay(shiftMonth(today.slice(0, 7), 1)) : thisMonth;
}

export function getDebt(userId: number, id: number): Debt | null {
  return getDebts(userId).find((d) => d.id === id) ?? null;
}

export function createDebt(userId: number, input: DebtInput): number {
  const r = getDb()
    .prepare(
      `INSERT INTO debts (user_id, direction, name, aliases, opening_amount, interest_rate, monthly_payment, payment_day,
         due_date, note, created_on, payment_is_interest)
       VALUES (@userId, @direction, @name, @aliases, @openingAmount, @interestRate, @monthlyPayment, @paymentDay,
         @dueDate, @note, @createdOn, @paymentIsInterest)`,
    )
    .run({
      ...input,
      userId,
      aliases: normalizeAliases(input.aliases),
      paymentIsInterest: input.paymentIsInterest ? 1 : 0,
    });
  return Number(r.lastInsertRowid);
}

export function updateDebt(userId: number, id: number, input: Omit<DebtInput, "direction" | "createdOn">) {
  getDb()
    .prepare(
      `UPDATE debts SET name = @name, aliases = @aliases, opening_amount = @openingAmount,
         interest_rate = @interestRate, monthly_payment = @monthlyPayment, payment_day = @paymentDay,
         due_date = @dueDate, note = @note, payment_is_interest = @paymentIsInterest
       WHERE id = @id AND user_id = @userId`,
    )
    .run({
      ...input,
      aliases: normalizeAliases(input.aliases),
      paymentIsInterest: input.paymentIsInterest ? 1 : 0,
      id,
      userId,
    });
}

export function setDebtClosed(userId: number, id: number, closed: boolean) {
  getDb().prepare("UPDATE debts SET closed = ? WHERE id = ? AND user_id = ?").run(closed ? 1 : 0, id, userId);
}

/**
 * Tất toán khoản nợ: ghi trả gốc (gắn khoản nợ) và tiền lãi kỳ này (khoản chi "Lãi vay").
 * Trả cho khoản mình đi vay thì tiền ra khỏi ví; thu nợ người khác thì tiền vào ví.
 */
export function payOffDebt(
  userId: number,
  input: {
    debtId: number;
    walletId: number;
    date: string;
    principal: number;
    interest: number;
  },
): { principalTxId: number | null; interestTxId: number | null } {
  const db = getDb();
  return db.transaction(() => {
    const debt = getDebt(userId, input.debtId);
    if (!debt) throw new Error("Không tìm thấy khoản nợ");
    if (input.principal < 0 || input.interest < 0) throw new Error("Số tiền không hợp lệ");
    if (input.principal > debt.outstanding) throw new Error("Số tiền trả gốc lớn hơn số còn nợ");
    if (input.principal === 0 && input.interest === 0) throw new Error("Nhập số tiền cần trả");

    let principalTxId: number | null = null;
    if (input.principal > 0) {
      principalTxId = insertTransaction(userId, {
        type: debt.direction === "borrow" ? "expense" : "income",
        amount: input.principal,
        walletId: input.walletId,
        toWalletId: null,
        categoryId: null,
        note: debt.direction === "borrow" ? `trả gốc ${debt.name}` : `thu nợ ${debt.name}`,
        date: input.date,
        debtId: debt.id,
      });
    }

    let interestTxId: number | null = null;
    if (input.interest > 0) {
      const category = db
        .prepare("SELECT id FROM categories WHERE user_id = ? AND name = 'Lãi vay' AND type = 'expense'")
        .pluck()
        .get(userId) as number | undefined;
      interestTxId = insertTransaction(userId, {
        type: "expense",
        amount: input.interest,
        walletId: input.walletId,
        toWalletId: null,
        categoryId: category ?? null,
        note: `lãi vay ${debt.name}`,
        date: input.date,
      });
    }
    return { principalTxId, interestTxId };
  })();
}

/** Xóa khoản nợ cùng các giao dịch gắn với nó (để số dư ví không bị lệch). */
export function deleteDebt(userId: number, id: number) {
  const db = getDb();
  db.transaction(() => {
    db.prepare("DELETE FROM transactions WHERE debt_id = ? AND user_id = ?").run(id, userId);
    db.prepare("DELETE FROM debts WHERE id = ? AND user_id = ?").run(id, userId);
  })();
}

// --- Thống kê ------------------------------------------------------------------

export interface MonthSummary {
  income: number;
  expense: number;
  /** Chi tháng trước, tính cùng kỳ (đến cùng ngày) nếu đang xem tháng hiện tại */
  prevExpense: number;
  comparedToDay: number | null;
  byCategory: { categoryId: number | null; name: string; icon: string; total: number; prevTotal: number }[];
  daily: { date: string; total: number }[];
}

export function getMonthSummary(userId: number, month: string): MonthSummary {
  const db = getDb();
  const start = monthStart(month);
  const end = monthStart(shiftMonth(month, 1));
  const prevStart = monthStart(shiftMonth(month, -1));

  const today = todayVN();
  const isCurrent = today.slice(0, 7) === month;
  const comparedToDay = isCurrent ? Number(today.slice(8, 10)) : null;
  // Cận trên của kỳ so sánh ở tháng trước (không bao gồm)
  const prevEnd = comparedToDay
    ? `${prevStart.slice(0, 8)}${String(comparedToDay + 1).padStart(2, "0")}`
    : start;
  const prevCut = prevEnd < start ? prevEnd : start;

  const totals = db
    .prepare(
      `SELECT type, SUM(amount) AS total FROM transactions
       WHERE user_id = ? AND occurred_on >= ? AND occurred_on < ? AND type != 'transfer' AND debt_id IS NULL
       GROUP BY type`,
    )
    .all(userId, start, end) as { type: TxType; total: number }[];

  const prevExpense = (
    db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) AS total FROM transactions
         WHERE user_id = ? AND type = 'expense' AND debt_id IS NULL AND occurred_on >= ? AND occurred_on < ?`,
      )
      .get(userId, prevStart, prevCut) as { total: number }
  ).total;

  const byCategory = db
    .prepare(
      `SELECT t.category_id AS categoryId, COALESCE(c.name, 'Chưa phân loại') AS name, COALESCE(c.icon, '❔') AS icon,
         SUM(CASE WHEN t.occurred_on >= @start THEN t.amount ELSE 0 END) AS total,
         SUM(CASE WHEN t.occurred_on < @prevCut THEN t.amount ELSE 0 END) AS prevTotal
       FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.user_id = @userId AND t.type = 'expense' AND t.debt_id IS NULL
         AND t.occurred_on >= @prevStart AND t.occurred_on < @end
       GROUP BY t.category_id
       HAVING total > 0
       ORDER BY total DESC`,
    )
    .all({ start, end, prevStart, prevCut, userId }) as MonthSummary["byCategory"];

  const daily = db
    .prepare(
      `SELECT occurred_on AS date, SUM(amount) AS total FROM transactions
       WHERE user_id = ? AND type = 'expense' AND debt_id IS NULL AND occurred_on >= ? AND occurred_on < ?
       GROUP BY occurred_on`,
    )
    .all(userId, start, end) as MonthSummary["daily"];

  return {
    income: totals.find((t) => t.type === "income")?.total ?? 0,
    expense: totals.find((t) => t.type === "expense")?.total ?? 0,
    prevExpense,
    comparedToDay,
    byCategory,
    daily,
  };
}

// --- Dữ liệu cho form nhập -----------------------------------------------------

/** Dữ liệu tối thiểu gửi xuống client để đọc câu nhập nhanh. `withDebtId`: kèm cả khoản nợ đã đóng (khi sửa). */
export function getEditorContext(userId: number, withDebtId?: number | null) {
  return {
    wallets: getWallets(userId).map(({ id, name, kind, aliases, color, isDefault }) => ({
      id,
      name,
      kind,
      aliases,
      color,
      isDefault,
    })),
    categories: getCategories(userId),
    keywords: getKeywords(userId).map(({ keyword, categoryId }) => ({ keyword, categoryId })),
    debts: getDebts(userId)
      .filter((d) => d.isOpen || d.id === withDebtId)
      .map(({ id, name, aliases, direction, outstanding, monthlyPayment, payoffAmount, paymentIsInterest }) => ({
        id,
        name,
        aliases,
        direction,
        outstanding,
        monthlyPayment,
        payoffAmount,
        paymentIsInterest,
      })),
  };
}
