// Tính chiến lược trả nợ bằng code (không dùng AI) để con số luôn đúng.
// Ý tưởng: trả đủ khoản bắt buộc mỗi tháng, tiền dư dồn vào khoản đắt nhất trước.
import { shiftMonth, todayVN } from "./format";
import { getDebts, getWallets, type Debt, type Wallet } from "./repo";

export interface PlanDebt {
  key: string;
  name: string;
  kind: "interest-only" | "installment" | "card" | "free";
  /** Số còn phải trả */
  outstanding: number;
  /** Tiền bắt buộc mỗi tháng (trả góp, hoặc tiền lãi với vay lãi ngoài) */
  required: number;
  /** Lãi phải trả mỗi tháng nếu chưa xóa được khoản này */
  monthlyInterest: number;
  /** Lãi quy đổi %/năm, null nếu không có lãi */
  yearlyRate: number | null;
  /** Trả thêm vào đây có giảm được gốc không */
  canPrepay: boolean;
}

export interface PlanStep {
  month: string;
  /** Khoản được dồn tiền trả trong tháng này */
  focus: string | null;
  extraPaid: number;
  interestPaid: number;
  /** Các khoản xóa xong trong tháng này */
  cleared: string[];
  remaining: number;
}

export interface DebtStrategy {
  debts: PlanDebt[];
  /** Bắt buộc trả mỗi tháng (trả góp + lãi + thẻ) */
  requiredMonthly: number;
  /** Tiền lãi đang mất mỗi tháng */
  interestMonthly: number;
  totalOutstanding: number;
  /** Thứ tự dồn tiền trả thêm */
  priority: PlanDebt[];
  steps: PlanStep[];
  /** Tháng dự kiến hết nợ (null = quá 10 năm với mức dồn hiện tại) */
  debtFreeMonth: string | null;
  monthsToDebtFree: number | null;
  /** Tổng tiền lãi phải trả từ giờ tới khi hết nợ */
  totalInterest: number;
  /** Số tiền dồn thêm mỗi tháng dùng để tính */
  extraPerMonth: number;
}

/** Lãi quy đổi %/năm: lấy lãi suất đã khai, hoặc suy ra từ tiền lãi hằng tháng */
export function yearlyRate(d: Debt): number | null {
  if (d.interestRate !== null && d.interestRate > 0) return d.interestRate;
  if (d.paymentIsInterest && d.monthlyPayment && d.outstanding > 0) {
    return Math.round(((d.monthlyPayment * 12) / d.outstanding) * 100);
  }
  return null;
}

function toPlanDebt(d: Debt): PlanDebt {
  const rate = yearlyRate(d);
  if (d.paymentIsInterest) {
    return {
      key: `d${d.id}`,
      name: d.name,
      kind: "interest-only",
      outstanding: d.outstanding,
      required: d.monthlyPayment ?? 0,
      monthlyInterest: d.monthlyPayment ?? 0,
      yearlyRate: rate,
      canPrepay: true, // trả gốc là hết luôn tiền lãi hằng tháng
    };
  }
  if (d.monthlyPayment) {
    return {
      key: `d${d.id}`,
      name: d.name,
      kind: "installment",
      outstanding: d.outstanding,
      required: Math.min(d.monthlyPayment, d.outstanding),
      monthlyInterest: 0, // lãi đã nằm trong số phải trả hằng tháng
      yearlyRate: rate,
      canPrepay: false, // trả trước không giảm được số đã chốt trong app
    };
  }
  return {
    key: `d${d.id}`,
    name: d.name,
    kind: "free",
    outstanding: d.outstanding,
    required: 0,
    monthlyInterest: 0,
    yearlyRate: rate,
    canPrepay: true,
  };
}

function cardToPlanDebt(w: Wallet): PlanDebt {
  return {
    key: `w${w.id}`,
    name: w.name,
    kind: "card",
    outstanding: w.used,
    required: Math.min(w.monthlyPayment ?? 0, w.used),
    monthlyInterest: 0,
    yearlyRate: null,
    canPrepay: true,
  };
}

const RANK: Record<PlanDebt["kind"], number> = { "interest-only": 0, card: 1, installment: 2, free: 3 };

/** Thứ tự dồn tiền: lãi cao trước; cùng loại thì khoản nhỏ trước cho nhanh xong */
function priorityOrder(debts: PlanDebt[]): PlanDebt[] {
  return debts
    .filter((d) => d.canPrepay && d.outstanding > 0)
    .sort(
      (a, b) =>
        (b.yearlyRate ?? 0) - (a.yearlyRate ?? 0) || RANK[a.kind] - RANK[b.kind] || a.outstanding - b.outstanding,
    );
}

const MAX_MONTHS = 120;

/** Đọc dữ liệu thật rồi tính chiến lược */
export function buildDebtStrategy(userId: number, extraPerMonth: number): DebtStrategy {
  const open = getDebts(userId).filter((d) => d.isOpen && d.direction === "borrow");
  const cards = getWallets(userId).filter((w) => w.kind === "credit" && w.used > 0);
  return computeStrategy([...open.map(toPlanDebt), ...cards.map(cardToPlanDebt)], extraPerMonth);
}

/** Phần tính toán thuần, không đụng DB (dễ kiểm tra) */
export function computeStrategy(debts: PlanDebt[], extraPerMonth: number, startMonth = todayVN().slice(0, 7)): DebtStrategy {
  const requiredMonthly = debts.reduce((s, d) => s + d.required, 0);
  const interestMonthly = debts.reduce((s, d) => s + d.monthlyInterest, 0);
  const totalOutstanding = debts.reduce((s, d) => s + d.outstanding, 0);
  const priority = priorityOrder(debts);

  // Mô phỏng từng tháng
  const state = debts.map((d) => ({ ...d }));
  const steps: PlanStep[] = [];
  let totalInterest = 0;
  let month = startMonth;
  let monthsToDebtFree: number | null = null;

  for (let i = 0; i < MAX_MONTHS; i++) {
    const alive = state.filter((d) => d.outstanding > 0);
    if (alive.length === 0) {
      monthsToDebtFree = i;
      break;
    }
    const interestPaid = alive.reduce((s, d) => s + d.monthlyInterest, 0);
    totalInterest += interestPaid;

    // Khoản trả góp & thẻ: trừ dần theo số bắt buộc
    for (const d of alive) {
      if (d.kind === "installment" || d.kind === "card") {
        d.outstanding = Math.max(0, d.outstanding - Math.min(d.required, d.outstanding));
      }
    }
    // Tiền dư dồn vào khoản đắt nhất còn lại
    let extra = extraPerMonth;
    const cleared: string[] = [];
    let focus: string | null = null;
    for (const d of priorityOrder(state)) {
      if (extra <= 0) break;
      const pay = Math.min(extra, d.outstanding);
      if (pay <= 0) continue;
      focus ??= d.name;
      d.outstanding -= pay;
      extra -= pay;
    }
    for (const d of state) {
      if (d.outstanding === 0 && !steps.some((s) => s.cleared.includes(d.name))) {
        const wasAlive = alive.some((a) => a.key === d.key);
        if (wasAlive) cleared.push(d.name);
      }
    }
    steps.push({
      month,
      focus,
      extraPaid: extraPerMonth - extra,
      interestPaid,
      cleared,
      remaining: state.reduce((s, d) => s + d.outstanding, 0),
    });
    month = shiftMonth(month, 1);
  }

  return {
    debts: debts.sort((a, b) => (b.yearlyRate ?? 0) - (a.yearlyRate ?? 0) || b.outstanding - a.outstanding),
    requiredMonthly,
    interestMonthly,
    totalOutstanding,
    priority,
    steps,
    debtFreeMonth: monthsToDebtFree === null ? null : steps[steps.length - 1]?.month ?? null,
    monthsToDebtFree,
    totalInterest,
    extraPerMonth,
  };
}
