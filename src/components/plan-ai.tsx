"use client";

import { RefreshCw, Sparkles } from "lucide-react";
import { useState } from "react";
import { AiText } from "@/components/ai-panel";

export function PlanAi({
  planId,
  aiReady,
  saved,
}: {
  planId: number;
  aiReady: boolean;
  saved: { content: string; at: string | null } | null;
}) {
  const [output, setOutput] = useState(saved?.content ?? "");
  const [meta, setMeta] = useState(saved?.at ? `Lúc ${timeVN(saved.at)}` : "");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    setOutput("");
    setMeta("");
    const started = Date.now();
    try {
      const res = await fetch("/api/ai/muc-tieu", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId }),
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
      setMeta(`${Math.round((Date.now() - started) / 1000)} giây`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="mt-3">
      <button type="button" onClick={run} disabled={running || !aiReady} className="btn-primary w-full">
        {output && !running ? <RefreshCw size={16} /> : <Sparkles size={16} />}
        {running ? "AI đang lập định hướng…" : output ? "Cập nhật định hướng" : "AI định hướng cho mục tiêu này"}
      </button>
      {!aiReady && <p className="mt-2 text-[13px] text-expense">AI chưa sẵn sàng.</p>}
      {(output || running || error) && (
        <div className="mt-3 rounded-xl bg-surface-2/60 p-3" aria-live="polite">
          {meta && <p className="mb-2 text-[12px] text-ink-3">{meta}</p>}
          {output ? (
            <AiText text={output} />
          ) : running ? (
            <p className="animate-pulse text-sm text-ink-3">AI đang đọc số liệu… (30–60 giây)</p>
          ) : null}
          {error && <p className="mt-2 text-sm font-medium text-expense">{error}</p>}
        </div>
      )}
    </div>
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
