"use client";

import { ArrowRightLeft, Check, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { removeTransaction, saveTransaction } from "@/app/actions";
import { addDays, formatCompact, formatVND, todayVN } from "@/lib/format";
import {
  DEBT_ACTION_DIRECTION,
  DEBT_ACTION_TX_TYPE,
  quickParse,
  type DebtAction,
  type DebtDirection,
  type EntryType,
  type QuickParseResult,
} from "@/lib/quick-parse";
import type { CategoryType, WalletKind } from "@/lib/seed";

export interface EditorContext {
  wallets: { id: number; name: string; kind: WalletKind; aliases: string; color: string; isDefault: boolean }[];
  categories: { id: number; name: string; type: CategoryType; icon: string }[];
  keywords: { keyword: string; categoryId: number }[];
  debts: { id: number; name: string; aliases: string; direction: DebtDirection; outstanding: number }[];
}

type Fields = QuickParseResult;

const TYPES: { value: EntryType; label: string }[] = [
  { value: "expense", label: "Chi" },
  { value: "income", label: "Thu" },
  { value: "transfer", label: "Chuyển ví" },
  { value: "debt", label: "Nợ" },
];

const DEBT_ACTIONS: { value: DebtAction; label: string }[] = [
  { value: "lend", label: "Cho vay" },
  { value: "collect", label: "Thu nợ" },
  { value: "borrow", label: "Đi vay" },
  { value: "repay", label: "Trả nợ" },
];

// k = nghìn · l = trăm nghìn · m = triệu
const EXAMPLES = [
  "35k cafe",
  "ăn trưa 45k momo",
  "4l đi chợ",
  "thanh toán tiền nhà 2.175m shb",
  "lương 15m shb",
  "chuyển 5l mb sang momo",
  "cho Nam mượn 5l",
];

const nf = new Intl.NumberFormat("vi-VN");

export function TxEditor({
  ctx,
  txId = null,
  initial,
  preset,
  autoFocus = false,
  compact = false,
  backHref = "/giao-dich",
  recurringId = null,
}: {
  ctx: EditorContext;
  /** null = tạo mới (có ô nhập nhanh) */
  txId?: number | null;
  initial?: Fields;
  /** Điền sẵn khi tạo mới (vd. từ trang Sổ nợ) */
  preset?: Partial<Fields>;
  autoFocus?: boolean;
  /** Ẩn phần chi tiết cho tới khi bắt đầu gõ (dùng ở trang tổng quan) */
  compact?: boolean;
  /** Trang quay về sau khi sửa/xóa */
  backHref?: string;
  /** Gắn giao dịch với khoản định kỳ (mở từ trang Kế hoạch) */
  recurringId?: number | null;
}) {
  const router = useRouter();
  const isEdit = txId !== null;
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [overrides, setOverrides] = useState<Partial<Fields>>(preset ?? {});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ id: number; label: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const today = todayVN();
  const parsed = useMemo(() => quickParse(text, { ...ctx, today }), [text, ctx, today]);
  const base = isEdit && initial ? initial : parsed;
  const v: Fields = { ...base, ...overrides };

  const set = (patch: Partial<Fields>) => {
    setError(null);
    setOverrides((o) => ({ ...o, ...patch }));
  };

  const categoryType: CategoryType = v.type === "income" ? "income" : "expense";
  const categories = ctx.categories.filter((c) => c.type === categoryType);
  const category = ctx.categories.find((c) => c.id === v.categoryId);
  // Danh mục không khớp loại (vd. đổi Chi → Thu) thì coi như chưa chọn
  const categoryId =
    (v.type === "expense" || v.type === "income") && category?.type === categoryType ? v.categoryId : null;
  const showDetails = !compact || isEdit || text.trim() !== "" || Object.keys(overrides).length > 0;
  // Màu số tiền theo chiều tiền ra/vào ví
  const flow = v.type === "debt" && v.debtAction ? DEBT_ACTION_TX_TYPE[v.debtAction] : v.type;

  function changeType(type: EntryType) {
    const patch: Partial<Fields> = { type };
    if (type === "transfer" && !v.toWalletId) {
      patch.toWalletId = ctx.wallets.find((w) => w.id !== v.walletId)?.id ?? null;
    }
    if (type === "debt" && !v.debtAction) patch.debtAction = "lend";
    set(patch);
  }

  function submit() {
    const payload = { ...v, categoryId, toWalletId: v.type === "transfer" ? v.toWalletId : null, recurringId };
    if (!payload.amount) {
      setError("Nhập số tiền");
      return;
    }
    if ((payload.type === "expense" || payload.type === "income") && !payload.note.trim() && !categoryId) {
      setError("Ghi chú hoặc chọn danh mục để biết tiêu vào việc gì");
      return;
    }
    startTransition(async () => {
      const res = await saveTransaction(txId, payload);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (isEdit) {
        router.push(backHref);
        return;
      }
      const sign = flow === "income" ? "+" : flow === "expense" ? "−" : "";
      const debtName = ctx.debts.find((d) => d.id === payload.debtId)?.name ?? payload.debtName;
      const what =
        payload.type === "transfer"
          ? `${walletName(payload.walletId)} → ${walletName(payload.toWalletId)}`
          : payload.type === "debt"
            ? `${DEBT_ACTIONS.find((a) => a.value === payload.debtAction)?.label} · ${debtName}`
            : (ctx.categories.find((c) => c.id === categoryId)?.name ?? "Chưa phân loại");
      setSaved({ id: res.id, label: `${sign}${formatVND(payload.amount!)} · ${what}` });
      setText("");
      setOverrides({});
      inputRef.current?.focus();
    });
  }

  function undo() {
    if (!saved) return;
    const id = saved.id;
    setSaved(null);
    startTransition(() => removeTransaction(id));
  }

  function remove() {
    if (!isEdit || !confirm("Xóa giao dịch này?")) return;
    startTransition(async () => {
      await removeTransaction(txId);
      router.push(backHref);
    });
  }

  const walletName = (id: number | null) => ctx.wallets.find((w) => w.id === id)?.name ?? "?";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-4"
    >
      {!isEdit && (
        <div>
          <label htmlFor="quick" className="sr-only">
            Nhập nhanh
          </label>
          <input
            ref={inputRef}
            id="quick"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setSaved(null);
              setError(null);
            }}
            autoFocus={autoFocus}
            autoComplete="off"
            enterKeyHint="done"
            placeholder="vd: 35k cafe momo · 2.175m tiền nhà shb"
            className="field h-13 rounded-2xl px-4 text-[17px]"
          />
          {!showDetails && !saved && (
            <div className="mt-2.5 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
              {EXAMPLES.map((ex) => (
                <button key={ex} type="button" className="chip shrink-0" onClick={() => setText(ex)}>
                  {ex}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {saved && (
        <div
          role="status"
          className="flex items-center gap-3 rounded-xl bg-accent-soft px-3 py-2 text-sm text-ink"
        >
          <Check size={18} className="shrink-0 text-accent" />
          <span className="min-w-0 flex-1 truncate">Đã lưu {saved.label}</span>
          <button type="button" onClick={undo} className="inline-flex min-h-9 items-center gap-1 font-medium text-accent">
            <Undo2 size={16} /> Hoàn tác
          </button>
        </div>
      )}

      {showDetails && (
        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-1 rounded-xl bg-surface-2 p-1" role="group" aria-label="Loại giao dịch">
            {TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                aria-pressed={v.type === t.value}
                onClick={() => changeType(t.value)}
                className="min-h-10 rounded-lg text-sm font-medium text-ink-3 transition aria-pressed:bg-surface aria-pressed:text-ink aria-pressed:shadow-sm"
              >
                {t.label}
              </button>
            ))}
          </div>

          <div>
            <label htmlFor="amount" className="label">
              Số tiền
            </label>
            <div className="relative">
              <input
                id="amount"
                inputMode="numeric"
                autoComplete="off"
                value={v.amount ? nf.format(v.amount) : ""}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, "");
                  set({ amount: digits ? Math.min(Number(digits), 1e13) : null });
                }}
                placeholder="0"
                className={`field pr-9 text-2xl font-semibold tabular-nums ${
                  flow === "income" ? "text-income" : flow === "expense" ? "text-expense" : ""
                }`}
              />
              <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-ink-3">đ</span>
            </div>
          </div>

          {v.type === "debt" && (
            <DebtFields v={v} ctx={ctx} set={set} showPreview={!isEdit} />
          )}

          <WalletPicker
            label={
              v.type === "transfer" || (v.type === "debt" && flow === "expense")
                ? "Từ ví"
                : v.type === "debt"
                  ? "Vào ví"
                  : "Ví"
            }
            wallets={ctx.wallets}
            value={v.walletId}
            onChange={(walletId) => set({ walletId })}
          />

          {v.type === "transfer" ? (
            <WalletPicker
              label="Sang ví"
              wallets={ctx.wallets.filter((w) => w.id !== v.walletId)}
              value={v.toWalletId}
              onChange={(toWalletId) => set({ toWalletId })}
              icon={<ArrowRightLeft size={14} className="text-ink-3" />}
            />
          ) : v.type === "debt" ? null : (
            <fieldset>
              <legend className="label">Danh mục</legend>
              <div className="flex flex-wrap gap-2">
                {categories.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="chip"
                    aria-pressed={categoryId === c.id}
                    onClick={() => set({ categoryId: c.id })}
                  >
                    <span aria-hidden>{c.icon}</span>
                    {c.name}
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
            <div>
              <label htmlFor="note" className="label">
                Ghi chú
              </label>
              <input
                id="note"
                value={v.note}
                onChange={(e) => set({ note: e.target.value })}
                autoComplete="off"
                className="field"
              />
            </div>
            <div>
              <label htmlFor="date" className="label">
                Ngày
              </label>
              <div className="flex gap-2">
                <input
                  id="date"
                  type="date"
                  value={v.date}
                  max={today}
                  onChange={(e) => e.target.value && set({ date: e.target.value })}
                  className="field min-w-0 flex-1 sm:w-40"
                />
                <button
                  type="button"
                  className="chip min-h-11 shrink-0"
                  aria-pressed={v.date === addDays(today, -1)}
                  onClick={() => set({ date: v.date === addDays(today, -1) ? today : addDays(today, -1) })}
                >
                  Hôm qua
                </button>
              </div>
            </div>
          </div>

          {error && (
            <p role="alert" className="text-sm font-medium text-expense">
              {error}
            </p>
          )}

          <div className="flex gap-2">
            {isEdit && (
              <button type="button" onClick={remove} disabled={pending} className="btn-ghost text-expense">
                Xóa
              </button>
            )}
            <button type="submit" disabled={pending} className="btn-primary flex-1">
              {pending ? "Đang lưu…" : isEdit ? "Lưu thay đổi" : "Lưu giao dịch"}
            </button>
          </div>
        </div>
      )}
    </form>
  );
}

function DebtFields({
  v,
  ctx,
  set,
  showPreview,
}: {
  v: Fields;
  ctx: EditorContext;
  set: (patch: Partial<Fields>) => void;
  showPreview: boolean;
}) {
  const action = v.debtAction ?? "lend";
  const direction = DEBT_ACTION_DIRECTION[action];
  const debts = ctx.debts.filter((d) => d.direction === direction);
  const selected = debts.find((d) => d.id === v.debtId);
  const canCreate = action === "lend" || action === "borrow";
  const increases = canCreate;
  const after = selected && v.amount ? selected.outstanding + (increases ? v.amount : -v.amount) : null;

  return (
    <div className="space-y-4 rounded-xl border border-line p-3">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Loại giao dịch nợ">
        {DEBT_ACTIONS.map((a) => (
          <button
            key={a.value}
            type="button"
            className="chip"
            aria-pressed={action === a.value}
            onClick={() => {
              const sameDirection = DEBT_ACTION_DIRECTION[a.value] === direction;
              set({ debtAction: a.value, ...(sameDirection ? {} : { debtId: null }) });
            }}
          >
            {a.label}
          </button>
        ))}
      </div>

      <fieldset>
        <legend className="label">{direction === "lend" ? "Người vay" : "Vay của"}</legend>
        {debts.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {debts.map((d) => (
              <button
                key={d.id}
                type="button"
                className="chip"
                aria-pressed={v.debtId === d.id}
                onClick={() => set({ debtId: d.id, debtName: d.name })}
              >
                {d.name}
                <span className="text-ink-3 tabular-nums">· còn {formatCompact(d.outstanding)}</span>
              </button>
            ))}
          </div>
        )}
        {canCreate ? (
          <input
            value={v.debtId ? "" : v.debtName}
            onChange={(e) => set({ debtName: e.target.value, debtId: null })}
            placeholder={debts.length ? "hoặc nhập tên người mới" : "Tên người / nơi"}
            aria-label="Tên người mới"
            className="field"
          />
        ) : (
          debts.length === 0 && <p className="text-sm text-ink-3">Chưa có khoản nợ nào.</p>
        )}
      </fieldset>

      <p className="text-[13px] text-ink-3">
        Không tính vào thu/chi.
        {showPreview && after !== null && selected && (
          <>
            {" "}
            Còn nợ: <span className="tabular-nums">{formatVND(selected.outstanding)}</span> →{" "}
            <span className="font-semibold text-ink tabular-nums">{formatVND(Math.max(after, 0))}</span>
          </>
        )}
      </p>
    </div>
  );
}

function WalletPicker({
  label,
  wallets,
  value,
  onChange,
  icon,
}: {
  label: string;
  wallets: EditorContext["wallets"];
  value: number | null;
  onChange: (id: number) => void;
  icon?: React.ReactNode;
}) {
  return (
    <fieldset>
      <legend className="label flex items-center gap-1.5">
        {icon}
        {label}
      </legend>
      <div className="flex flex-wrap gap-2">
        {wallets.map((w) => (
          <button key={w.id} type="button" className="chip" aria-pressed={value === w.id} onClick={() => onChange(w.id)}>
            <span className="size-2.5 rounded-full" style={{ background: w.color }} aria-hidden />
            {w.name}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
