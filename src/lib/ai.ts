// Lớp AI dùng chung. Mặc định: Ollama chạy local (dữ liệu không rời máy).
// Đổi sang Claude: đặt AI_PROVIDER=anthropic (+ ANTHROPIC_API_KEY) trong .env.local.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

export interface AiProvider {
  name: "ollama" | "anthropic";
  model: string;
  /** Sinh văn bản dạng stream */
  streamText(input: { system: string; prompt: string }): AsyncGenerator<string>;
  /** Sinh JSON đúng schema */
  json<T>(input: { system: string; prompt: string; schema: z.ZodType<T> }): Promise<T>;
  /** Kiểm tra nhanh AI có sẵn sàng không */
  check(): Promise<{ ok: boolean; message: string }>;
}

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen3:8b";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5";

export function getAi(): AiProvider {
  return process.env.AI_PROVIDER === "anthropic" ? anthropicProvider() : ollamaProvider();
}

// --- Ollama ------------------------------------------------------------------------

function ollamaProvider(): AiProvider {
  const body = (system: string, prompt: string) => ({
    model: OLLAMA_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
    think: false, // Qwen3: tắt suy nghĩ để trả lời nhanh
    keep_alive: "30m", // giữ model trong bộ nhớ, tránh nạp lại mất ~1 phút
    options: { temperature: 0.3, num_ctx: 8192 },
  });

  return {
    name: "ollama",
    model: OLLAMA_MODEL,

    async *streamText({ system, prompt }) {
      const res = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body(system, prompt), stream: true }),
      });
      if (!res.ok || !res.body) throw new Error(`Ollama lỗi ${res.status}: ${await res.text()}`);

      // Ollama trả NDJSON: mỗi dòng một object { message: { content }, done }
      const decoder = new TextDecoder();
      let buffer = "";
      const reader = res.body.getReader();
      for (let r = await reader.read(); !r.done; r = await reader.read()) {
        buffer += decoder.decode(r.value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          const data = JSON.parse(line) as { message?: { content?: string }; error?: string };
          if (data.error) throw new Error(data.error);
          if (data.message?.content) yield data.message.content;
        }
      }
    },

    async json({ system, prompt, schema }) {
      const res = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body(system, prompt), stream: false, format: z.toJSONSchema(schema) }),
      });
      if (!res.ok) throw new Error(`Ollama lỗi ${res.status}: ${await res.text()}`);
      const data = (await res.json()) as { message: { content: string } };
      return schema.parse(JSON.parse(data.message.content));
    },

    async check() {
      try {
        const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2000) });
        const tags = (await res.json()) as { models: { name: string }[] };
        const has = tags.models.some((m) => m.name === OLLAMA_MODEL || m.name === `${OLLAMA_MODEL}:latest`);
        return has
          ? { ok: true, message: `Ollama · ${OLLAMA_MODEL}` }
          : { ok: false, message: `Ollama chưa có model ${OLLAMA_MODEL} (chạy: ollama pull ${OLLAMA_MODEL})` };
      } catch {
        return { ok: false, message: `Không kết nối được Ollama tại ${OLLAMA_URL}` };
      }
    },
  };
}

// --- Claude (tùy chọn) -----------------------------------------------------------

function anthropicProvider(): AiProvider {
  const client = new Anthropic();
  // Nếu model từ chối vì bộ lọc an toàn, server tự chạy lại bằng model dự phòng phù hợp
  const fallback = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };

  return {
    name: "anthropic",
    model: ANTHROPIC_MODEL,

    async *streamText({ system, prompt }) {
      const stream = client.beta.messages.stream({
        ...fallback,
        model: ANTHROPIC_MODEL,
        max_tokens: 64000,
        system,
        messages: [{ role: "user", content: prompt }],
      });
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") yield event.delta.text;
      }
      const final = await stream.finalMessage();
      if (final.stop_reason === "refusal") throw new Error("Claude từ chối trả lời yêu cầu này");
    },

    async json<T>({ system, prompt, schema }: { system: string; prompt: string; schema: z.ZodType<T> }) {
      const res = await client.beta.messages.parse({
        ...fallback,
        model: ANTHROPIC_MODEL,
        max_tokens: 16000,
        system,
        messages: [{ role: "user", content: prompt }],
        output_config: { format: betaZodOutputFormat(schema) },
      });
      if (res.stop_reason === "refusal") throw new Error("Claude từ chối trả lời yêu cầu này");
      if (res.parsed_output == null) throw new Error("Claude không trả về JSON hợp lệ");
      return res.parsed_output as T;
    },

    async check() {
      return process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN
        ? { ok: true, message: `Claude · ${ANTHROPIC_MODEL}` }
        : { ok: false, message: "Chưa đặt ANTHROPIC_API_KEY" };
    },
  };
}
