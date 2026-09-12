import { z } from "zod";
import { getAi } from "@/lib/ai";
import { askPrompt, reviewPrompt, SYSTEM_PROMPT } from "@/lib/ai-prompts";
import { isValidMonth, todayVN } from "@/lib/format";
import { buildFinancialSnapshot, hasAnyTransactions, saveAiReport } from "@/lib/planning";
import { apiUserId, UNAUTHORIZED } from "@/lib/session";

const bodySchema = z.object({
  kind: z.enum(["review", "ask"]),
  month: z.string().refine(isValidMonth).optional(),
  question: z.string().trim().max(500).optional(),
});

/** POST /api/ai/stream → văn bản AI trả về dần (text/plain). */
export async function POST(request: Request) {
  const userId = await apiUserId();
  if (!userId) return UNAUTHORIZED();
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Yêu cầu không hợp lệ" }, { status: 400 });
  const { kind, question } = parsed.data;
  const month = parsed.data.month ?? todayVN().slice(0, 7);

  if (kind === "ask" && !question) return Response.json({ error: "Nhập câu hỏi" }, { status: 400 });
  if (!hasAnyTransactions(userId)) {
    return Response.json({ error: "Chưa có giao dịch nào để phân tích. Hãy nhập vài khoản thu chi trước." }, { status: 422 });
  }

  const ai = getAi();
  const status = await ai.check();
  if (!status.ok) return Response.json({ error: status.message }, { status: 503 });

  const snapshot = buildFinancialSnapshot(userId, month);
  const prompt = kind === "review" ? reviewPrompt(month, snapshot) : askPrompt(question!, snapshot);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let full = "";
      try {
        for await (const chunk of ai.streamText({ system: SYSTEM_PROMPT, prompt })) {
          full += chunk;
          controller.enqueue(encoder.encode(chunk));
        }
        if (kind === "review" && full.trim()) saveAiReport(userId, "review", month, full.trim(), `${ai.name}:${ai.model}`);
      } catch (e) {
        controller.enqueue(encoder.encode(`\n\n⚠️ Lỗi AI: ${e instanceof Error ? e.message : "không rõ"}`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-AI-Model": ai.model },
  });
}
