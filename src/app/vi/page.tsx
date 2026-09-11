import { ChevronDown, Plus, Star } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import {
  createWalletAction,
  deleteWalletAction,
  setDefaultWalletAction,
  updateWalletAction,
} from "@/app/actions";
import { ConfirmButton } from "@/components/confirm-button";
import { formatVND } from "@/lib/format";
import { getWallets, type Wallet } from "@/lib/repo";

export const metadata: Metadata = { title: "Ví" };

const KIND_LABEL = { bank: "Ngân hàng", ewallet: "Ví điện tử", cash: "Tiền mặt", credit: "Thẻ tín dụng" } as const;

const dateVN = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

export default async function WalletsPage() {
  await connection();
  const wallets = getWallets();
  const cards = wallets.filter((w) => w.kind === "credit");
  const cash = wallets.filter((w) => w.kind !== "credit");
  const cashTotal = cash.reduce((s, w) => s + w.balance, 0);
  const cardDebt = cards.reduce((s, w) => s + w.used, 0);
  const total = cashTotal - cardDebt;

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <section className="card p-4">
        <h1 className="text-[13px] font-medium text-ink-3">Tổng số dư (tiền còn trong tài khoản)</h1>
        <p className="text-[34px] leading-tight font-bold tracking-tight tabular-nums">
          {cashTotal < 0 && "−"}
          {formatVND(Math.abs(cashTotal))}
        </p>
        {cardDebt > 0 && (
          <dl className="mt-3 space-y-1 border-t border-line pt-3 text-[14px] tabular-nums">
            <div className="flex justify-between">
              <dt className="text-ink-3">Dư nợ thẻ tín dụng</dt>
              <dd className="font-medium text-expense">−{formatVND(cardDebt)}</dd>
            </div>
            <div className="flex justify-between font-semibold">
              <dt>Sau khi trả thẻ</dt>
              <dd className={total < 0 ? "text-expense" : ""}>
                {total < 0 && "−"}
                {formatVND(Math.abs(total))}
              </dd>
            </div>
          </dl>
        )}
        <p className="mt-2 text-[13px] text-ink-3">
          Số dư = số dư ban đầu + thu − chi ± chuyển ví. Nếu lệch với app ngân hàng, mở ví và sửa “Số dư hiện tại”.
        </p>
      </section>

      <ul className="space-y-2">
        {wallets.map((w) => (
          <li key={w.id}>
            <WalletCard wallet={w} />
          </li>
        ))}
      </ul>

      <details className="card group">
        <summary className="flex min-h-14 cursor-pointer items-center gap-2 px-4 font-medium text-accent">
          <Plus size={18} /> Thêm ví
        </summary>
        <form action={createWalletAction} className="space-y-3 border-t border-line p-4">
          <WalletFields />
          <button className="btn-primary w-full">Thêm ví</button>
        </form>
      </details>
    </div>
  );
}

function WalletCard({ wallet: w }: { wallet: Wallet }) {
  return (
    <details className="card group overflow-hidden">
      <summary className="flex min-h-16 cursor-pointer items-center gap-3 px-4 py-3">
        <span className="size-3 shrink-0 rounded-full" style={{ background: w.color }} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 font-medium">
            {w.name}
            {w.isDefault && (
              <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium text-accent">
                mặc định
              </span>
            )}
          </span>
          <span className="block text-[13px] text-ink-3">
            {KIND_LABEL[w.kind]} · {w.txCount} giao dịch
            {w.kind === "credit" && w.creditLimit !== null && ` · hạn mức ${formatVND(w.creditLimit)}`}
            {w.kind === "credit" && w.nextPaymentDate && ` · thanh toán ${dateVN(w.nextPaymentDate)}`}
          </span>
        </span>
        {w.kind === "credit" ? (
          <span className="text-right">
            <span className={`block font-semibold tabular-nums ${w.used > 0 ? "text-expense" : ""}`}>
              {w.used > 0 && "−"}
              {formatVND(w.used)}
            </span>
            {w.available !== null && (
              <span className="block text-[12px] text-ink-3 tabular-nums">còn {formatVND(w.available)}</span>
            )}
          </span>
        ) : (
          <span className={`font-semibold tabular-nums ${w.balance < 0 ? "text-expense" : ""}`}>
            {w.balance < 0 && "−"}
            {formatVND(Math.abs(w.balance))}
          </span>
        )}
        <ChevronDown size={18} className="shrink-0 text-ink-3 transition group-open:rotate-180" />
      </summary>

      <div className="space-y-3 border-t border-line p-4">
        <form action={updateWalletAction} className="space-y-3">
          <input type="hidden" name="id" value={w.id} />
          <WalletFields wallet={w} />
          <button className="btn-primary w-full">Lưu</button>
        </form>
        <div className="flex flex-wrap gap-2">
          <Link href={`/giao-dich?vi=${w.id}`} className="btn-ghost flex-1 text-sm">
            Xem giao dịch
          </Link>
          {!w.isDefault && (
            <form action={setDefaultWalletAction} className="flex-1">
              <input type="hidden" name="id" value={w.id} />
              <button className="btn-ghost w-full text-sm">
                <Star size={16} /> Đặt mặc định
              </button>
            </form>
          )}
          {w.txCount === 0 && (
            <form action={deleteWalletAction}>
              <input type="hidden" name="id" value={w.id} />
              <ConfirmButton message={`Xóa ví “${w.name}”?`} className="btn-ghost text-sm text-expense">
                Xóa
              </ConfirmButton>
            </form>
          )}
        </div>
      </div>
    </details>
  );
}

function WalletFields({ wallet }: { wallet?: Wallet }) {
  const key = wallet?.id ?? "new";
  return (
    <>
      <div className="grid grid-cols-[1fr_auto] gap-3">
        <div>
          <label className="label" htmlFor={`name-${key}`}>
            Tên ví
          </label>
          <input id={`name-${key}`} name="name" required maxLength={50} defaultValue={wallet?.name} className="field" />
        </div>
        <div>
          <label className="label" htmlFor={`color-${key}`}>
            Màu
          </label>
          <input
            id={`color-${key}`}
            type="color"
            name="color"
            defaultValue={wallet?.color ?? "#64748b"}
            className="h-11 w-14 cursor-pointer rounded-xl border border-line bg-surface p-1"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor={`kind-${key}`}>
            Loại
          </label>
          <select id={`kind-${key}`} name="kind" defaultValue={wallet?.kind ?? "bank"} className="field">
            {Object.entries(KIND_LABEL).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor={`balance-${key}`}>
            Số dư hiện tại {wallet?.kind === "credit" && <span className="font-normal">(thẻ: điền ô dưới)</span>}
          </label>
          <input
            id={`balance-${key}`}
            name="balance"
            inputMode="numeric"
            defaultValue={wallet ? String(wallet.balance) : "0"}
            className="field tabular-nums"
          />
        </div>
      </div>
      <details className="rounded-xl border border-line px-3 py-2" open={wallet?.kind === "credit"}>
        <summary className="cursor-pointer text-sm text-ink-2">Thẻ tín dụng: hạn mức, ngày thanh toán</summary>
        <div className="mt-3 space-y-3 pb-1">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor={`limit-${key}`}>
                Hạn mức
              </label>
              <input
                id={`limit-${key}`}
                name="creditLimit"
                inputMode="numeric"
                defaultValue={wallet?.creditLimit ?? ""}
                className="field tabular-nums"
              />
            </div>
            <div>
              <label className="label" htmlFor={`available-${key}`}>
                Còn dùng được
              </label>
              <input
                id={`available-${key}`}
                name="available"
                inputMode="numeric"
                defaultValue={wallet?.available ?? ""}
                placeholder="hạn mức − đã tiêu"
                className="field tabular-nums"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor={`payday-${key}`}>
                Ngày thanh toán
              </label>
              <input
                id={`payday-${key}`}
                name="paymentDay"
                type="number"
                min={1}
                max={31}
                defaultValue={wallet?.paymentDay ?? ""}
                className="field"
              />
            </div>
            <div>
              <label className="label" htmlFor={`cardmonthly-${key}`}>
                Trả mỗi tháng
              </label>
              <input
                id={`cardmonthly-${key}`}
                name="monthlyPayment"
                inputMode="numeric"
                defaultValue={wallet?.monthlyPayment ?? ""}
                placeholder="để trống = trả hết"
                className="field tabular-nums"
              />
            </div>
          </div>
          <p className="text-[12px] text-ink-3">
            Quẹt thẻ ghi như một khoản chi từ ví thẻ. Thanh toán thẻ ghi là chuyển tiền từ ngân hàng sang ví thẻ.
          </p>
        </div>
      </details>
      <div>
        <label className="label" htmlFor={`aliases-${key}`}>
          Tên gọi tắt khi nhập nhanh <span className="font-normal">(cách nhau dấu phẩy)</span>
        </label>
        <input
          id={`aliases-${key}`}
          name="aliases"
          defaultValue={wallet?.aliases}
          placeholder="vd: tcb, techcom"
          autoCapitalize="none"
          className="field"
        />
      </div>
    </>
  );
}
