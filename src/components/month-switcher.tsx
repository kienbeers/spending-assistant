import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { monthLabel, shiftMonth, todayVN } from "@/lib/format";

/** ‹ Tháng 9/2026 › — giữ nguyên các tham số lọc khác trên URL. */
export function MonthSwitcher({
  month,
  basePath,
  params = {},
}: {
  month: string;
  basePath: string;
  params?: Record<string, string | undefined>;
}) {
  const current = todayVN().slice(0, 7);
  const href = (m: string) => {
    const sp = new URLSearchParams();
    for (const [k, val] of Object.entries(params)) if (val) sp.set(k, val);
    if (m !== current) sp.set("m", m);
    const qs = sp.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };
  const next = shiftMonth(month, 1);
  const btn = "flex size-11 items-center justify-center rounded-full text-ink-2 transition active:bg-surface-2 md:hover:bg-surface-2";

  return (
    <div className="flex items-center gap-1">
      <Link href={href(shiftMonth(month, -1))} className={btn} aria-label="Tháng trước">
        <ChevronLeft size={22} />
      </Link>
      <h1 className="min-w-32 text-center text-lg font-semibold tabular-nums">{monthLabel(month)}</h1>
      {next <= current ? (
        <Link href={href(next)} className={btn} aria-label="Tháng sau">
          <ChevronRight size={22} />
        </Link>
      ) : (
        <span className={`${btn} opacity-30`} aria-hidden>
          <ChevronRight size={22} />
        </span>
      )}
    </div>
  );
}
