// Phân tích dòng tiền nhiều tháng. Mọi con số tính bằng SQL/JS ở đây — AI chỉ đọc kết quả.
import { getDb } from "./db";
import { daysInMonth, shiftMonth, todayVN } from "./format";
import { listTransactions, type Tx } from "./repo";

export interface CashflowMonth {
  month: string;
  income: number;
  expense: number;
  /** Chi cho danh mục cố định (tiền nhà, hóa đơn...) */
  fixed: number;
  /** Trả nợ các khoản đi vay */
  repay: number;
  /** Tiền vào ví do đi vay / thu nợ */
  debtIn: number;
  /** Tiền ra khỏi ví do cho vay / trả nợ */
  debtOut: number;
  net: number;
  /** Tháng đang diễn ra (số liệu chưa đủ) */
  partial: boolean;
}

export interface CategoryTrend {
  categoryId: number | null;
  name: string;
  icon: string;
  isFixed: boolean;
  values: number[];
  total: number;
  /** Trung bình các tháng trước tháng tham chiếu (không tính tháng đang diễn ra) */
  avg: number;
  /** Trung bình mọi tháng đã trọn có dữ liệu trong kỳ (dùng để lập ngân sách) */
  fullAvg: number;
  /** Tháng tham chiếu: tháng hiện tại (ước tính cả tháng) hoặc tháng cuối kỳ */
  reference: number;
  changePct: number | null;
  anomaly: boolean;
}

export interface WalletFlow {
  walletId: number;
  name: string;
  color: string;
  income: number;
  expense: number;
  transferIn: number;
  transferOut: number;
  debtIn: number;
  debtOut: number;
}

export interface Cashflow {
  months: CashflowMonth[];
  totals: { income: number; expense: number; net: number; fixed: number; repay: number; savingsRate: number | null };
  /** Trung bình / tháng, chỉ tính các tháng đã trọn và có dữ liệu */
  averages: { income: number; expense: number; fixed: number; repay: number; flexible: number };
  incomeByCategory: { categoryId: number | null; name: string; icon: string; total: number }[];
  walletFlows: WalletFlow[];
  categoryTrends: CategoryTrend[];
  topExpenses: Tx[];
}

export function monthRange(endMonth: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => shiftMonth(endMonth, i - count + 1));
}

export function getCashflow(userId: number, months: string[]): Cashflow {
  const db = getDb();
  const start = `${months[0]}-01`;
  const end = `${shiftMonth(months[months.length - 1], 1)}-01`;
  const today = todayVN();
  const currentMonth = today.slice(0, 7);

  const monthly = db
    .prepare(
      `SELECT substr(t.occurred_on, 1, 7) AS month,
         SUM(CASE WHEN t.type = 'income' AND t.debt_id IS NULL THEN t.amount ELSE 0 END) AS income,
         SUM(CASE WHEN t.type = 'expense' AND t.debt_id IS NULL THEN t.amount ELSE 0 END) AS expense,
         SUM(CASE WHEN t.type = 'expense' AND t.debt_id IS NULL AND c.is_fixed = 1 THEN t.amount ELSE 0 END) AS fixed,
         SUM(CASE WHEN t.type = 'expense' AND d.direction = 'borrow' THEN t.amount ELSE 0 END) AS repay,
         SUM(CASE WHEN t.type = 'income' AND t.debt_id IS NOT NULL THEN t.amount ELSE 0 END) AS debtIn,
         SUM(CASE WHEN t.type = 'expense' AND t.debt_id IS NOT NULL THEN t.amount ELSE 0 END) AS debtOut
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN debts d ON d.id = t.debt_id
       WHERE t.user_id = ? AND t.occurred_on >= ? AND t.occurred_on < ?
       GROUP BY month`,
    )
    .all(userId, start, end) as Omit<CashflowMonth, "net" | "partial">[];
  const byMonth = new Map(monthly.map((m) => [m.month, m]));

  const monthRows: CashflowMonth[] = months.map((month) => {
    const m = byMonth.get(month) ?? { month, income: 0, expense: 0, fixed: 0, repay: 0, debtIn: 0, debtOut: 0 };
    return { ...m, net: m.income - m.expense, partial: month === currentMonth };
  });

  // Các tháng trước khi bắt đầu dùng app không có dữ liệu → không tính vào trung bình
  const first = (db.prepare("SELECT MIN(occurred_on) AS d FROM transactions WHERE user_id = ?").get(userId) as { d: string | null }).d;
  const firstMonth = first?.slice(0, 7) ?? currentMonth;
  const full = monthRows.filter((m) => !m.partial && m.month >= firstMonth);
  const sum = (rows: CashflowMonth[], k: keyof CashflowMonth) => rows.reduce((s, r) => s + (r[k] as number), 0);
  const avg = (k: keyof CashflowMonth) => (full.length ? Math.round(sum(full, k) / full.length) : 0);

  const totals = {
    income: sum(monthRows, "income"),
    expense: sum(monthRows, "expense"),
    net: sum(monthRows, "net"),
    fixed: sum(monthRows, "fixed"),
    repay: sum(monthRows, "repay"),
    savingsRate: null as number | null,
  };
  totals.savingsRate = totals.income > 0 ? Math.round((totals.net / totals.income) * 100) : null;

  const averages = {
    income: avg("income"),
    expense: avg("expense"),
    fixed: avg("fixed"),
    repay: avg("repay"),
    flexible: avg("expense") - avg("fixed"),
  };

  const incomeByCategory = db
    .prepare(
      `SELECT t.category_id AS categoryId, COALESCE(c.name, 'Chưa phân loại') AS name, COALESCE(c.icon, '❔') AS icon,
         SUM(t.amount) AS total
       FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.user_id = ? AND t.type = 'income' AND t.debt_id IS NULL AND t.occurred_on >= ? AND t.occurred_on < ?
       GROUP BY t.category_id ORDER BY total DESC`,
    )
    .all(userId, start, end) as Cashflow["incomeByCategory"];

  const walletFlows = db
    .prepare(
      `SELECT w.id AS walletId, w.name, w.color,
         COALESCE(SUM(CASE WHEN t.wallet_id = w.id AND t.type = 'income' AND t.debt_id IS NULL THEN t.amount END), 0) AS income,
         COALESCE(SUM(CASE WHEN t.wallet_id = w.id AND t.type = 'expense' AND t.debt_id IS NULL THEN t.amount END), 0) AS expense,
         COALESCE(SUM(CASE WHEN t.to_wallet_id = w.id THEN t.amount END), 0) AS transferIn,
         COALESCE(SUM(CASE WHEN t.wallet_id = w.id AND t.type = 'transfer' THEN t.amount END), 0) AS transferOut,
         COALESCE(SUM(CASE WHEN t.wallet_id = w.id AND t.type = 'income' AND t.debt_id IS NOT NULL THEN t.amount END), 0) AS debtIn,
         COALESCE(SUM(CASE WHEN t.wallet_id = w.id AND t.type = 'expense' AND t.debt_id IS NOT NULL THEN t.amount END), 0) AS debtOut
       FROM wallets w
       LEFT JOIN transactions t ON (t.wallet_id = w.id OR t.to_wallet_id = w.id)
         AND t.occurred_on >= ? AND t.occurred_on < ?
       WHERE w.user_id = ?
       GROUP BY w.id ORDER BY w.sort, w.id`,
    )
    .all(start, end, userId) as WalletFlow[];

  // Xu hướng từng danh mục chi
  const catRows = db
    .prepare(
      `SELECT t.category_id AS categoryId, COALESCE(c.name, 'Chưa phân loại') AS name, COALESCE(c.icon, '❔') AS icon,
         COALESCE(c.is_fixed, 0) AS isFixed, substr(t.occurred_on, 1, 7) AS month, SUM(t.amount) AS total
       FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.user_id = ? AND t.type = 'expense' AND t.debt_id IS NULL AND t.occurred_on >= ? AND t.occurred_on < ?
       GROUP BY t.category_id, month`,
    )
    .all(userId, start, end) as { categoryId: number | null; name: string; icon: string; isFixed: number; month: string; total: number }[];

  const monthIndex = new Map(months.map((m, i) => [m, i]));
  const partialIdx = months.indexOf(currentMonth);
  // Ước tính cả tháng cho tháng đang diễn ra (cần ít nhất 5 ngày để đỡ nhiễu)
  const elapsed = Number(today.slice(8, 10));
  const projectFactor = partialIdx >= 0 && elapsed >= 5 ? daysInMonth(currentMonth) / elapsed : null;

  const trends = new Map<string, CategoryTrend>();
  for (const r of catRows) {
    const key = String(r.categoryId);
    let t = trends.get(key);
    if (!t) {
      t = {
        categoryId: r.categoryId,
        name: r.name,
        icon: r.icon,
        isFixed: r.isFixed === 1,
        values: months.map(() => 0),
        total: 0,
        avg: 0,
        fullAvg: 0,
        reference: 0,
        changePct: null,
        anomaly: false,
      };
      trends.set(key, t);
    }
    t.values[monthIndex.get(r.month)!] = r.total;
    t.total += r.total;
  }

  const refIdx = partialIdx >= 0 ? partialIdx : months.length - 1;
  for (const t of trends.values()) {
    const past = t.values.filter((_, i) => i !== refIdx && i !== partialIdx && months[i] >= firstMonth);
    const fullValues = t.values.filter((_, i) => i !== partialIdx && months[i] >= firstMonth);
    t.fullAvg = fullValues.length ? Math.round(fullValues.reduce((sum, v) => sum + v, 0) / fullValues.length) : 0;
    t.avg = past.length ? Math.round(past.reduce((s, v) => s + v, 0) / past.length) : 0;
    const raw = t.values[refIdx];
    // Khoản cố định (tiền nhà, hóa đơn) trả 1 lần/tháng → không ước tính theo tốc độ chi
    const project = refIdx === partialIdx && projectFactor && !t.isFixed;
    t.reference = project ? Math.round(raw * projectFactor) : raw;
    t.changePct = t.avg > 0 ? Math.round(((t.reference - t.avg) / t.avg) * 100) : null;
    // Tháng đang diễn ra mà chưa đủ 5 ngày thì chưa đủ căn cứ để báo bất thường
    const enoughData = refIdx !== partialIdx || projectFactor !== null;
    t.anomaly = enoughData && t.avg > 0 && t.reference > t.avg * 1.3 && t.reference - t.avg >= 200_000;
  }

  const topExpenses = listTransactions(userId, {
    type: "expense",
    plainOnly: true,
    dateFrom: start,
    dateTo: end,
    order: "amount",
    limit: 5,
  });

  return {
    months: monthRows,
    totals,
    averages,
    incomeByCategory,
    walletFlows,
    categoryTrends: [...trends.values()].sort((a, b) => b.total - a.total),
    topExpenses,
  };
}
