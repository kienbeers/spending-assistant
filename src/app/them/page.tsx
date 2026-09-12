import type { Metadata } from "next";
import { connection } from "next/server";
import { TxEditor } from "@/components/tx-editor";
import { TxList } from "@/components/tx-list";
import type { DebtAction, QuickParseResult } from "@/lib/quick-parse";
import { getDebts, getEditorContext, getRecurring, listTransactions } from "@/lib/repo";
import { requireUserId } from "@/lib/session";

export const metadata: Metadata = { title: "Thêm giao dịch" };

const DEBT_ACTIONS: DebtAction[] = ["lend", "collect", "borrow", "repay"];

export default async function AddPage({ searchParams }: PageProps<"/them">) {
  await connection();
  const userId = await requireUserId();
  const sp = await searchParams;
  const recent = listTransactions(userId, { limit: 5, order: "recent" });
  const ctx = getEditorContext(userId);

  // /them?no=3&act=repay — mở từ trang Sổ nợ
  const debt = ctx.debts.find((d) => d.id === Number(sp.no));
  const act = DEBT_ACTIONS.find((a) => a === sp.act);
  // /them?tt=5 — thanh toán thẻ tín dụng: chuyển tiền từ ví mặc định sang ví thẻ
  const card = ctx.wallets.find((w) => w.id === Number(sp.tt) && w.kind === "credit");
  const payFrom = ctx.wallets.find((w) => w.isDefault && w.kind !== "credit") ?? ctx.wallets.find((w) => w.kind === "bank");

  // /them?lai=3 — trả lãi khoản vay lãi ngoài: ghi là khoản chi danh mục "Lãi vay"
  const interestDebt = getDebts(userId).find((d) => d.id === Number(sp.lai) && d.paymentIsInterest);
  const interestCategory = ctx.categories.find((c) => c.name === "Lãi vay");

  // /them?dk=2 — ghi khoản định kỳ (số tiền gợi ý theo lần gần nhất)
  const recurring = getRecurring(userId).find((r) => r.id === Number(sp.dk));
  const recurringPreset: Partial<QuickParseResult> | undefined = recurring
    ? {
        type: recurring.kind, // khoản thu định kỳ (lương, làm thêm) hoặc khoản chi
        amount: recurring.lastAmount ?? recurring.amount,
        categoryId: recurring.categoryId,
        walletId: recurring.walletId ?? undefined,
        note: recurring.name,
      }
    : undefined;

  const preset: Partial<QuickParseResult> | undefined =
    interestDebt && interestCategory
      ? {
          type: "expense",
          amount: interestDebt.monthlyPayment,
          categoryId: interestCategory.id,
          note: `lãi vay ${interestDebt.name}`,
        }
      : recurringPreset
        ? recurringPreset
        : debt && act
      ? { type: "debt", debtAction: act, debtId: debt.id, debtName: debt.name }
      : card && payFrom
        ? { type: "transfer", walletId: payFrom.id, toWalletId: card.id, note: `thanh toán ${card.name}` }
        : undefined;

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Thêm giao dịch</h1>
        <p className="text-[13px] text-ink-3">
          Gõ tự nhiên: <b>k</b> = nghìn, <b>l</b> = trăm nghìn, <b>m</b> = triệu. Thêm việc chi, tên ví (mb, shb,
          momo, fe) và ngày (hôm qua, 5/9) nếu cần.
        </p>
      </div>
      <section className="card p-4">
        <TxEditor ctx={ctx} preset={preset} autoFocus={!preset} recurringId={recurring?.id ?? null} />
      </section>
      {recent.length > 0 && (
        <section className="card overflow-hidden">
          <h2 className="px-4 pt-4 pb-1 font-semibold">Vừa nhập</h2>
          <TxList txs={recent} grouped={false} from="/them" />
        </section>
      )}
    </div>
  );
}
