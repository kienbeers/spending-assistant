"use client";

import { MessageCircleQuestion, RefreshCw, Sparkles } from "lucide-react";
import { useRef, useState } from "react";

const QUESTIONS = [
  "Tháng này mình tiêu có ổn không?",
  "Nên cắt giảm khoản nào?",
  "Nên ưu tiên trả khoản nợ nào trước?",
  "Mỗi tháng nên để dành bao nhiêu?",
];

/** Hiển thị văn bản AI: gạch đầu dòng và **đậm**, không dùng HTML thô. */
export function AiText({ text }: { text: string }) {
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) {
      blocks.push(
        <ul key={blocks.length} className="my-1.5 list-disc space-y-1 pl-5">
          {list.map((li, i) => (
            <li key={i}>{inline(li)}</li>
          ))}
        </ul>,
      );
      list = [];
    }
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    if (bullet) {
      list.push(bullet[1]);
      continue;
    }
    flush();
    if (!line) continue;
    blocks.push(
      <p key={blocks.length} className="mt-2 first:mt-0">
        {inline(line.replace(/^#+\s*/, ""))}
      </p>,
    );
  }
  flush();
  return <div className="text-[15px] leading-relaxed text-ink">{blocks}</div>;
}

function inline(s: string): React.ReactNode[] {
  return s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : part,
  );
}

export function AiPanel({
  month,
  aiStatus,
  lastReview,
}: {
  month: string;
  aiStatus: { ok: boolean; message: string };
  lastReview: { content: string; createdAt: string } | null;
}) {
  const [mode, setMode] = useState<"review" | "ask">("review");
  const [output, setOutput] = useState(lastReview?.content ?? "");
  const [meta, setMeta] = useState(lastReview ? `Lúc ${timeVN(lastReview.createdAt)}` : "");
  const [question, setQuestion] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function run(kind: "review" | "ask", q?: string) {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setRunning(true);
    setError(null);
    setOutput("");
    setMeta(kind === "ask" ? `Hỏi: ${q}` : "");
    const started = Date.now();
    try {
      const res = await fetch("/api/ai/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, month, question: q }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Lỗi ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let text = "";
      for (let r = await reader.read(); !r.done; r = await reader.read()) {
        text += decoder.decode(r.value, { stream: true });
        setOutput(text);
      }
      const secs = Math.round((Date.now() - started) / 1000);
      setMeta((m) => `${m ? `${m} · ` : ""}${secs} giây`);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="card p-4">
      <div className="flex items-center gap-2">
        <Sparkles size={18} className="text-accent" />
        <h2 className="flex-1 font-semibold">Trợ lý AI</h2>
        <span
          className={`truncate rounded-full px-2 py-0.5 text-[11px] ${aiStatus.ok ? "bg-accent-soft text-accent" : "bg-surface-2 text-expense"}`}
          title={aiStatus.message}
        >
          {aiStatus.ok ? aiStatus.message : "AI chưa sẵn sàng"}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1">
        {(
          [
            ["review", "Nhận xét tháng"],
            ["ask", "Hỏi AI"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            aria-pressed={mode === k}
            onClick={() => setMode(k)}
            className="min-h-10 rounded-lg text-sm font-medium text-ink-3 aria-pressed:bg-surface aria-pressed:text-ink aria-pressed:shadow-sm"
          >
            {label}
          </button>
        ))}
      </div>

      {!aiStatus.ok && <p className="mt-3 text-sm text-expense">{aiStatus.message}</p>}

      {mode === "review" ? (
        <button
          type="button"
          onClick={() => run("review")}
          disabled={running || !aiStatus.ok}
          className="btn-primary mt-3 w-full"
        >
          {output && !running ? <RefreshCw size={16} /> : <Sparkles size={16} />}
          {running ? "AI đang viết…" : output ? "Nhận xét lại" : "Nhận xét tháng này"}
        </button>
      ) : (
        <div className="mt-3 space-y-2">
          <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
            {QUESTIONS.map((q) => (
              <button
                key={q}
                type="button"
                className="chip shrink-0"
                disabled={running || !aiStatus.ok}
                onClick={() => {
                  setQuestion(q);
                  run("ask", q);
                }}
              >
                {q}
              </button>
            ))}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (question.trim()) run("ask", question.trim());
            }}
          >
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="vd: Mua xe 40tr trả góp 12 tháng có ổn không?"
              maxLength={500}
              enterKeyHint="send"
              className="field min-w-0 flex-1"
            />
            <button className="btn-primary shrink-0 px-3" disabled={running || !aiStatus.ok || !question.trim()}>
              <MessageCircleQuestion size={18} />
              <span className="sr-only">Hỏi</span>
            </button>
          </form>
        </div>
      )}

      {(output || running || error) && (
        <div className="mt-4 rounded-xl bg-surface-2/60 p-3" aria-live="polite">
          {meta && <p className="mb-2 text-[12px] text-ink-3">{meta}</p>}
          {output ? (
            <AiText text={output} />
          ) : running ? (
            <p className="animate-pulse text-sm text-ink-3">
              AI đang đọc số liệu… (lần đầu có thể mất khoảng 1 phút để khởi động model)
            </p>
          ) : null}
          {error && <p className="mt-2 text-sm font-medium text-expense">{error}</p>}
        </div>
      )}
      <p className="mt-3 text-[12px] text-ink-3">
        AI chỉ đọc số liệu đã tổng hợp và có thể nhận xét chưa chính xác. Hãy đối chiếu với số liệu thật.
      </p>
    </section>
  );
}

function timeVN(iso: string) {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(iso));
}
