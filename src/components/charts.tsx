import Link from "next/link";
import { daysInMonth, formatCompact, formatVND } from "@/lib/format";
import type { MonthSummary } from "@/lib/repo";

/** Cột chi tiêu theo ngày trong tháng (1 chuỗi dữ liệu → không cần chú giải). */
export function DailyBars({ month, daily, today }: { month: string; daily: MonthSummary["daily"]; today: string }) {
  const n = daysInMonth(month);
  const byDay = new Map(daily.map((d) => [Number(d.date.slice(8, 10)), d.total]));
  const values = Array.from({ length: n }, (_, i) => byDay.get(i + 1) ?? 0);
  const max = Math.max(...values, 0);
  const peakDay = values.indexOf(max) + 1;
  const todayDay = today.slice(0, 7) === month ? Number(today.slice(8, 10)) : null;

  if (max === 0) {
    return <p className="py-10 text-center text-sm text-ink-3">Chưa có khoản chi nào trong tháng.</p>;
  }

  return (
    <figure>
      <div className="relative">
        {/* Đường mốc cao nhất (mảnh, chìm) */}
        <div className="absolute inset-x-0 top-5 border-t border-line" aria-hidden />
        <span className="absolute top-0 right-0 text-[11px] text-ink-3 tabular-nums" aria-hidden>
          {formatCompact(max)}
        </span>
        <ol className="flex h-36 items-end gap-[2px] pt-5" aria-label="Chi tiêu theo ngày">
          {values.map((v, i) => {
            const day = i + 1;
            const future = todayDay !== null && day > todayDay;
            const label = `Ngày ${day}: ${formatVND(v)}`;
            return (
              <li key={day} className="group relative flex h-full flex-1 items-end justify-center">
                <button
                  type="button"
                  aria-label={label}
                  disabled={future}
                  className="flex h-full w-full items-end justify-center outline-none"
                >
                  <span
                    className={`block w-full max-w-6 rounded-t-[4px] ${
                      day === todayDay ? "bg-accent" : "bg-accent/55"
                    } group-hover:bg-accent group-focus-within:bg-accent`}
                    style={{ height: v > 0 ? `max(${(v / max) * 100}%, 3px)` : 0 }}
                  />
                </button>
                {v > 0 && (
                  <span
                    role="tooltip"
                    className={`pointer-events-none absolute bottom-full z-10 mb-1 hidden rounded-lg bg-ink px-2 py-1 text-xs whitespace-nowrap text-bg tabular-nums shadow group-focus-within:block group-hover:block ${
                      day < n / 3 ? "left-0" : day > (2 * n) / 3 ? "right-0" : "left-1/2 -translate-x-1/2"
                    }`}
                  >
                    {label}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-ink-3 tabular-nums" aria-hidden>
        <span>1</span>
        <span>{Math.ceil(n / 2)}</span>
        <span>{n}</span>
      </div>
      <figcaption className="mt-2 text-[13px] text-ink-3">
        Ngày chi nhiều nhất: <span className="font-medium text-ink-2">ngày {peakDay}</span> · {formatVND(max)}
      </figcaption>
    </figure>
  );
}

/** Thanh ngang chi theo danh mục, so với cùng kỳ tháng trước. */
export function CategoryBars({
  items,
  month,
  total,
}: {
  items: MonthSummary["byCategory"];
  month: string;
  total: number;
}) {
  if (items.length === 0) {
    return <p className="py-6 text-center text-sm text-ink-3">Chưa có dữ liệu.</p>;
  }
  const max = items[0].total;

  return (
    <ul className="space-y-1">
      {items.map((c) => {
        const pct = total > 0 ? Math.round((c.total / total) * 100) : 0;
        const diff = c.prevTotal > 0 ? Math.round(((c.total - c.prevTotal) / c.prevTotal) * 100) : null;
        const href = `/giao-dich?m=${month}&loai=expense${c.categoryId ? `&dm=${c.categoryId}` : ""}`;
        return (
          <li key={c.categoryId ?? "none"}>
            <Link
              href={href}
              className="-mx-2 block rounded-xl px-2 py-2 transition active:bg-surface-2 md:hover:bg-surface-2"
            >
              <div className="flex items-baseline gap-2 text-[14px]">
                <span aria-hidden>{c.icon}</span>
                <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                <span className="font-semibold tabular-nums">{formatVND(c.total)}</span>
              </div>
              <div className="mt-1.5 flex items-center gap-3">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-track">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${(c.total / max) * 100}%` }} />
                </div>
                <span className="w-24 shrink-0 text-right text-[12px] text-ink-3 tabular-nums">
                  {pct}%
                  {diff !== null && diff !== 0 && (
                    <span className={diff > 0 ? "text-expense" : "text-income"}>
                      {" "}
                      {diff > 0 ? "↑" : "↓"}
                      {Math.abs(diff)}%
                    </span>
                  )}
                </span>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

const monthShort = (m: string) => `T${Number(m.slice(5, 7))}`;

/** Cột đôi Thu – Chi theo tháng (2 chuỗi → có chú giải). */
export function MonthlyFlowChart({
  months,
}: {
  months: { month: string; income: number; expense: number; net: number; partial: boolean }[];
}) {
  const max = Math.max(...months.flatMap((m) => [m.income, m.expense]), 0);
  if (max === 0) return <p className="py-10 text-center text-sm text-ink-3">Chưa có dữ liệu thu/chi.</p>;
  const yearChanges = new Set(months.map((m) => m.month.slice(0, 4))).size > 1;

  return (
    <figure>
      <div className="mb-3 flex items-center gap-4 text-[13px] text-ink-2">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-series-in" aria-hidden /> Thu
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-series-out" aria-hidden /> Chi
        </span>
        <span className="ml-auto text-[11px] text-ink-3 tabular-nums">cao nhất {formatCompact(max)}</span>
      </div>
      <div className="relative">
        <div className="absolute inset-x-0 top-0 border-t border-line" aria-hidden />
        <ol className="flex h-44 items-end gap-1.5 border-b border-line">
          {months.map((m, i) => {
            const label = `${monthShort(m.month)}/${m.month.slice(0, 4)}${m.partial ? " (đang diễn ra)" : ""}: Thu ${formatVND(m.income)} · Chi ${formatVND(m.expense)} · Còn ${m.net < 0 ? "−" : ""}${formatVND(Math.abs(m.net))}`;
            return (
              <li key={m.month} className="group relative flex h-full flex-1 items-end justify-center">
                <button type="button" aria-label={label} className="flex h-full w-full items-end justify-center gap-[2px] outline-none">
                  {[
                    { v: m.income, cls: "bg-series-in" },
                    { v: m.expense, cls: "bg-series-out" },
                  ].map((b, j) => (
                    <span
                      key={j}
                      className={`block w-full max-w-5 rounded-t-[4px] ${b.cls} ${m.partial ? "opacity-60" : ""}`}
                      style={{ height: b.v > 0 ? `max(${(b.v / max) * 100}%, 3px)` : 0 }}
                    />
                  ))}
                </button>
                <span
                  role="tooltip"
                  className={`pointer-events-none absolute bottom-full z-10 mb-1 hidden w-max max-w-56 rounded-lg bg-ink px-2 py-1 text-xs text-bg shadow group-focus-within:block group-hover:block ${
                    i < months.length / 3 ? "left-0" : i >= (2 * months.length) / 3 ? "right-0" : "left-1/2 -translate-x-1/2"
                  }`}
                >
                  {label}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
      <ol className="mt-1.5 flex gap-1.5 text-center text-[11px] text-ink-3 tabular-nums" aria-hidden>
        {months.map((m) => (
          <li key={m.month} className="flex-1 truncate">
            {monthShort(m.month)}
            {yearChanges && m.month.endsWith("-01") ? `/${m.month.slice(2, 4)}` : ""}
            {m.partial ? "*" : ""}
          </li>
        ))}
      </ol>
      {months.some((m) => m.partial) && (
        <figcaption className="mt-2 text-[12px] text-ink-3">* tháng đang diễn ra, số liệu chưa đủ.</figcaption>
      )}
    </figure>
  );
}

/** Cột nhỏ không trục cho bảng xu hướng. */
export function Sparkbars({ values, highlightLast = false }: { values: number[]; highlightLast?: boolean }) {
  const max = Math.max(...values, 0);
  return (
    <span className="flex h-6 w-full items-end gap-[2px]" aria-hidden>
      {values.map((v, i) => (
        <span
          key={i}
          className={`block flex-1 rounded-t-[2px] ${highlightLast && i === values.length - 1 ? "bg-accent" : "bg-accent/45"}`}
          style={{ height: max > 0 && v > 0 ? `max(${(v / max) * 100}%, 2px)` : 0 }}
        />
      ))}
    </span>
  );
}

/** Danh sách thanh ngang đơn giản (1 chuỗi). */
export function HBarList({ items }: { items: { key: string; label: string; icon?: string; value: number; sub?: string }[] }) {
  if (items.length === 0) return <p className="py-6 text-center text-sm text-ink-3">Chưa có dữ liệu.</p>;
  const max = Math.max(...items.map((i) => i.value));
  return (
    <ul className="space-y-3">
      {items.map((it) => (
        <li key={it.key}>
          <div className="flex items-baseline gap-2 text-[14px]">
            {it.icon && <span aria-hidden>{it.icon}</span>}
            <span className="min-w-0 flex-1 truncate font-medium">{it.label}</span>
            <span className="font-semibold tabular-nums">{formatVND(it.value)}</span>
          </div>
          <div className="mt-1.5 flex items-center gap-3">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-track">
              <div className="h-full rounded-full bg-accent" style={{ width: `${max > 0 ? (it.value / max) * 100 : 0}%` }} />
            </div>
            {it.sub && <span className="shrink-0 text-[12px] text-ink-3 tabular-nums">{it.sub}</span>}
          </div>
        </li>
      ))}
    </ul>
  );
}
