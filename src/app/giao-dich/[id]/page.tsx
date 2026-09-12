import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { TxEditor } from "@/components/tx-editor";
import type { DebtAction } from "@/lib/quick-parse";
import { getEditorContext, getTransaction, type Tx } from "@/lib/repo";
import { requireUserId } from "@/lib/session";

function debtAction(tx: Tx): DebtAction | null {
  if (!tx.debtDirection) return null;
  if (tx.debtDirection === "lend") return tx.type === "expense" ? "lend" : "collect";
  return tx.type === "income" ? "borrow" : "repay";
}

export const metadata: Metadata = { title: "Sửa giao dịch" };

export default async function EditTransactionPage({ params, searchParams }: PageProps<"/giao-dich/[id]">) {
  await connection();
  const userId = await requireUserId();
  const { id } = await params;
  const { from } = await searchParams;
  const tx = getTransaction(userId, Number(id));
  if (!tx) notFound();

  // Chỉ cho quay về đường dẫn nội bộ
  const backHref = typeof from === "string" && from.startsWith("/") && !from.startsWith("//") ? from : "/giao-dich";

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div className="flex items-center gap-1">
        <Link
          href={backHref}
          className="-ml-2 flex size-11 items-center justify-center rounded-full active:bg-surface-2"
          aria-label="Quay lại"
        >
          <ChevronLeft size={22} />
        </Link>
        <h1 className="text-lg font-semibold">Sửa giao dịch</h1>
      </div>
      <section className="card p-4">
        <TxEditor
          ctx={getEditorContext(userId, tx.debtId)}
          txId={tx.id}
          backHref={backHref}
          initial={{
            type: tx.debtId ? "debt" : tx.type,
            amount: tx.amount,
            walletId: tx.walletId,
            toWalletId: tx.toWalletId,
            categoryId: tx.categoryId,
            date: tx.date,
            note: tx.note,
            debtId: tx.debtId,
            debtName: tx.debtName ?? "",
            debtAction: debtAction(tx),
          }}
        />
      </section>
    </div>
  );
}
