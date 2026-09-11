import { ArrowRightLeft, HandCoins } from "lucide-react";
import Link from "next/link";
import { dayLabel, formatVND } from "@/lib/format";
import type { Tx } from "@/lib/repo";

const DEBT_LABEL = {
  lend: { expense: "Cho vay", income: "Thu nợ" },
  borrow: { income: "Đi vay", expense: "Trả nợ" },
} as const;

export function debtLabel(tx: Pick<Tx, "type" | "debtDirection">): string | null {
  if (!tx.debtDirection || tx.type === "transfer") return null;
  return DEBT_LABEL[tx.debtDirection][tx.type as "income" | "expense"] ?? null;
}

export function TxAmount({
  tx,
  className = "",
}: {
  tx: Pick<Tx, "type" | "amount"> & { debtId?: number | null };
  className?: string;
}) {
  // Giao dịch nợ: vẫn hiện dấu tiền vào/ra ví nhưng màu trung tính (không phải thu/chi)
  const color = tx.debtId
    ? "text-transfer"
    : tx.type === "income"
      ? "text-income"
      : tx.type === "expense"
        ? "text-expense"
        : "text-transfer";
  const sign = tx.type === "income" ? "+" : tx.type === "expense" ? "−" : "";
  return (
    <span className={`font-semibold whitespace-nowrap tabular-nums ${color} ${className}`}>
      {sign}
      {formatVND(tx.amount)}
    </span>
  );
}

function TxRow({ tx, from }: { tx: Tx; from?: string }) {
  const isTransfer = tx.type === "transfer";
  const debt = debtLabel(tx);
  const title =
    tx.note || (isTransfer ? "Chuyển tiền" : debt ? `${debt} ${tx.debtName}` : (tx.categoryName ?? "Chưa phân loại"));
  const sub = isTransfer
    ? `${tx.walletName} → ${tx.toWalletName}`
    : debt
      ? `${debt} · ${tx.debtName} · ${tx.walletName}`
      : `${tx.categoryName ?? "Chưa phân loại"} · ${tx.walletName}`;
  const href = `/giao-dich/${tx.id}${from ? `?from=${encodeURIComponent(from)}` : ""}`;

  return (
    <li>
      <Link href={href} className="flex min-h-14 items-center gap-3 px-3 py-2.5 transition active:bg-surface-2 md:hover:bg-surface-2">
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-lg"
          aria-hidden
        >
          {isTransfer ? (
            <ArrowRightLeft size={18} className="text-transfer" />
          ) : debt ? (
            <HandCoins size={18} className="text-transfer" />
          ) : (
            (tx.categoryIcon ?? "❔")
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium">{title}</span>
          <span className="flex items-center gap-1.5 truncate text-[13px] text-ink-3">
            <span className="size-2 shrink-0 rounded-full" style={{ background: tx.walletColor }} />
            <span className="truncate">{sub}</span>
          </span>
        </span>
        <TxAmount tx={tx} className="text-[15px]" />
      </Link>
    </li>
  );
}

/** Danh sách giao dịch nhóm theo ngày, kèm tổng chi mỗi ngày. */
export function TxList({ txs, from, grouped = true }: { txs: Tx[]; from?: string; grouped?: boolean }) {
  if (txs.length === 0) {
    return <p className="px-3 py-8 text-center text-sm text-ink-3">Chưa có giao dịch nào.</p>;
  }
  if (!grouped) {
    return (
      <ul className="divide-y divide-line">
        {txs.map((tx) => (
          <TxRow key={tx.id} tx={tx} from={from} />
        ))}
      </ul>
    );
  }

  const groups = new Map<string, Tx[]>();
  for (const tx of txs) groups.set(tx.date, [...(groups.get(tx.date) ?? []), tx]);

  return (
    <div className="space-y-4">
      {[...groups].map(([date, items]) => {
        const spent = items.filter((t) => t.type === "expense" && !t.debtId).reduce((s, t) => s + t.amount, 0);
        return (
          <section key={date} className="card overflow-hidden">
            <h3 className="flex items-baseline justify-between border-b border-line bg-surface-2/50 px-3 py-2 text-[13px]">
              <span className="font-semibold text-ink-2">{dayLabel(date)}</span>
              {spent > 0 && <span className="text-ink-3 tabular-nums">Chi {formatVND(spent)}</span>}
            </h3>
            <ul className="divide-y divide-line">
              {items.map((tx) => (
                <TxRow key={tx.id} tx={tx} from={from} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
