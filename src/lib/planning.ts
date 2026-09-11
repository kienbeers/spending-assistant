// Ngân sách, mục tiêu tiết kiệm và bản tóm tắt số liệu cho AI.
import { getCashflow, monthRange } from "./analytics";
import { getDb } from "./db";
import { addDays, daysInMonth, formatVND, shiftMonth, todayVN } from "./format";
import { getCategories, getDebts, getMonthSummary, getNumberSetting, getRecurring, getWallets } from "./repo";

// --- Ngân sách -------------------------------------------------------------------

export function getBudgets(month: string): Map<number, number> {
  const rows = getDb()
    .prepare("SELECT category_id AS categoryId, amount FROM budgets WHERE month = ?")
    .all(month) as { categoryId: number; amount: number }[];
  return new Map(rows.map((r) => [r.categoryId, r.amount]));
}

/** Ghi đè toàn bộ ngân sách của tháng (bỏ các danh mục có số 0). */
export function saveBudgets(month: string, items: { categoryId: number; amount: number }[]) {
  const db = getDb();
  db.transaction(() => {
    db.prepare("DELETE FROM budgets WHERE month = ?").run(month);
    const ins = db.prepare("INSERT INTO budgets (month, category_id, amount) VALUES (?, ?, ?)");
    for (const it of items) if (it.amount > 0) ins.run(month, it.categoryId, it.amount);
  })();
}

export interface BudgetRow {
  categoryId: number;
  name: string;
  icon: string;
  isFixed: boolean;
  budget: number;
  spent: number;
  /** Ước tính cả tháng theo tốc độ chi hiện tại (chỉ tháng đang diễn ra) */
  projected: number;
  avg3: number;
}

export function getBudgetRows(month: string): BudgetRow[] {
  const today = todayVN();
  const budgets = getBudgets(month);
  const summary = getMonthSummary(month);
  const spentBy = new Map(summary.byCategory.map((c) => [c.categoryId, c.total]));
  // Trung bình các tháng trước `month` (bỏ tháng đang diễn ra và tháng chưa dùng app)
  const trends = getCashflow(monthRange(shiftMonth(month, -1), 3)).categoryTrends;
  const avgBy = new Map(trends.map((t) => [t.categoryId, t.fullAvg]));

  const isCurrent = today.slice(0, 7) === month;
  const elapsed = Number(today.slice(8, 10));
  const factor = isCurrent && elapsed >= 5 ? daysInMonth(month) / elapsed : 1;

  return getCategories()
    .filter((c) => c.type === "expense")
    .map((c) => {
      const spent = spentBy.get(c.id) ?? 0;
      return {
        categoryId: c.id,
        name: c.name,
        icon: c.icon,
        isFixed: c.isFixed,
        budget: budgets.get(c.id) ?? 0,
        spent,
        // Khoản cố định thường trả 1 lần/tháng → không nhân theo tốc độ
        projected: c.isFixed ? spent : Math.round(spent * factor),
        avg3: avgBy.get(c.id) ?? 0,
      };
    });
}

// --- Mục tiêu tiết kiệm ------------------------------------------------------------

export interface Goal {
  id: number;
  name: string;
  targetAmount: number;
  savedAmount: number;
  targetDate: string | null;
  /** Số tiền cần để dành mỗi tháng để kịp hạn */
  monthlyNeeded: number | null;
  monthsLeft: number | null;
}

export function getGoals(): Goal[] {
  const today = todayVN();
  const rows = getDb()
    .prepare(
      `SELECT id, name, target_amount AS targetAmount, saved_amount AS savedAmount, target_date AS targetDate
       FROM goals ORDER BY target_date IS NULL, target_date, id`,
    )
    .all() as Omit<Goal, "monthlyNeeded" | "monthsLeft">[];
  return rows.map((g) => {
    if (!g.targetDate) return { ...g, monthlyNeeded: null, monthsLeft: null };
    const [ty, tm] = g.targetDate.split("-").map(Number);
    const [cy, cm] = today.split("-").map(Number);
    const monthsLeft = Math.max(1, (ty - cy) * 12 + (tm - cm));
    const remaining = Math.max(0, g.targetAmount - g.savedAmount);
    return { ...g, monthsLeft, monthlyNeeded: Math.ceil(remaining / monthsLeft / 10_000) * 10_000 };
  });
}

export function createGoal(input: { name: string; targetAmount: number; savedAmount: number; targetDate: string | null }) {
  getDb()
    .prepare(
      "INSERT INTO goals (name, target_amount, saved_amount, target_date, created_on) VALUES (?, ?, ?, ?, ?)",
    )
    .run(input.name, input.targetAmount, input.savedAmount, input.targetDate, todayVN());
}

export function updateGoal(
  id: number,
  input: { name: string; targetAmount: number; savedAmount: number; targetDate: string | null },
) {
  getDb()
    .prepare("UPDATE goals SET name = ?, target_amount = ?, saved_amount = ?, target_date = ? WHERE id = ?")
    .run(input.name, input.targetAmount, input.savedAmount, input.targetDate, id);
}

export function deleteGoal(id: number) {
  getDb().prepare("DELETE FROM goals WHERE id = ?").run(id);
}

// --- Khung kế hoạch tính sẵn -------------------------------------------------------------

export const EXPECTED_INCOME_KEY = "expected_income";

export interface PlanFrame {
  month: string;
  /** Thu nhập dự kiến: trung bình 3 tháng đã trọn, không có thì lấy số bạn tự khai */
  expectedIncome: number;
  /** true = lấy từ số bạn tự khai (chưa đủ dữ liệu lịch sử) */
  incomeFromSetting: boolean;
  /** Nguồn của con số thu nhập dự kiến */
  incomeSource: "history" | "sources" | "declared" | "none";
  /** Các nguồn thu định kỳ đã khai */
  incomeSources: { name: string; amount: number; dayOfMonth: number | null }[];
  debtPayments: number;
  goalSavings: number;
  /** Tiền còn lại cho chi tiêu = thu nhập − trả nợ − để dành cho mục tiêu */
  spendable: number;
  /** Ngân sách gợi ý theo quy tắc (trung bình 3 tháng, co lại nếu vượt khả năng) */
  suggestions: { categoryId: number; name: string; isFixed: boolean; avg3: number; amount: number }[];
}

const roundUp = (n: number, step: number) => Math.ceil(n / step) * step;

export function buildPlanFrame(month: string): PlanFrame {
  const cf = getCashflow(monthRange(shiftMonth(todayVN().slice(0, 7), -1), 3));
  const loanPayments = getDebts()
    .filter((d) => d.isOpen && d.direction === "borrow")
    .reduce((s, d) => s + Math.min(d.monthlyPayment ?? 0, d.outstanding), 0);
  // Thẻ tín dụng: chỉ trừ khi đã đặt "trả mỗi tháng" cho thẻ (để trống thì không đoán hộ)
  const cardPayments = getWallets()
    .filter((w) => w.kind === "credit" && w.used > 0 && w.monthlyPayment)
    .reduce((s, w) => s + Math.min(w.monthlyPayment ?? 0, w.used), 0);
  const debtPayments = loanPayments + cardPayments;
  const goalSavings = getGoals().reduce((s, g) => s + (g.monthlyNeeded ?? 0), 0);
  const declared = getNumberSetting(EXPECTED_INCOME_KEY) ?? 0;
  // Tổng các nguồn thu định kỳ (lương, làm thêm...), lấy số lần gần nhất nếu có
  const sources = getRecurring().filter((r) => r.kind === "income" && r.active);
  const sourcesTotal = sources.reduce((t, r) => t + (r.lastAmount ?? r.amount ?? 0), 0);
  // Ưu tiên số liệu thật, sau đó tổng các nguồn, cuối cùng là số bạn tự khai
  const incomeSource: PlanFrame["incomeSource"] =
    cf.averages.income > 0 ? "history" : sourcesTotal > 0 ? "sources" : declared > 0 ? "declared" : "none";
  const expectedIncome =
    incomeSource === "history" ? cf.averages.income : incomeSource === "sources" ? sourcesTotal : declared;
  const incomeFromSetting = incomeSource === "declared";
  const spendable = expectedIncome - debtPayments - goalSavings;

  const cats = getCategories().filter((c) => c.type === "expense");
  const avgBy = new Map(cf.categoryTrends.map((t) => [t.categoryId, t.fullAvg]));
  let suggestions = cats
    .map((c) => {
      const avg3 = avgBy.get(c.id) ?? 0;
      return { categoryId: c.id, name: c.name, isFixed: c.isFixed, avg3, amount: roundUp(avg3, c.isFixed ? 10_000 : 50_000) };
    })
    .filter((s) => s.amount > 0);

  // Vượt khả năng chi → giữ khoản cố định, co khoản linh hoạt (tối đa còn 70%)
  const total = suggestions.reduce((s, x) => s + x.amount, 0);
  if (expectedIncome > 0 && total > spendable) {
    const fixed = suggestions.filter((s) => s.isFixed).reduce((s, x) => s + x.amount, 0);
    const flexible = total - fixed;
    const ratio = flexible > 0 ? Math.max(0.7, (spendable - fixed) / flexible) : 1;
    suggestions = suggestions.map((s) => (s.isFixed ? s : { ...s, amount: roundUp(s.amount * ratio, 50_000) }));
  }

  return {
    month,
    expectedIncome,
    incomeFromSetting,
    incomeSource,
    incomeSources: sources.map((r) => ({
      name: r.name,
      amount: r.lastAmount ?? r.amount ?? 0,
      dayOfMonth: r.dayOfMonth,
    })),
    debtPayments,
    goalSavings,
    spendable,
    suggestions,
  };
}

// --- Bản tóm tắt số liệu gửi AI -----------------------------------------------------------

const m = (n: number) => formatVND(n);
const monthVN = (month: string) => `${Number(month.slice(5, 7))}/${month.slice(0, 4)}`;

/**
 * Viết toàn bộ số liệu (đã tính sẵn) thành văn bản ngắn. AI chỉ được dùng các con số trong đây,
 * nhờ vậy model nhỏ chạy local không phải tự cộng trừ.
 */
export function buildFinancialSnapshot(month: string): string {
  const today = todayVN();
  const isCurrent = today.slice(0, 7) === month;
  const lines: string[] = [];
  const s = getMonthSummary(month);
  const rows = getBudgetRows(month);
  const cf = getCashflow(monthRange(month, 4));
  const history = cf.months.filter((x) => x.month !== month);
  const withData = history.filter((x) => x.income + x.expense > 0);

  lines.push(`# Tháng ${monthVN(month)}${isCurrent ? ` (đang diễn ra, đã qua ${Number(today.slice(8, 10))}/${daysInMonth(month)} ngày)` : ""}`);
  lines.push(`- Thu nhập: ${m(s.income)}`);
  lines.push(`- Chi tiêu: ${m(s.expense)}`);
  const projectedTotal = rows.reduce((t, r) => t + r.projected, 0);
  if (isCurrent) lines.push(`- Ước tính tổng chi cả tháng nếu giữ tốc độ hiện tại: ${m(projectedTotal)}`);
  lines.push(`- Còn lại (thu − chi): ${s.income - s.expense < 0 ? "âm " : ""}${m(Math.abs(s.income - s.expense))}`);

  if (withData.length) {
    lines.push("", "# Các tháng trước");
    for (const h of withData) {
      lines.push(`- ${monthVN(h.month)}: thu ${m(h.income)}, chi ${m(h.expense)}, trả nợ ${m(h.repay)}, còn ${m(h.net - h.repay)}`);
    }
  }

  lines.push("", "# Chi theo danh mục tháng này (đã chi | ước tính cả tháng | TB 3 tháng trước | ngân sách)");
  for (const r of rows.filter((r) => r.spent || r.avg3 || r.budget)) {
    const over = r.budget && r.projected > r.budget ? ` → DỰ KIẾN VƯỢT ngân sách ${m(r.projected - r.budget)}` : "";
    lines.push(
      `- ${r.name}${r.isFixed ? " (cố định)" : ""}: ${m(r.spent)} | ${m(r.projected)} | ${m(r.avg3)} | ${r.budget ? m(r.budget) : "chưa đặt"}${over}`,
    );
  }

  const anomalies = cf.categoryTrends.filter((t) => t.anomaly);
  if (anomalies.length) {
    lines.push("", "# Khoản tăng bất thường (so với trung bình)");
    for (const a of anomalies) lines.push(`- ${a.name}: ${m(a.reference)}, cao hơn ${a.changePct}% (TB ${m(a.avg)})`);
  }

  const debts = getDebts().filter((d) => d.isOpen);
  const borrow = debts.filter((d) => d.direction === "borrow");
  const lend = debts.filter((d) => d.direction === "lend");
  if (debts.length) {
    lines.push("", `# Tổng quan nợ: bạn đang nợ ${m(borrow.reduce((t, d) => t + d.outstanding, 0))}; người khác nợ bạn ${m(lend.reduce((t, d) => t + d.outstanding, 0))}`);
    if (borrow.length) lines.push("", "# Bạn ĐANG NỢ (tiền bạn phải trả)");
    for (const d of borrow) {
      const parts = [`còn nợ ${m(d.outstanding)}/${m(d.total)}`];
      if (d.monthlyPayment) {
        parts.push(
          d.paymentIsInterest
            ? `mỗi tháng trả LÃI ${m(d.monthlyPayment)} (gốc không giảm)`
            : `trả ${m(d.monthlyPayment)}/tháng`,
        );
      }
      const rate =
        d.interestRate ??
        (d.paymentIsInterest && d.monthlyPayment && d.outstanding > 0
          ? Math.round(((d.monthlyPayment * 12) / d.outstanding) * 100)
          : null);
      if (rate !== null) parts.push(`lãi khoảng ${rate}%/năm`);
      if (d.paymentIsInterest && d.monthlyPayment) parts.push(`trả hết cần ${m(d.payoffAmount)} (gốc + lãi kỳ này)`);
      if (d.nextPaymentDate) parts.push(`kỳ tới ${d.nextPaymentDate}`);
      if (d.dueDate) parts.push(`hạn ${d.dueDate}${d.dueDate < today ? " (ĐÃ QUÁ HẠN)" : ""}`);
      lines.push(`- Khoản vay "${d.name}": ${parts.join(", ")}`);
    }
    if (lend.length) lines.push("", "# Người khác NỢ BẠN (tiền bạn sẽ được nhận lại, KHÔNG phải nợ của bạn)");
    for (const d of lend) {
      lines.push(
        `- ${d.name} còn nợ bạn ${m(d.outstanding)}${d.dueDate ? `, hẹn trả ${d.dueDate}${d.dueDate < today ? " (người đó ĐÃ TRẢ CHẬM)" : ""}` : ""}`,
      );
    }
  }

  const cards = getWallets().filter((w) => w.kind === "credit");
  if (cards.length) {
    lines.push("", "# Thẻ tín dụng (tiền đã tiêu bằng thẻ ĐÃ tính trong phần chi tiêu ở trên)");
    for (const w of cards) {
      const parts = [`dư nợ phải trả ${m(w.used)}`];
      if (w.creditLimit !== null) parts.push(`hạn mức ${m(w.creditLimit)}`, `còn dùng được ${m(w.available ?? 0)}`);
      if (w.monthlyPayment) parts.push(`trả ${m(w.monthlyPayment)}/tháng`);
      else parts.push("trả hết mỗi kỳ");
      if (w.nextPaymentDate) parts.push(`thanh toán ${w.nextPaymentDate}`);
      lines.push(`- ${w.name}: ${parts.join(", ")}`);
    }
  }

  const goals = getGoals();
  if (goals.length) {
    lines.push("", "# Mục tiêu tiết kiệm");
    for (const g of goals) {
      lines.push(
        `- ${g.name}: đã có ${m(g.savedAmount)}/${m(g.targetAmount)}${g.targetDate ? `, hạn ${g.targetDate}, cần để dành ${m(g.monthlyNeeded ?? 0)}/tháng` : ""}`,
      );
    }
  }

  const frame = buildPlanFrame(shiftMonth(month, 1));
  const walletList = getWallets();
  const cashBalance = walletList.filter((w) => w.kind !== "credit").reduce((t, w) => t + w.balance, 0);
  const cardDebt = walletList.filter((w) => w.kind === "credit").reduce((t, w) => t + w.used, 0);
  lines.push("", "# Số liệu đã tính sẵn");
  lines.push(`- Tiền đang có trong các ví: ${m(cashBalance)}`);
  if (cardDebt > 0) lines.push(`- Dư nợ thẻ tín dụng phải trả: ${m(cardDebt)}`);
  lines.push(
    frame.incomeSource === "history"
      ? `- Thu nhập trung bình 3 tháng: ${m(frame.expectedIncome)}`
      : frame.incomeSource === "sources"
        ? `- Thu nhập hằng tháng theo các nguồn đã khai: ${m(frame.expectedIncome)}`
        : `- Thu nhập hằng tháng (bạn tự khai): ${m(frame.expectedIncome)}`,
  );
  for (const src of frame.incomeSources) {
    lines.push(`  · ${src.name}: ${m(src.amount)}${src.dayOfMonth ? ` (ngày ${src.dayOfMonth})` : ""}`);
  }
  lines.push(`- Trả nợ bắt buộc mỗi tháng: ${m(frame.debtPayments)}`);
  lines.push(`- Cần để dành cho mục tiêu mỗi tháng: ${m(frame.goalSavings)}`);
  lines.push(
    `- Hạn mức chi tiêu mỗi tháng = thu nhập − trả nợ − để dành: ${frame.spendable < 0 ? "âm " : ""}${m(Math.abs(frame.spendable))} (đây là số được phép tiêu, KHÔNG phải tiền dư)`,
  );
  if (cf.totals.savingsRate !== null) lines.push(`- Tỷ lệ tiết kiệm 4 tháng gần đây: ${cf.totals.savingsRate}%`);
  if (s.income === 0 && frame.expectedIncome === 0) lines.push("- Chưa ghi nhận khoản thu nhập nào.");
  lines.push(`- Hôm nay: ${today}; tháng sau bắt đầu ${addDays(`${shiftMonth(month, 1)}-01`, 0)}`);

  return lines.join("\n");
}

// --- Kết quả AI đã lưu --------------------------------------------------------------------

export interface AiReport {
  content: string;
  model: string;
  createdAt: string;
}

export function saveAiReport(kind: string, month: string, content: string, model: string) {
  getDb().prepare("INSERT INTO ai_reports (kind, month, content, model) VALUES (?, ?, ?, ?)").run(kind, month, content, model);
}

export function getLatestAiReport(kind: string, month: string): AiReport | null {
  return (
    (getDb()
      .prepare(
        "SELECT content, model, created_at AS createdAt FROM ai_reports WHERE kind = ? AND month = ? ORDER BY id DESC LIMIT 1",
      )
      .get(kind, month) as AiReport | undefined) ?? null
  );
}

export function hasAnyTransactions(): boolean {
  return !!getDb().prepare("SELECT 1 FROM transactions LIMIT 1").get();
}

// --- Kế hoạch mục tiêu --------------------------------------------------------------

export interface Plan {
  id: number;
  title: string;
  goalText: string;
  targetAmount: number | null;
  targetDate: string | null;
  extraPerMonth: number;
  status: "active" | "done" | "archived";
  aiContent: string | null;
  aiModel: string | null;
  aiAt: string | null;
  createdOn: string;
}

export interface PlanInput {
  title: string;
  goalText: string;
  targetAmount: number | null;
  targetDate: string | null;
  extraPerMonth: number;
}

export function getPlans(): Plan[] {
  return getDb()
    .prepare(
      `SELECT id, title, goal_text AS goalText, target_amount AS targetAmount, target_date AS targetDate,
         extra_per_month AS extraPerMonth, status, ai_content AS aiContent, ai_model AS aiModel, ai_at AS aiAt,
         created_on AS createdOn
       FROM plans ORDER BY status, id DESC`,
    )
    .all() as Plan[];
}

export function getPlan(id: number): Plan | null {
  return getPlans().find((p) => p.id === id) ?? null;
}

export function createPlan(input: PlanInput): number {
  const r = getDb()
    .prepare(
      `INSERT INTO plans (title, goal_text, target_amount, target_date, extra_per_month, created_on)
       VALUES (@title, @goalText, @targetAmount, @targetDate, @extraPerMonth, @createdOn)`,
    )
    .run({ ...input, createdOn: todayVN() });
  return Number(r.lastInsertRowid);
}

export function updatePlan(id: number, input: PlanInput) {
  getDb()
    .prepare(
      `UPDATE plans SET title = @title, goal_text = @goalText, target_amount = @targetAmount,
         target_date = @targetDate, extra_per_month = @extraPerMonth WHERE id = @id`,
    )
    .run({ ...input, id });
}

export function setPlanStatus(id: number, status: Plan["status"]) {
  getDb().prepare("UPDATE plans SET status = ? WHERE id = ?").run(status, id);
}

export function deletePlan(id: number) {
  getDb().prepare("DELETE FROM plans WHERE id = ?").run(id);
}

export function savePlanAi(id: number, content: string, model: string) {
  getDb()
    .prepare("UPDATE plans SET ai_content = ?, ai_model = ?, ai_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?")
    .run(content, model, id);
}
