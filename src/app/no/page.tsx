import { CalendarClock, ChevronDown, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import {
  createDebtAction,
  deleteDebtAction,
  payOffDebtAction,
  setDebtClosedAction,
  updateDebtAction,
} from "@/app/actions";
import { ConfirmButton } from "@/components/confirm-button";
import { TxList } from "@/components/tx-list";
import { addDays, formatVND, todayVN } from "@/lib/format";
import { getDebts, getWallets, listTransactions, type Debt, type Wallet } from "@/lib/repo";
import { requireUserId } from "@/lib/session";

export const metadata: Metadata = { title: "Sổ nợ" };

function dateVN(date: string) {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
}

/** Vay lãi ngoài: quy đổi tiền lãi tháng ra %/năm để so sánh với các khoản khác */
function yearlyRate(d: Debt): number | null {
  if (d.interestRate !== null) return d.interestRate;
  if (!d.paymentIsInterest || !d.monthlyPayment || d.outstanding <= 0) return null;
  return Math.round(((d.monthlyPayment * 12) / d.outstanding) * 100);
}

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export default async function DebtsPage() {
  await connection();
  const userId = await requireUserId();
  const today = todayVN();
  const debts = getDebts(userId);
  const wallets = getWallets(userId);

  const open = debts.filter((d) => d.isOpen);
  const borrowing = open.filter((d) => d.direction === "borrow");
  const lending = open.filter((d) => d.direction === "lend");
  const done = debts.filter((d) => !d.isOpen);

  // Thẻ tín dụng cũng là khoản phải trả
  const cards = wallets.filter((w) => w.kind === "credit" && w.used > 0);
  const cardDebt = cards.reduce((s, w) => s + w.used, 0);
  const cardMonthly = cards.reduce((s, w) => s + (w.monthlyPayment ?? w.used), 0);

  const owe = borrowing.reduce((s, d) => s + d.outstanding, 0) + cardDebt;
  const owed = lending.reduce((s, d) => s + d.outstanding, 0);
  const monthly = borrowing.reduce((s, d) => s + (d.monthlyPayment ?? 0), 0);
  // Số dư ví đã bao gồm dư nợ thẻ (số âm) nên không trừ lần nữa
  const netWorth = wallets.reduce((s, w) => s + w.balance, 0) + owed - (owe - cardDebt);

  // Sắp đến hạn trong 7 ngày hoặc đã quá hạn
  const upcoming = [
    ...open.map((d) => {
      // Quá hạn trả hết gốc thì báo trước, không chờ tới kỳ lãi tháng sau
      const overdue = d.dueDate !== null && d.dueDate < today;
      return {
      key: `d${d.id}`,
      name: d.name,
      date: overdue ? d.dueDate : (d.nextPaymentDate ?? d.dueDate),
      amount: overdue ? d.payoffAmount : Math.min(d.monthlyPayment ?? d.outstanding, d.outstanding),
      href:
        d.paymentIsInterest && !overdue
          ? `/them?lai=${d.id}`
          : `/them?no=${d.id}&act=${d.direction === "borrow" ? "repay" : "collect"}`,
      label: overdue ? "Trả hết" : !d.paymentIsInterest ? (d.direction === "borrow" ? "Trả" : "Thu") : "Trả lãi",
      };
    }),
    ...cards.map((w) => ({
      key: `w${w.id}`,
      name: w.name,
      date: w.nextPaymentDate,
      amount: w.monthlyPayment ?? w.used,
      href: `/them?tt=${w.id}`,
      label: "Trả",
    })),
  ]
    .filter((x): x is typeof x & { date: string } => !!x.date && x.date <= addDays(today, 7))
    .sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-lg font-semibold">Sổ nợ</h1>

      <section className="card grid grid-cols-2 gap-x-4 gap-y-3 p-4">
        <Stat label="Bạn đang nợ (gồm thẻ)" value={owe} tone={owe > 0 ? "expense" : undefined} />
        <Stat label="Người khác nợ bạn" value={owed} tone={owed > 0 ? "income" : undefined} />
        <Stat label="Trả góp khoản vay / tháng" value={monthly} />
        {cards.length > 0 && <Stat label="Thẻ cần thanh toán" value={cardMonthly} tone="expense" />}
        <div>
          <p className="text-[13px] text-ink-3">Tài sản ròng</p>
          <p className={`text-lg font-semibold tabular-nums ${netWorth < 0 ? "text-expense" : ""}`}>
            {netWorth < 0 && "−"}
            {formatVND(Math.abs(netWorth))}
          </p>
          <p className="text-[11px] text-ink-3">số dư ví + cho vay − đang nợ</p>
        </div>
      </section>

      {upcoming.length > 0 && (
        <section className="card p-4">
          <h2 className="mb-2 flex items-center gap-2 font-semibold">
            <CalendarClock size={18} className="text-accent" /> Sắp đến hạn
          </h2>
          <ul className="divide-y divide-line">
            {upcoming.map(({ key, name, date, amount, href, label }) => {
              const diff = daysBetween(today, date);
              return (
                <li key={key} className="flex items-center gap-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{name}</span>
                    <span className={`text-[13px] ${diff < 0 ? "font-medium text-expense" : "text-ink-3"}`}>
                      {diff < 0 ? `Quá hạn ${-diff} ngày` : diff === 0 ? "Hôm nay" : `Còn ${diff} ngày`} ·{" "}
                      {dateVN(date)}
                    </span>
                  </span>
                  <span className="font-semibold tabular-nums">{formatVND(amount)}</span>
                  <Link href={href} className="btn-ghost min-h-9 px-3 text-sm">
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {cards.length > 0 && (
        <section className="space-y-2">
          <h2 className="px-1 font-semibold">Thẻ tín dụng</h2>
          <ul className="space-y-2">
            {cards.map((w) => {
              const pct = w.creditLimit ? Math.min(100, Math.round((w.used / w.creditLimit) * 100)) : 0;
              return (
                <li key={w.id} className="card p-4">
                  <div className="flex items-baseline gap-2">
                    <span className="size-2.5 shrink-0 self-center rounded-full" style={{ background: w.color }} aria-hidden />
                    <span className="min-w-0 flex-1 truncate font-medium">{w.name}</span>
                    <span className="font-semibold text-expense tabular-nums">{formatVND(w.used)}</span>
                  </div>
                  {w.creditLimit !== null && (
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-track" aria-hidden>
                      <div className="h-full rounded-full bg-expense" style={{ width: `${pct}%` }} />
                    </div>
                  )}
                  <p className="mt-1.5 flex flex-wrap gap-x-2 text-[12px] text-ink-3 tabular-nums">
                    {w.creditLimit !== null && (
                      <span>
                        Đã tiêu {formatVND(w.used)} / {formatVND(w.creditLimit)} ({pct}%) · còn dùng được{" "}
                        {formatVND(w.available ?? 0)}
                      </span>
                    )}
                    {w.nextPaymentDate && <span>· thanh toán {dateVN(w.nextPaymentDate)}</span>}
                  </p>
                  <div className="mt-3 flex gap-2">
                    <Link href={`/them?tt=${w.id}`} className="btn-primary flex-1 text-sm">
                      Thanh toán thẻ
                    </Link>
                    <Link href={`/giao-dich?vi=${w.id}`} className="btn-ghost flex-1 text-sm">
                      Xem chi tiêu thẻ
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <DebtSection title="Khoản đi vay" empty="Không có khoản nợ nào." debts={borrowing} today={today} wallets={wallets} userId={userId} />
      <DebtSection title="Khoản cho vay" empty="Không ai nợ bạn." debts={lending} today={today} wallets={wallets} userId={userId} />

      <details className="card">
        <summary className="flex min-h-14 cursor-pointer items-center gap-2 px-4 font-medium text-accent">
          <Plus size={18} /> Thêm khoản nợ
        </summary>
        <form action={createDebtAction} className="space-y-3 border-t border-line p-4">
          <p className="text-[13px] text-ink-3">
            Mẹo: gõ ở ô nhập nhanh <b>“cho Nam mượn 500k”</b> hoặc <b>“vay mẹ 5tr”</b> cũng tạo khoản nợ.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="new-direction">
                Loại
              </label>
              <select id="new-direction" name="direction" className="field">
                <option value="borrow">Mình đi vay</option>
                <option value="lend">Mình cho vay</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="new-created">
                Ngày
              </label>
              <input id="new-created" type="date" name="createdOn" defaultValue={today} className="field" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="new-amount">
                Số tiền nợ
              </label>
              <input id="new-amount" name="openingAmount" inputMode="numeric" required className="field tabular-nums" />
            </div>
            <div>
              <label className="label" htmlFor="new-wallet">
                Tiền qua ví
              </label>
              <select id="new-wallet" name="walletId" defaultValue="0" className="field">
                <option value="0">Không (nợ có từ trước)</option>
                {wallets.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <DebtFields />
          <button className="btn-primary w-full">Thêm khoản nợ</button>
        </form>
      </details>

      {done.length > 0 && (
        <details className="group">
          <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium text-ink-3">
            <ChevronDown size={16} className="transition group-open:rotate-180" /> Đã xong ({done.length})
          </summary>
          <ul className="mt-2 space-y-2">
            {done.map((d) => (
              <li key={d.id}>
                <DebtCard debt={d} today={today} wallets={wallets} userId={userId} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "income" | "expense" }) {
  return (
    <div>
      <p className="text-[13px] text-ink-3">{label}</p>
      <p
        className={`text-lg font-semibold tabular-nums ${tone === "income" ? "text-income" : tone === "expense" ? "text-expense" : ""}`}
      >
        {formatVND(value)}
      </p>
    </div>
  );
}

function DebtSection({
  title,
  empty,
  debts,
  today,
  wallets,
  userId,
}: {
  title: string;
  empty: string;
  debts: Debt[];
  today: string;
  wallets: Wallet[];
  userId: number;
}) {
  return (
    <section className="space-y-2">
      <h2 className="px-1 font-semibold">{title}</h2>
      {debts.length === 0 ? (
        <p className="card px-4 py-5 text-center text-sm text-ink-3">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {debts.map((d) => (
            <li key={d.id}>
              <DebtCard debt={d} today={today} wallets={wallets} userId={userId} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DebtCard({
  debt: d,
  today,
  wallets,
  userId,
}: {
  debt: Debt;
  today: string;
  wallets: Wallet[];
  userId: number;
}) {
  const pct = d.total > 0 ? Math.min(100, Math.round((d.paid / d.total) * 100)) : 0;
  const overdue = d.isOpen && d.dueDate && d.dueDate < today;
  const history = listTransactions(userId, { debtId: d.id, limit: 20 });
  const payWallets = wallets.filter((w) => w.kind !== "credit");
  const payAction = d.direction === "borrow" ? "repay" : "collect";
  const addAction = d.direction === "borrow" ? "borrow" : "lend";

  return (
    <details className="card group overflow-hidden">
      <summary className="block cursor-pointer p-4">
        <div className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate font-medium">{d.name}</span>
          <span className="font-semibold tabular-nums">{formatVND(Math.max(d.outstanding, 0))}</span>
          <ChevronDown size={16} className="shrink-0 self-center text-ink-3 transition group-open:rotate-180" />
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-track" aria-hidden>
          <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-1.5 flex flex-wrap gap-x-2 text-[12px] text-ink-3">
          <span>
            Đã {d.direction === "borrow" ? "trả" : "thu"} {formatVND(d.paid)} / {formatVND(d.total)} ({pct}%)
          </span>
          {d.monthlyPayment && (
            <span>
              · {formatVND(d.monthlyPayment)}/tháng
              {d.paymentIsInterest && " (chỉ lãi, gốc không giảm)"}
            </span>
          )}
          {d.nextPaymentDate && <span>· kỳ tới {dateVN(d.nextPaymentDate)}</span>}
          {d.dueDate && (
            <span className={overdue ? "font-medium text-expense" : ""}>
              · {overdue ? "quá hạn" : "hạn"} {dateVN(d.dueDate)}
            </span>
          )}
          {yearlyRate(d) !== null && (
            <span className={(yearlyRate(d) ?? 0) >= 30 ? "font-medium text-expense" : ""}>
              · lãi {d.interestRate !== null ? "" : "khoảng "}
              {yearlyRate(d)}%/năm
            </span>
          )}
        </p>
      </summary>

      <div className="space-y-4 border-t border-line p-4">
        {d.isOpen && d.paymentIsInterest && d.monthlyPayment && (
          <p className="rounded-xl bg-surface-2 px-3 py-2 text-[13px] tabular-nums">
            Trả hết khoản này cần <b>{formatVND(d.payoffAmount)}</b> = gốc {formatVND(d.outstanding)} + lãi kỳ này{" "}
            {formatVND(d.monthlyPayment)}
          </p>
        )}
        {d.isOpen && (
          <details className="rounded-xl border border-accent/40 bg-accent-soft/40 px-3 py-2">
            <summary className="cursor-pointer font-medium text-accent">
              {d.direction === "borrow" ? "Trả hết khoản này" : "Thu hết khoản này"}
            </summary>
            <form action={payOffDebtAction} className="mt-3 space-y-3 pb-1">
              <input type="hidden" name="debtId" value={d.id} />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label" htmlFor={`po-principal-${d.id}`}>
                    {d.direction === "borrow" ? "Trả gốc" : "Thu gốc"}
                  </label>
                  <input
                    id={`po-principal-${d.id}`}
                    name="principal"
                    inputMode="numeric"
                    defaultValue={d.outstanding}
                    className="field tabular-nums"
                  />
                </div>
                <div>
                  <label className="label" htmlFor={`po-interest-${d.id}`}>
                    Tiền lãi kỳ này
                  </label>
                  <input
                    id={`po-interest-${d.id}`}
                    name="interest"
                    inputMode="numeric"
                    defaultValue={d.paymentIsInterest ? (d.monthlyPayment ?? 0) : 0}
                    className="field tabular-nums"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label" htmlFor={`po-wallet-${d.id}`}>
                    {d.direction === "borrow" ? "Trả từ ví" : "Nhận vào ví"}
                  </label>
                  <select
                    id={`po-wallet-${d.id}`}
                    name="walletId"
                    defaultValue={payWallets.find((w) => w.isDefault)?.id ?? payWallets[0]?.id}
                    className="field"
                  >
                    {payWallets.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor={`po-date-${d.id}`}>
                    Ngày
                  </label>
                  <input id={`po-date-${d.id}`} type="date" name="date" defaultValue={today} className="field" />
                </div>
              </div>
              <p className="text-[12px] text-ink-3">
                Tiền lãi ghi vào danh mục “Lãi vay”, tiền gốc trừ vào khoản nợ. Để 0 nếu khoản nào không trả.
              </p>
              <button className="btn-primary w-full">
                {d.direction === "borrow" ? "Ghi trả hết" : "Ghi thu hết"}
              </button>
            </form>
          </details>
        )}

        {d.isOpen && (
          <div className="flex flex-wrap gap-2">
            {d.paymentIsInterest && (
              <Link href={`/them?lai=${d.id}`} className="btn-primary flex-1 text-sm">
                Ghi trả lãi
              </Link>
            )}
            <Link
              href={`/them?no=${d.id}&act=${payAction}`}
              className={`${d.paymentIsInterest ? "btn-ghost" : "btn-primary"} flex-1 text-sm`}
            >
              {d.direction === "borrow" ? (d.paymentIsInterest ? "Trả gốc" : "Ghi trả nợ") : "Ghi thu nợ"}
            </Link>
            <Link href={`/them?no=${d.id}&act=${addAction}`} className="btn-ghost flex-1 text-sm">
              {d.direction === "borrow" ? "Vay thêm" : "Cho vay thêm"}
            </Link>
          </div>
        )}

        {history.length > 0 && (
          <div className="-mx-4 border-y border-line">
            <TxList txs={history} grouped={false} from="/no" />
          </div>
        )}

        <details>
          <summary className="cursor-pointer text-sm font-medium text-accent">Sửa thông tin</summary>
          <form action={updateDebtAction} className="mt-3 space-y-3">
            <input type="hidden" name="id" value={d.id} />
            <div>
              <label className="label" htmlFor={`opening-${d.id}`}>
                Nợ có từ trước (không qua ví)
              </label>
              <input
                id={`opening-${d.id}`}
                name="openingAmount"
                inputMode="numeric"
                defaultValue={d.openingAmount}
                className="field tabular-nums"
              />
            </div>
            <DebtFields debt={d} />
            <button className="btn-primary w-full">Lưu</button>
          </form>
        </details>

        <div className="flex flex-wrap gap-2">
          <form action={setDebtClosedAction}>
            <input type="hidden" name="id" value={d.id} />
            <input type="hidden" name="closed" value={d.closed ? "0" : "1"} />
            <button className="btn-ghost text-sm">{d.closed ? "Mở lại" : "Đánh dấu đã xong"}</button>
          </form>
          <form action={deleteDebtAction}>
            <input type="hidden" name="id" value={d.id} />
            <ConfirmButton
              message={`Xóa khoản nợ “${d.name}” và ${history.length} giao dịch liên quan? Số dư ví sẽ được tính lại.`}
              className="btn-ghost text-sm text-expense"
            >
              Xóa
            </ConfirmButton>
          </form>
        </div>
      </div>
    </details>
  );
}

function DebtFields({ debt }: { debt?: Debt }) {
  const k = debt?.id ?? "new";
  return (
    <>
      <div>
        <label className="label" htmlFor={`name-${k}`}>
          Tên người / khoản vay
        </label>
        <input
          id={`name-${k}`}
          name="name"
          required
          maxLength={80}
          defaultValue={debt?.name}
          placeholder="vd: Nam, Mẹ, Trả góp xe"
          className="field"
        />
      </div>
      <details className="rounded-xl border border-line px-3 py-2" open={!!debt?.monthlyPayment}>
        <summary className="cursor-pointer text-sm text-ink-2">Trả góp, lãi suất, hạn trả…</summary>
        <div className="mt-3 space-y-3 pb-1">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor={`monthly-${k}`}>
                Trả mỗi tháng
              </label>
              <input
                id={`monthly-${k}`}
                name="monthlyPayment"
                inputMode="numeric"
                defaultValue={debt?.monthlyPayment ?? ""}
                className="field tabular-nums"
              />
            </div>
            <div>
              <label className="label" htmlFor={`day-${k}`}>
                Ngày trả hằng tháng
              </label>
              <input
                id={`day-${k}`}
                name="paymentDay"
                type="number"
                min={1}
                max={31}
                defaultValue={debt?.paymentDay ?? ""}
                className="field"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor={`rate-${k}`}>
                Lãi suất (%/năm)
              </label>
              <input
                id={`rate-${k}`}
                name="interestRate"
                inputMode="decimal"
                defaultValue={debt?.interestRate ?? ""}
                className="field"
              />
            </div>
            <div>
              <label className="label" htmlFor={`due-${k}`}>
                Hạn trả hết
              </label>
              <input id={`due-${k}`} type="date" name="dueDate" defaultValue={debt?.dueDate ?? ""} className="field" />
            </div>
          </div>
          <label className="flex items-start gap-2 text-[14px]">
            <input
              type="checkbox"
              name="paymentIsInterest"
              defaultChecked={debt?.paymentIsInterest}
              className="mt-0.5 size-5 accent-[var(--accent)]"
            />
            <span>
              Chỉ trả lãi hằng tháng, gốc không giảm
              <span className="block text-[12px] text-ink-3">
                Dùng cho vay lãi ngoài. Tiền lãi sẽ ghi vào danh mục “Lãi vay”, không trừ vào gốc.
              </span>
            </span>
          </label>
          <div>
            <label className="label" htmlFor={`aliases-${k}`}>
              Tên gọi khi nhập nhanh <span className="font-normal">(cách nhau dấu phẩy)</span>
            </label>
            <input
              id={`aliases-${k}`}
              name="aliases"
              defaultValue={debt?.aliases}
              placeholder="vd: xe, honda"
              autoCapitalize="none"
              className="field"
            />
          </div>
          <div>
            <label className="label" htmlFor={`note-${k}`}>
              Ghi chú
            </label>
            <input id={`note-${k}`} name="note" defaultValue={debt?.note} className="field" />
          </div>
        </div>
      </details>
    </>
  );
}
