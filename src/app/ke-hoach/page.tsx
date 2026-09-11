import { ChevronRight, Flag, Plus, Repeat, Target } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import {
  createGoalAction,
  createRecurringAction,
  deleteGoalAction,
  deleteRecurringAction,
  saveExpectedIncomeAction,
  setRecurringActiveAction,
  updateGoalAction,
  updateRecurringAction,
} from "@/app/actions";
import { AiPanel } from "@/components/ai-panel";
import { BudgetEditor } from "@/components/budget-editor";
import { ConfirmButton } from "@/components/confirm-button";
import { getAi } from "@/lib/ai";
import { formatVND, isValidMonth, shiftMonth, todayVN } from "@/lib/format";
import {
  buildPlanFrame,
  EXPECTED_INCOME_KEY,
  getBudgetRows,
  getBudgets,
  getGoals,
  getLatestAiReport,
  type Goal,
} from "@/lib/planning";
import {
  getCategories,
  getNumberSetting,
  getRecurring,
  getWallets,
  type Category,
  type Recurring,
  type Wallet,
} from "@/lib/repo";

export const metadata: Metadata = { title: "Kế hoạch" };

export default async function PlanPage({ searchParams }: PageProps<"/ke-hoach">) {
  await connection();
  const { m } = await searchParams;
  const today = todayVN();
  const current = today.slice(0, 7);
  const next = shiftMonth(current, 1);
  const month = typeof m === "string" && isValidMonth(m) && (m === current || m === next) ? m : current;
  const isCurrent = month === current;

  const frame = buildPlanFrame(month);
  const rows = getBudgetRows(month);
  const previous = [...getBudgets(shiftMonth(month, -1))].map(([categoryId, amount]) => ({ categoryId, amount }));
  const goals = getGoals();
  const declaredIncome = getNumberSetting(EXPECTED_INCOME_KEY);
  const recurring = getRecurring();
  const wallets = getWallets();
  const allCategories = getCategories();
  const cardsWithoutPlan = getWallets().filter((w) => w.kind === "credit" && w.used > 0 && !w.monthlyPayment);
  const ai = getAi();
  const aiStatus = await ai.check();
  const lastReview = getLatestAiReport("review", current);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Kế hoạch chi tiêu</h1>
        <nav className="flex gap-1 rounded-xl bg-surface-2 p-1" aria-label="Tháng">
          {[
            [current, "Tháng này"],
            [next, "Tháng sau"],
          ].map(([value, label]) => (
            <Link
              key={value}
              href={value === current ? "/ke-hoach" : `/ke-hoach?m=${value}`}
              aria-current={value === month ? "page" : undefined}
              className="flex min-h-9 items-center rounded-lg px-3 text-sm font-medium text-ink-3 aria-[current=page]:bg-surface aria-[current=page]:text-ink aria-[current=page]:shadow-sm"
            >
              {label} ({Number(value.slice(5, 7))}/{value.slice(2, 4)})
            </Link>
          ))}
        </nav>
      </div>

      <Link
        href="/muc-tieu"
        className="card flex items-center gap-3 p-4 transition active:bg-surface-2 md:hover:bg-surface-2"
      >
        <Flag size={20} className="shrink-0 text-accent" />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">Mục tiêu & định hướng</span>
          <span className="block text-[13px] text-ink-3">
            Nên trả khoản nào trước, bao giờ hết nợ, và AI định hướng theo mục tiêu của bạn
          </span>
        </span>
        <ChevronRight size={18} className="shrink-0 text-ink-3" />
      </Link>

      <section className="card p-4">
        <h2 className="font-semibold">Tiền có thể chi mỗi tháng</h2>
        <form action={saveExpectedIncomeAction} className="mt-3 flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <label className="label" htmlFor="expected-income">
              Thu nhập hằng tháng {frame.incomeFromSetting ? "(đang dùng số này)" : "(dự phòng khi chưa đủ dữ liệu)"}
            </label>
            <input
              id="expected-income"
              name="expectedIncome"
              inputMode="numeric"
              defaultValue={declaredIncome ?? ""}
              placeholder="vd: 15000000"
              className="field tabular-nums"
            />
          </div>
          <button className="btn-primary">Lưu</button>
        </form>
        {frame.expectedIncome === 0 ? (
          <p className="mt-3 text-[13px] text-ink-3">
            Điền thu nhập hằng tháng ở trên, hoặc ghi lương vào app rồi app tự tính trung bình.
          </p>
        ) : (
          <dl className="mt-3 space-y-1.5 text-[14px] tabular-nums">
            <Line
              label={
                frame.incomeSource === "history"
                  ? "Thu nhập dự kiến (TB 3 tháng)"
                  : frame.incomeSource === "sources"
                    ? `Thu nhập từ ${frame.incomeSources.length} nguồn đã khai`
                    : "Thu nhập hằng tháng (bạn khai)"
              }
              value={frame.expectedIncome}
            />
            {frame.incomeSource === "sources" &&
              frame.incomeSources.map((src) => (
                <div key={src.name} className="flex items-baseline justify-between pl-4 text-[12px] text-ink-3">
                  <dt>
                    · {src.name}
                    {src.dayOfMonth ? ` (ngày ${src.dayOfMonth})` : ""}
                  </dt>
                  <dd>{formatVND(src.amount)}</dd>
                </div>
              ))}
            <Line label="− Trả nợ bắt buộc" value={-frame.debtPayments} href="/no" />
            {cardsWithoutPlan.length > 0 && (
              <p className="text-[12px] text-ink-3">
                Chưa tính {cardsWithoutPlan.map((w) => w.name).join(", ")}: mở{" "}
                <Link href="/vi" className="text-accent">
                  Ví
                </Link>{" "}
                và điền “Trả mỗi tháng” cho thẻ để app trừ vào đây.
              </p>
            )}
            <Line label="− Để dành cho mục tiêu" value={-frame.goalSavings} />
            <div className="flex items-baseline justify-between border-t border-line pt-2 font-semibold">
              <dt>Còn để chi tiêu</dt>
              <dd className={frame.spendable < 0 ? "text-expense" : ""}>
                {frame.spendable < 0 && "−"}
                {formatVND(Math.abs(frame.spendable))}
              </dd>
            </div>
          </dl>
        )}
      </section>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
        <BudgetEditor
          key={month}
          month={month}
          rows={rows}
          spendable={frame.spendable}
          hasIncome={frame.expectedIncome > 0}
          isCurrent={isCurrent}
          suggestions={frame.suggestions}
          previous={previous}
          aiReady={aiStatus.ok}
        />

        {/* Điện thoại: đưa Trợ lý AI & mục tiêu lên trước danh sách ngân sách dài */}
        <div className="order-first space-y-4 lg:order-none">
          <AiPanel month={current} aiStatus={aiStatus} lastReview={lastReview} />

          <section className="card p-4">
            <h2 className="mb-1 flex items-center gap-2 font-semibold">
              <Repeat size={18} className="text-accent" /> Khoản định kỳ
            </h2>
            <p className="mb-3 text-[13px] text-ink-3">
              Gồm <b>nguồn thu</b> (lương, làm thêm) và <b>khoản chi</b> lặp lại hằng tháng mà số tiền thay đổi. App
              nhắc đúng ngày và điền sẵn số của lần trước.
            </p>
            {recurring.length === 0 ? (
              <p className="text-[13px] text-ink-3">Chưa có khoản nào.</p>
            ) : (
              <ul className="divide-y divide-line">
                {[...recurring]
                  .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "income" ? -1 : 1))
                  .map((r) => (
                  <li key={r.id} className="py-2.5">
                    <div className="flex items-center gap-2">
                      <span aria-hidden>{r.categoryIcon ?? (r.kind === "income" ? "💵" : "🔁")}</span>
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate font-medium ${r.active ? "" : "text-ink-3 line-through"}`}>
                          {r.kind === "income" && <span className="text-income">+ </span>}
                          {r.name}
                        </span>
                        <span className="block text-[12px] text-ink-3 tabular-nums">
                          {r.overdue ? (
                            <span className="font-medium text-expense">
                              quá hạn {daysLate(r.nextDate!, today)} ngày (ngày {r.dayOfMonth})
                            </span>
                          ) : r.dayOfMonth ? (
                            `ngày ${r.dayOfMonth}`
                          ) : (
                            "chưa đặt ngày"
                          )}
                          {r.amountUsd ? ` · ${r.amountUsd} USD` : ""}
                          {r.lastAmount
                            ? ` · lần trước ${formatVND(r.lastAmount)}`
                            : r.amount
                              ? ` · dự kiến ${formatVND(r.amount)}`
                              : ""}
                          {r.walletName ? ` · ${r.walletName}` : ""}
                        </span>
                      </span>
                      {r.doneThisMonth ? (
                        <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
                          đã ghi
                        </span>
                      ) : (
                        <Link
                          href={`/them?dk=${r.id}`}
                          className={`${r.overdue ? "btn-primary" : "btn-ghost"} min-h-9 shrink-0 px-3 text-sm`}
                        >
                          Ghi
                        </Link>
                      )}
                    </div>
                    <details className="mt-1">
                      <summary className="cursor-pointer text-[12px] text-ink-3">Sửa</summary>
                      <form action={updateRecurringAction} className="mt-2 space-y-3">
                        <input type="hidden" name="id" value={r.id} />
                        <RecurringFields item={r} categories={allCategories} wallets={wallets} />
                        <div className="flex flex-wrap gap-2">
                          <button className="btn-primary flex-1 text-sm">Lưu</button>
                          <ConfirmButton
                            message={`Xóa khoản định kỳ “${r.name}”? Các giao dịch đã ghi vẫn giữ nguyên.`}
                            formAction={deleteRecurringAction}
                            className="btn-ghost text-sm text-expense"
                          >
                            Xóa
                          </ConfirmButton>
                        </div>
                      </form>
                      <form action={setRecurringActiveAction} className="mt-2">
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="active" value={r.active ? "0" : "1"} />
                        <button className="text-[12px] text-ink-3 underline-offset-2 hover:underline">
                          {r.active ? "Tạm dừng khoản này" : "Bật lại khoản này"}
                        </button>
                      </form>
                    </details>
                  </li>
                ))}
              </ul>
            )}
            <details className="mt-3">
              <summary className="flex min-h-11 cursor-pointer items-center gap-2 font-medium text-accent">
                <Plus size={18} /> Thêm khoản định kỳ
              </summary>
              <form action={createRecurringAction} className="mt-2 space-y-3">
                <RecurringFields categories={allCategories} wallets={wallets} />
                <button className="btn-primary w-full">Thêm khoản</button>
              </form>
            </details>
          </section>

          <section className="card p-4">
            <h2 className="mb-3 flex items-center gap-2 font-semibold">
              <Target size={18} className="text-accent" /> Mục tiêu tiết kiệm
            </h2>
            {goals.length === 0 ? (
              <p className="text-[13px] text-ink-3">Chưa có mục tiêu. Ví dụ: “Quỹ dự phòng 30 triệu trước 12/2026”.</p>
            ) : (
              <ul className="space-y-3">
                {goals.map((g) => (
                  <li key={g.id}>
                    <GoalCard goal={g} />
                  </li>
                ))}
              </ul>
            )}
            <details className="mt-3">
              <summary className="flex min-h-11 cursor-pointer items-center gap-2 font-medium text-accent">
                <Plus size={18} /> Thêm mục tiêu
              </summary>
              <form action={createGoalAction} className="mt-2 space-y-3">
                <GoalFields />
                <button className="btn-primary w-full">Thêm mục tiêu</button>
              </form>
            </details>
          </section>
        </div>
      </div>
    </div>
  );
}

function daysLate(date: string, today: string) {
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000);
}

function Line({ label, value, href }: { label: string; value: number; href?: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-ink-3">{href ? <Link href={href}>{label}</Link> : label}</dt>
      <dd>
        {value < 0 && "−"}
        {formatVND(Math.abs(value))}
      </dd>
    </div>
  );
}

function GoalCard({ goal: g }: { goal: Goal }) {
  const pct = Math.min(100, Math.round((g.savedAmount / g.targetAmount) * 100));
  return (
    <details className="rounded-xl border border-line p-3">
      <summary className="block cursor-pointer">
        <div className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate font-medium">{g.name}</span>
          <span className="text-[13px] text-ink-3 tabular-nums">
            {formatVND(g.savedAmount)} / {formatVND(g.targetAmount)}
          </span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-track" aria-hidden>
          <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-1 text-[12px] text-ink-3">
          {pct}%
          {g.targetDate &&
            ` · hạn ${g.targetDate.slice(8, 10)}/${g.targetDate.slice(5, 7)}/${g.targetDate.slice(0, 4)} · cần để dành ${formatVND(g.monthlyNeeded ?? 0)}/tháng`}
        </p>
      </summary>
      <form action={updateGoalAction} className="mt-3 space-y-3">
        <input type="hidden" name="id" value={g.id} />
        <GoalFields goal={g} />
        <div className="flex gap-2">
          <button className="btn-primary flex-1">Lưu</button>
          <ConfirmButton
            message={`Xóa mục tiêu “${g.name}”?`}
            formAction={deleteGoalAction}
            className="btn-ghost text-expense"
          >
            Xóa
          </ConfirmButton>
        </div>
      </form>
    </details>
  );
}

function GoalFields({ goal }: { goal?: Goal }) {
  const k = goal?.id ?? "new";
  return (
    <>
      <div>
        <label className="label" htmlFor={`g-name-${k}`}>
          Tên mục tiêu
        </label>
        <input id={`g-name-${k}`} name="name" required maxLength={80} defaultValue={goal?.name} className="field" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor={`g-target-${k}`}>
            Số tiền cần
          </label>
          <input
            id={`g-target-${k}`}
            name="targetAmount"
            inputMode="numeric"
            required
            defaultValue={goal?.targetAmount}
            className="field tabular-nums"
          />
        </div>
        <div>
          <label className="label" htmlFor={`g-saved-${k}`}>
            Đã để dành
          </label>
          <input
            id={`g-saved-${k}`}
            name="savedAmount"
            inputMode="numeric"
            defaultValue={goal?.savedAmount ?? 0}
            className="field tabular-nums"
          />
        </div>
      </div>
      <div>
        <label className="label" htmlFor={`g-date-${k}`}>
          Hạn (không bắt buộc)
        </label>
        <input id={`g-date-${k}`} type="date" name="targetDate" defaultValue={goal?.targetDate ?? ""} className="field" />
      </div>
    </>
  );
}

function RecurringFields({
  item,
  categories,
  wallets,
}: {
  item?: Recurring;
  categories: Category[];
  wallets: Wallet[];
}) {
  const k = item?.id ?? "new";
  return (
    <>
      <div className="grid grid-cols-[1fr_auto] gap-3">
        <div>
          <label className="label" htmlFor={`r-name-${k}`}>
            Tên khoản
          </label>
          <input
            id={`r-name-${k}`}
            name="name"
            required
            maxLength={80}
            defaultValue={item?.name}
            placeholder="vd: Claude Pro, tiền điện"
            className="field"
          />
        </div>
        <div className="w-28">
          <label className="label" htmlFor={`r-kind-${k}`}>
            Loại
          </label>
          <select id={`r-kind-${k}`} name="kind" defaultValue={item?.kind ?? "expense"} className="field">
            <option value="expense">Khoản chi</option>
            <option value="income">Nguồn thu</option>
          </select>
        </div>
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-3">
        <div className="w-24">
          <label className="label" htmlFor={`r-day-${k}`}>
            Ngày
          </label>
          <input
            id={`r-day-${k}`}
            name="dayOfMonth"
            type="number"
            min={1}
            max={31}
            defaultValue={item?.dayOfMonth ?? ""}
            className="field"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor={`r-amount-${k}`}>
            Dự kiến (đ)
          </label>
          <input
            id={`r-amount-${k}`}
            name="amount"
            inputMode="numeric"
            defaultValue={item?.amount ?? ""}
            className="field tabular-nums"
          />
        </div>
        <div>
          <label className="label" htmlFor={`r-usd-${k}`}>
            Hoặc theo USD
          </label>
          <input
            id={`r-usd-${k}`}
            name="amountUsd"
            inputMode="decimal"
            defaultValue={item?.amountUsd ?? ""}
            placeholder="vd: 22"
            className="field tabular-nums"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor={`r-cat-${k}`}>
            Danh mục
          </label>
          <select id={`r-cat-${k}`} name="categoryId" defaultValue={item?.categoryId ?? ""} className="field">
            <option value="">— chưa chọn —</option>
            <optgroup label="Khoản chi">
              {categories
                .filter((c) => c.type === "expense")
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.icon} {c.name}
                  </option>
                ))}
            </optgroup>
            <optgroup label="Khoản thu">
              {categories
                .filter((c) => c.type === "income")
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.icon} {c.name}
                  </option>
                ))}
            </optgroup>
          </select>
        </div>
        <div>
          <label className="label" htmlFor={`r-wallet-${k}`}>
            Trả từ ví
          </label>
          <select id={`r-wallet-${k}`} name="walletId" defaultValue={item?.walletId ?? ""} className="field">
            <option value="">— chưa chọn —</option>
            {wallets.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>
      </div>
    </>
  );
}
