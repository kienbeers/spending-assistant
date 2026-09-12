import { BellRing } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { CategoryBars, DailyBars } from "@/components/charts";
import { MonthSwitcher } from "@/components/month-switcher";
import { TxEditor } from "@/components/tx-editor";
import { TxList } from "@/components/tx-list";
import { addDays, formatVND, isValidMonth, todayVN } from "@/lib/format";
import { getEditorContext, getMonthSummary, getRecurring, getWallets, listTransactions } from "@/lib/repo";
import { requireUserId } from "@/lib/session";

export default async function Home({ searchParams }: PageProps<"/">) {
  await connection();
  const userId = await requireUserId();
  const sp = await searchParams;
  const today = todayVN();
  const month = typeof sp.m === "string" && isValidMonth(sp.m) ? sp.m : today.slice(0, 7);

  // Khoản định kỳ quá hạn hoặc sắp tới trong 5 ngày (chỉ khi đang xem tháng này)
  const reminders =
    month === today.slice(0, 7)
      ? getRecurring(userId).filter(
          (r) => r.active && !r.doneThisMonth && r.nextDate !== null && r.nextDate <= addDays(today, 5),
        )
      : [];

  const summary = getMonthSummary(userId, month);
  const wallets = getWallets(userId);
  const recent = listTransactions(userId, { month, limit: 6 });
  // Tổng số dư = tiền thật còn trong các ví/tài khoản (không trừ dư nợ thẻ tín dụng)
  const totalBalance = wallets.filter((w) => w.kind !== "credit").reduce((s, w) => s + w.balance, 0);
  const cardDebt = wallets.filter((w) => w.kind === "credit").reduce((s, w) => s + w.used, 0);
  const net = summary.income - summary.expense;
  const change =
    summary.prevExpense > 0 ? Math.round(((summary.expense - summary.prevExpense) / summary.prevExpense) * 100) : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <MonthSwitcher month={month} basePath="/" />
        <Link href="/vi" className="text-right text-[13px] leading-tight text-ink-3">
          Tổng số dư
          <span className="block text-[15px] font-semibold text-ink tabular-nums">{formatVND(totalBalance)}</span>
          {cardDebt > 0 && (
            <span className="block text-[12px] text-ink-3 tabular-nums">nợ thẻ −{formatVND(cardDebt)}</span>
          )}
        </Link>
      </div>

      {reminders.length > 0 && (
        <section className="card border-expense/30 p-4">
          <h2 className="mb-2 flex items-center gap-2 font-semibold">
            <BellRing size={18} className="text-expense" /> Cần ghi
          </h2>
          <ul className="divide-y divide-line">
            {reminders.map((r) => (
              <li key={r.id} className="flex items-center gap-3 py-2">
                <span aria-hidden>{r.categoryIcon ?? (r.kind === "income" ? "💵" : "🔁")}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium">
                    {r.kind === "income" && <span className="text-income">+ </span>}
                    {r.name}
                  </span>
                  <span className={`text-[13px] tabular-nums ${r.overdue ? "font-medium text-expense" : "text-ink-3"}`}>
                    {r.overdue
                      ? `Quá hạn ${Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${r.nextDate}T00:00:00Z`)) / 86_400_000)} ngày`
                      : `Ngày ${r.dayOfMonth}`}
                    {r.lastAmount
                      ? ` · lần trước ${formatVND(r.lastAmount)}`
                      : r.amount
                        ? ` · dự kiến ${formatVND(r.amount)}`
                        : r.amountUsd
                          ? ` · ${r.amountUsd} USD`
                          : ""}
                  </span>
                </span>
                <Link
                  href={`/them?dk=${r.id}`}
                  className={`${r.overdue ? "btn-primary" : "btn-ghost"} min-h-9 shrink-0 px-3 text-sm`}
                >
                  Ghi
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <section className="card p-4" aria-label="Nhập nhanh">
            <TxEditor ctx={getEditorContext(userId)} compact />
          </section>

          <section className="card p-4">
            <h2 className="text-[13px] font-medium text-ink-3">Đã chi</h2>
            <p className="mt-0.5 text-[40px] leading-tight font-bold tracking-tight">{formatVND(summary.expense)}</p>
            {change !== null && (
              <p className="text-[13px] text-ink-3">
                <span className={`font-semibold ${change > 0 ? "text-expense" : "text-income"}`}>
                  {change > 0 ? "↑" : change < 0 ? "↓" : ""}
                  {Math.abs(change)}%
                </span>{" "}
                so với {summary.comparedToDay ? `cùng kỳ tháng trước (đến ngày ${summary.comparedToDay})` : "tháng trước"}
              </p>
            )}
            <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-3">
              <div>
                <dt className="text-[13px] text-ink-3">Thu</dt>
                <dd className="text-lg font-semibold text-income tabular-nums">{formatVND(summary.income)}</dd>
              </div>
              <div>
                <dt className="text-[13px] text-ink-3">Còn lại (thu − chi)</dt>
                <dd className={`text-lg font-semibold tabular-nums ${net < 0 ? "text-expense" : ""}`}>
                  {net < 0 ? "−" : ""}
                  {formatVND(Math.abs(net))}
                </dd>
              </div>
            </dl>
          </section>

          <section className="card p-4">
            <h2 className="mb-3 font-semibold">Chi theo ngày</h2>
            <DailyBars month={month} daily={summary.daily} today={today} />
          </section>
        </div>

        <div className="space-y-4">
          <section className="card p-4">
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="font-semibold">Chi theo danh mục</h2>
              <span className="text-[12px] text-ink-3">% tổng · so với tháng trước</span>
            </div>
            <CategoryBars items={summary.byCategory} month={month} total={summary.expense} />
          </section>

          <section className="card overflow-hidden">
            <div className="flex items-baseline justify-between px-4 pt-4 pb-1">
              <h2 className="font-semibold">Gần đây</h2>
              <Link href={`/giao-dich${month !== today.slice(0, 7) ? `?m=${month}` : ""}`} className="text-sm font-medium text-accent">
                Xem tất cả
              </Link>
            </div>
            <TxList txs={recent} grouped={false} from="/" />
          </section>
        </div>
      </div>
    </div>
  );
}
