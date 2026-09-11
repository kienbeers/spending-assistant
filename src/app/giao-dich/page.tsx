import { Download } from "lucide-react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { MonthSwitcher } from "@/components/month-switcher";
import { TxFilters } from "@/components/tx-filters";
import { TxList } from "@/components/tx-list";
import { formatVND, isValidMonth, todayVN } from "@/lib/format";
import type { TxType } from "@/lib/quick-parse";
import { getCategories, getWallets, listTransactions } from "@/lib/repo";

export const metadata: Metadata = { title: "Giao dịch" };

const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
const TX_TYPES: TxType[] = ["expense", "income", "transfer"];

export default async function TransactionsPage({ searchParams }: PageProps<"/giao-dich">) {
  await connection();
  const sp = await searchParams;
  const today = todayVN();
  const month = isValidMonth(str(sp.m) ?? "") ? str(sp.m)! : today.slice(0, 7);
  const type = TX_TYPES.find((t) => t === str(sp.loai));
  const walletId = Number(str(sp.vi)) || undefined;
  const categoryId = Number(str(sp.dm)) || undefined;
  const q = str(sp.q);

  const txs = listTransactions({ month, type, walletId, categoryId, q });
  const expense = txs.filter((t) => t.type === "expense" && !t.debtId).reduce((s, t) => s + t.amount, 0);
  const income = txs.filter((t) => t.type === "income" && !t.debtId).reduce((s, t) => s + t.amount, 0);

  const current = new URLSearchParams();
  for (const [k, v] of Object.entries({ m: str(sp.m), loai: str(sp.loai), vi: str(sp.vi), dm: str(sp.dm), q })) {
    if (v) current.set(k, v);
  }
  const from = `/giao-dich${current.size ? `?${current}` : ""}`;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <MonthSwitcher
          month={month}
          basePath="/giao-dich"
          params={{ loai: str(sp.loai), vi: str(sp.vi), dm: str(sp.dm), q }}
        />
        <a href={`/api/export?m=${month}`} className="btn-ghost min-h-10 px-3 text-sm" download>
          <Download size={16} /> CSV
        </a>
      </div>

      <Suspense>
        <TxFilters wallets={getWallets()} categories={getCategories()} />
      </Suspense>

      <p className="text-[13px] text-ink-3">
        {txs.length} giao dịch
        {expense > 0 && (
          <>
            {" · "}Chi <span className="font-semibold text-expense tabular-nums">{formatVND(expense)}</span>
          </>
        )}
        {income > 0 && (
          <>
            {" · "}Thu <span className="font-semibold text-income tabular-nums">{formatVND(income)}</span>
          </>
        )}
      </p>

      <TxList txs={txs} from={from} />
    </div>
  );
}
