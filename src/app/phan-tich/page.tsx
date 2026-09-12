import { AlertTriangle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { HBarList, MonthlyFlowChart, Sparkbars } from "@/components/charts";
import { TxList } from "@/components/tx-list";
import { getCashflow, monthRange } from "@/lib/analytics";
import { formatVND, todayVN } from "@/lib/format";
import { requireUserId } from "@/lib/session";

export const metadata: Metadata = { title: "Phân tích" };

const RANGES = [3, 6, 12] as const;

function Money({ value, className = "" }: { value: number; className?: string }) {
  return (
    <span className={`tabular-nums ${value < 0 ? "text-expense" : ""} ${className}`}>
      {value < 0 && "−"}
      {formatVND(Math.abs(value))}
    </span>
  );
}

export default async function AnalysisPage({ searchParams }: PageProps<"/phan-tich">) {
  await connection();
  const userId = await requireUserId();
  const { k } = await searchParams;
  const count = RANGES.find((r) => String(r) === k) ?? 6;
  const current = todayVN().slice(0, 7);
  const months = monthRange(current, count);
  const cf = getCashflow(userId, months);
  const { totals, averages } = cf;
  const obligations = averages.fixed + averages.repay;
  const anomalies = cf.categoryTrends.filter((t) => t.anomaly);
  const walletRows = cf.walletFlows.filter(
    (w) => w.income + w.expense + w.transferIn + w.transferOut + w.debtIn + w.debtOut > 0,
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Phân tích dòng tiền</h1>
        <nav className="flex gap-1 rounded-xl bg-surface-2 p-1" aria-label="Khoảng thời gian">
          {RANGES.map((r) => (
            <Link
              key={r}
              href={r === 6 ? "/phan-tich" : `/phan-tich?k=${r}`}
              aria-current={r === count ? "page" : undefined}
              className="flex min-h-9 items-center rounded-lg px-3 text-sm font-medium text-ink-3 aria-[current=page]:bg-surface aria-[current=page]:text-ink aria-[current=page]:shadow-sm"
            >
              {r} tháng
            </Link>
          ))}
        </nav>
      </div>

      <section className="card grid grid-cols-2 gap-x-4 gap-y-3 p-4 sm:grid-cols-4">
        <div>
          <p className="text-[13px] text-ink-3">Tổng thu</p>
          <p className="text-lg font-semibold text-income tabular-nums">{formatVND(totals.income)}</p>
        </div>
        <div>
          <p className="text-[13px] text-ink-3">Tổng chi</p>
          <p className="text-lg font-semibold text-expense tabular-nums">{formatVND(totals.expense)}</p>
        </div>
        <div>
          <p className="text-[13px] text-ink-3">Để dành được</p>
          <p className="text-lg font-semibold">
            <Money value={totals.net} />
          </p>
        </div>
        <div>
          <p className="text-[13px] text-ink-3">Tỷ lệ tiết kiệm</p>
          <p className={`text-lg font-semibold tabular-nums ${(totals.savingsRate ?? 0) < 0 ? "text-expense" : ""}`}>
            {totals.savingsRate === null ? "—" : `${totals.savingsRate}%`}
          </p>
        </div>
      </section>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <section className="card p-4">
            <h2 className="mb-3 font-semibold">Thu – chi theo tháng</h2>
            <MonthlyFlowChart months={cf.months} />
            <div className="-mx-4 mt-4 overflow-x-auto border-t border-line">
              <table className="w-full min-w-md text-right text-[13px] whitespace-nowrap tabular-nums">
                <caption className="sr-only">Bảng thu chi theo tháng</caption>
                <thead className="text-ink-3">
                  <tr>
                    <th scope="col" className="px-4 py-2 text-left font-medium">Tháng</th>
                    <th scope="col" className="px-2 py-2 font-medium">Thu</th>
                    <th scope="col" className="px-2 py-2 font-medium">Chi</th>
                    <th scope="col" className="px-2 py-2 font-medium">Trả nợ</th>
                    <th scope="col" className="px-4 py-2 font-medium">Còn lại</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {[...cf.months]
                    .reverse()
                    .filter((m) => m.income + m.expense + m.repay > 0)
                    .map((m) => (
                    <tr key={m.month}>
                      <th scope="row" className="px-4 py-2 text-left font-medium">
                        <Link href={`/?m=${m.month}`} className="underline-offset-2 hover:underline">
                          {Number(m.month.slice(5, 7))}/{m.month.slice(0, 4)}
                          {m.partial && <span className="text-ink-3">*</span>}
                        </Link>
                      </th>
                      <td className="px-2 py-2">{formatVND(m.income)}</td>
                      <td className="px-2 py-2">{formatVND(m.expense)}</td>
                      <td className="px-2 py-2 text-ink-3">{m.repay ? formatVND(m.repay) : "—"}</td>
                      <td className="px-4 py-2 font-medium">
                        <Money value={m.net - m.repay} />
                      </td>
                    </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card p-4">
            <h2 className="font-semibold">Khoản bắt buộc và khoản linh hoạt</h2>
            <p className="mb-3 text-[13px] text-ink-3">Trung bình mỗi tháng (các tháng đã trọn)</p>
            {averages.income + averages.expense === 0 ? (
              <p className="py-4 text-center text-sm text-ink-3">Cần ít nhất 1 tháng trọn vẹn để tính trung bình.</p>
            ) : (
              <>
                <FlowSplit
                  income={averages.income}
                  parts={[
                    { label: "Chi cố định", value: averages.fixed, cls: "bg-ink-2" },
                    { label: "Trả nợ", value: averages.repay, cls: "bg-ink-3" },
                    { label: "Chi linh hoạt", value: averages.flexible, cls: "bg-accent" },
                  ]}
                />
                <p className="mt-3 text-[13px] text-ink-2">
                  Sau khoản cố định và trả nợ, mỗi tháng còn{" "}
                  <b>
                    <Money value={averages.income - obligations} />
                  </b>{" "}
                  để chi tiêu linh hoạt và để dành.{" "}
                  <Link href="/danh-muc" className="text-accent">
                    Chọn danh mục cố định
                  </Link>
                </p>
              </>
            )}
          </section>

          <section className="card overflow-hidden">
            <h2 className="px-4 pt-4 font-semibold">Xu hướng từng khoản chi</h2>
            <p className="px-4 text-[13px] text-ink-3">
              So sánh {cf.months.some((m) => m.partial) ? "ước tính cả tháng này" : "tháng gần nhất"} với trung bình
              các tháng trước
            </p>
            {cf.categoryTrends.length === 0 ? (
              <p className="py-6 text-center text-sm text-ink-3">Chưa có dữ liệu.</p>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-md text-[13px] tabular-nums">
                  <thead className="text-ink-3">
                    <tr>
                      <th scope="col" className="px-4 py-2 text-left font-medium">Danh mục</th>
                      <th scope="col" className="w-24 px-2 py-2 font-medium">{count} tháng</th>
                      <th scope="col" className="px-2 py-2 text-right font-medium">TB/tháng</th>
                      <th scope="col" className="px-4 py-2 text-right font-medium">Thay đổi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {cf.categoryTrends.map((t) => (
                      <tr key={String(t.categoryId)}>
                        <th scope="row" className="px-4 py-2 text-left font-medium">
                          <span aria-hidden>{t.icon}</span> {t.name}
                        </th>
                        <td className="px-2 py-2">
                          <Sparkbars values={t.values} highlightLast />
                        </td>
                        <td className="px-2 py-2 text-right">{t.avg ? formatVND(t.avg) : "—"}</td>
                        <td
                          className={`px-4 py-2 text-right font-medium ${t.anomaly ? "text-expense" : t.changePct !== null && t.changePct < 0 ? "text-income" : "text-ink-3"}`}
                        >
                          {t.changePct === null ? "—" : `${t.changePct > 0 ? "↑" : t.changePct < 0 ? "↓" : ""}${Math.abs(t.changePct)}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <div className="space-y-4">
          {anomalies.length > 0 && (
            <section className="card border-expense/40 p-4">
              <h2 className="mb-2 flex items-center gap-2 font-semibold">
                <AlertTriangle size={18} className="text-expense" /> Chi tăng bất thường
              </h2>
              <ul className="space-y-1.5 text-[14px]">
                {anomalies.map((t) => (
                  <li key={String(t.categoryId)}>
                    <span aria-hidden>{t.icon}</span> <b>{t.name}</b>: {formatVND(t.reference)}, cao hơn trung bình{" "}
                    <span className="font-semibold text-expense">{t.changePct}%</span> ({formatVND(t.avg)}/tháng)
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="card p-4">
            <h2 className="mb-3 font-semibold">Tiền vào từ đâu</h2>
            <HBarList
              items={cf.incomeByCategory.map((c) => ({
                key: String(c.categoryId),
                label: c.name,
                icon: c.icon,
                value: c.total,
                sub: totals.income ? `${Math.round((c.total / totals.income) * 100)}%` : undefined,
              }))}
            />
          </section>

          <section className="card overflow-hidden">
            <h2 className="px-4 pt-4 font-semibold">Dòng tiền theo ví</h2>
            <p className="px-4 text-[13px] text-ink-3">Gồm cả chuyển ví và nợ, trong {count} tháng</p>
            {walletRows.length === 0 ? (
              <p className="py-6 text-center text-sm text-ink-3">Chưa có dữ liệu.</p>
            ) : (
              <ul className="mt-2 divide-y divide-line">
                {walletRows.map((w) => {
                  const inflow = w.income + w.transferIn + w.debtIn;
                  const outflow = w.expense + w.transferOut + w.debtOut;
                  return (
                    <li key={w.walletId} className="px-4 py-3">
                      <details>
                        <summary className="flex cursor-pointer items-center gap-2">
                          <span className="size-2.5 rounded-full" style={{ background: w.color }} aria-hidden />
                          <span className="min-w-0 flex-1 truncate font-medium">{w.name}</span>
                          <span className="text-[13px] text-ink-3 tabular-nums">
                            +{formatVND(inflow)} / −{formatVND(outflow)}
                          </span>
                        </summary>
                        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 pl-4 text-[13px] tabular-nums">
                          <dt className="text-ink-3">Thu</dt>
                          <dd className="text-right">{formatVND(w.income)}</dd>
                          <dt className="text-ink-3">Chi</dt>
                          <dd className="text-right">{formatVND(w.expense)}</dd>
                          <dt className="text-ink-3">Chuyển đến</dt>
                          <dd className="text-right">{formatVND(w.transferIn)}</dd>
                          <dt className="text-ink-3">Chuyển đi</dt>
                          <dd className="text-right">{formatVND(w.transferOut)}</dd>
                          <dt className="text-ink-3">Vay / thu nợ</dt>
                          <dd className="text-right">{formatVND(w.debtIn)}</dd>
                          <dt className="text-ink-3">Cho vay / trả nợ</dt>
                          <dd className="text-right">{formatVND(w.debtOut)}</dd>
                          <dt className="font-medium">Chênh lệch</dt>
                          <dd className="text-right font-medium">
                            <Money value={inflow - outflow} />
                          </dd>
                        </dl>
                      </details>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="card overflow-hidden">
            <h2 className="px-4 pt-4 pb-1 font-semibold">Khoản chi lớn nhất</h2>
            <TxList txs={cf.topExpenses} grouped={false} from="/phan-tich" />
          </section>
        </div>
      </div>
    </div>
  );
}

function FlowSplit({
  income,
  parts,
}: {
  income: number;
  parts: { label: string; value: number; cls: string }[];
}) {
  const spent = parts.reduce((s, p) => s + p.value, 0);
  const base = Math.max(income, spent);
  const left = income - spent;
  return (
    <div>
      <div className="flex h-4 gap-[2px] overflow-hidden rounded-full bg-track" aria-hidden>
        {parts
          .filter((p) => p.value > 0)
          .map((p) => (
            <span key={p.label} className={`${p.cls} h-full`} style={{ width: `${(p.value / base) * 100}%` }} />
          ))}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px] tabular-nums sm:grid-cols-4">
        {parts.map((p) => (
          <div key={p.label}>
            <dt className="flex items-center gap-1.5 text-ink-3">
              <span className={`size-2.5 rounded-sm ${p.cls}`} aria-hidden /> {p.label}
            </dt>
            <dd className="font-medium">{formatVND(p.value)}</dd>
          </div>
        ))}
        <div>
          <dt className="flex items-center gap-1.5 text-ink-3">
            <span className="size-2.5 rounded-sm bg-track ring-1 ring-line" aria-hidden /> Để dành
          </dt>
          <dd className="font-medium">
            <Money value={left} />
          </dd>
        </div>
      </dl>
    </div>
  );
}
