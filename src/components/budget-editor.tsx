"use client";

import { Calculator, Copy, Sparkles } from "lucide-react";
import { useState, useTransition } from "react";
import { saveBudgetsAction } from "@/app/actions";
import { formatVND } from "@/lib/format";

const nf = new Intl.NumberFormat("vi-VN");

interface Row {
  categoryId: number;
  name: string;
  icon: string;
  isFixed: boolean;
  budget: number;
  spent: number;
  projected: number;
  avg3: number;
}

export function BudgetEditor({
  month,
  rows,
  spendable,
  hasIncome,
  isCurrent,
  suggestions,
  previous,
  aiReady,
}: {
  month: string;
  rows: Row[];
  spendable: number;
  hasIncome: boolean;
  isCurrent: boolean;
  suggestions: { categoryId: number; amount: number }[];
  previous: { categoryId: number; amount: number }[];
  aiReady: boolean;
}) {
  const initial = Object.fromEntries(rows.map((r) => [r.categoryId, r.budget]));
  const [values, setValues] = useState<Record<number, number>>(initial);
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [status, setStatus] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [aiRunning, setAiRunning] = useState(false);
  const [saving, startSaving] = useTransition();

  const total = Object.values(values).reduce((s, v) => s + (v || 0), 0);
  const dirty = rows.some((r) => (values[r.categoryId] || 0) !== r.budget);
  const leftover = spendable - total;

  const fill = (items: { categoryId: number; amount: number }[], note: string) => {
    const next: Record<number, number> = Object.fromEntries(rows.map((r) => [r.categoryId, 0]));
    for (const it of items) next[it.categoryId] = it.amount;
    setValues(next);
    setReasons({});
    setAiSummary(null);
    setStatus({ tone: "ok", text: `${note} — nhớ bấm Lưu.` });
  };

  async function askAi() {
    setAiRunning(true);
    setStatus(null);
    try {
      const res = await fetch("/api/ai/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Lỗi ${res.status}`);
      fill(data.items, "Đã điền ngân sách AI đề xuất");
      setReasons(Object.fromEntries(data.items.map((it: { categoryId: number; reason: string }) => [it.categoryId, it.reason])));
      setAiSummary(data.summary);
      if (data.overBudget) {
        setStatus({ tone: "err", text: "AI đề xuất vượt số tiền có thể chi. Hãy giảm bớt trước khi lưu." });
      }
    } catch (e) {
      setStatus({ tone: "err", text: (e as Error).message });
    } finally {
      setAiRunning(false);
    }
  }

  function save() {
    startSaving(async () => {
      await saveBudgetsAction(
        month,
        rows.map((r) => ({ categoryId: r.categoryId, amount: values[r.categoryId] || 0 })),
      );
      setStatus({ tone: "ok", text: "Đã lưu ngân sách." });
    });
  }

  return (
    <section className="card overflow-hidden">
      <div className="p-4 pb-2">
        <h2 className="font-semibold">Ngân sách theo danh mục</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="chip" onClick={() => fill(suggestions, "Đã điền theo trung bình 3 tháng")}>
            <Calculator size={14} /> Theo trung bình 3 tháng
          </button>
          {previous.length > 0 && (
            <button type="button" className="chip" onClick={() => fill(previous, "Đã chép ngân sách tháng trước")}>
              <Copy size={14} /> Chép tháng trước
            </button>
          )}
          <button type="button" className="chip" onClick={askAi} disabled={aiRunning || !aiReady}>
            <Sparkles size={14} className="text-accent" />
            {aiRunning ? "AI đang lập…" : "AI đề xuất"}
          </button>
        </div>
        {aiRunning && (
          <p className="mt-2 animate-pulse text-[13px] text-ink-3">AI đang tính toán, có thể mất 30–90 giây…</p>
        )}
        {aiSummary && (
          <p className="mt-3 rounded-xl bg-accent-soft px-3 py-2 text-[14px] text-ink">
            <Sparkles size={14} className="mr-1 inline text-accent" />
            {aiSummary}
          </p>
        )}
      </div>

      <ul className="divide-y divide-line">
        {rows.map((r) => {
          const budget = values[r.categoryId] || 0;
          const shown = isCurrent ? r.projected : r.spent;
          const pctSpent = budget ? Math.min(100, (r.spent / budget) * 100) : 0;
          const pctProjected = budget ? Math.min(100, (shown / budget) * 100) : 0;
          const over = budget > 0 && shown > budget;
          const warn = budget > 0 && !over && !r.isFixed && shown > budget * 0.85;
          const paidFixed = budget > 0 && !over && r.isFixed && r.spent >= budget * 0.95;
          return (
            <li key={r.categoryId} className="px-4 py-3">
              <div className="flex items-center gap-2">
                <span aria-hidden>{r.icon}</span>
                <label htmlFor={`b-${r.categoryId}`} className="min-w-0 flex-1 truncate text-[14px] font-medium">
                  {r.name}
                  {r.isFixed && <span className="ml-1.5 text-[11px] font-normal text-ink-3">cố định</span>}
                </label>
                <div className="relative w-32 shrink-0">
                  <input
                    id={`b-${r.categoryId}`}
                    inputMode="numeric"
                    value={budget ? nf.format(budget) : ""}
                    placeholder="0"
                    onChange={(e) => {
                      const digits = e.target.value.replace(/\D/g, "");
                      setValues((v) => ({ ...v, [r.categoryId]: digits ? Number(digits) : 0 }));
                    }}
                    className="field h-10 py-1 pr-6 text-right tabular-nums"
                  />
                  <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[13px] text-ink-3">đ</span>
                </div>
              </div>
              {budget > 0 && (
                <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-track" aria-hidden>
                  {isCurrent && (
                    <div
                      className={`absolute inset-y-0 left-0 rounded-full ${over ? "bg-expense/35" : "bg-accent/30"}`}
                      style={{ width: `${pctProjected}%` }}
                    />
                  )}
                  <div
                    className={`absolute inset-y-0 left-0 rounded-full ${over ? "bg-expense" : "bg-accent"}`}
                    style={{ width: `${pctSpent}%` }}
                  />
                </div>
              )}
              <p className="mt-1 flex flex-wrap gap-x-2 text-[12px] text-ink-3 tabular-nums">
                <span>Đã chi {formatVND(r.spent)}</span>
                {isCurrent && r.projected !== r.spent && <span>· dự kiến {formatVND(r.projected)}</span>}
                {r.avg3 > 0 && <span>· TB {formatVND(r.avg3)}</span>}
                {over && <span className="font-medium text-expense">· {isCurrent ? "dự kiến vượt" : "vượt"} {formatVND(shown - budget)}</span>}
                {warn && <span className="font-medium text-ink-2">· sắp chạm ngân sách</span>}
                {paidFixed && <span className="text-income">· đã chi đủ</span>}
              </p>
              {reasons[r.categoryId] && <p className="mt-0.5 text-[12px] text-accent">AI: {reasons[r.categoryId]}</p>}
            </li>
          );
        })}
      </ul>

      <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] space-y-2 border-t border-line bg-surface p-4 md:bottom-0">
        <div className="flex items-baseline justify-between text-[14px] tabular-nums">
          <span className="text-ink-3">Tổng ngân sách</span>
          <span className="font-semibold">{formatVND(total)}</span>
        </div>
        {hasIncome && (
          <div className="flex items-baseline justify-between text-[13px] tabular-nums">
            <span className="text-ink-3">So với tiền có thể chi</span>
            <span className={`font-medium ${leftover < 0 ? "text-expense" : "text-income"}`}>
              {leftover < 0 ? `thiếu ${formatVND(-leftover)}` : `dư ${formatVND(leftover)}`}
            </span>
          </div>
        )}
        {status && (
          <p role="status" className={`text-[13px] font-medium ${status.tone === "err" ? "text-expense" : "text-accent"}`}>
            {status.text}
          </p>
        )}
        <button type="button" onClick={save} disabled={saving || !dirty} className="btn-primary w-full">
          {saving ? "Đang lưu…" : dirty ? "Lưu ngân sách" : "Đã lưu"}
        </button>
      </div>
    </section>
  );
}
