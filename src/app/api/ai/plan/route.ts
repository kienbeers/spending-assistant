import { z } from "zod";
import { getAi } from "@/lib/ai";
import { planPrompt, planSchema, SYSTEM_PROMPT } from "@/lib/ai-prompts";
import { isValidMonth } from "@/lib/format";
import { buildFinancialSnapshot, buildPlanFrame, hasAnyTransactions, saveAiReport } from "@/lib/planning";
import { shiftMonth } from "@/lib/format";

const bodySchema = z.object({ month: z.string().refine(isValidMonth) });

/** POST /api/ai/plan → AI đề xuất ngân sách tháng (đã kiểm tra lại bằng code). */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Yêu cầu không hợp lệ" }, { status: 400 });
  const { month } = parsed.data;

  if (!hasAnyTransactions()) {
    return Response.json({ error: "Chưa có giao dịch nào để lập kế hoạch." }, { status: 422 });
  }
  const frame = buildPlanFrame(month);
  if (frame.suggestions.length === 0) {
    return Response.json({ error: "Cần ít nhất 1 tháng có dữ liệu chi tiêu để lập kế hoạch." }, { status: 422 });
  }

  const ai = getAi();
  const status = await ai.check();
  if (!status.ok) return Response.json({ error: status.message }, { status: 503 });

  try {
    // Số liệu tháng trước tháng lập kế hoạch
    const snapshot = buildFinancialSnapshot(shiftMonth(month, -1));
    const out = await ai.json({ system: SYSTEM_PROMPT, prompt: planPrompt(frame, snapshot), schema: planSchema });

    // Không tin tuyệt đối vào AI: chỉ nhận id hợp lệ, giữ trong biên hợp lý quanh mức trung bình
    const allowed = new Map(frame.suggestions.map((s) => [s.categoryId, s]));
    const round10k = (n: number) => Math.round(n / 10_000) * 10_000;
    const seen = new Set<number>();
    const items = out.items
      .filter((it) => allowed.has(it.categoryId) && !seen.has(it.categoryId) && seen.add(it.categoryId))
      .map((it) => {
        const base = allowed.get(it.categoryId)!;
        // Cố định: ±10% · linh hoạt: 50%–130% so với gợi ý theo quy tắc
        const lo = round10k(base.amount * (base.isFixed ? 0.9 : 0.5));
        const hi = round10k(base.amount * (base.isFixed ? 1.1 : 1.3));
        const raw = round10k(it.amount);
        const amount = Math.min(hi, Math.max(lo, raw));
        return {
          categoryId: it.categoryId,
          name: base.name,
          isFixed: base.isFixed,
          amount,
          reason: `${it.reason.slice(0, 100)}${amount !== raw ? " (đã chỉnh về mức hợp lý)" : ""}`,
        };
      });
    // Danh mục AI bỏ sót → dùng gợi ý theo quy tắc
    for (const s of frame.suggestions) {
      if (!seen.has(s.categoryId)) {
        items.push({ categoryId: s.categoryId, name: s.name, isFixed: s.isFixed, amount: s.amount, reason: "Theo trung bình 3 tháng" });
      }
    }
    // Vẫn vượt tiền có thể chi → co đều các khoản linh hoạt (không dưới 50%)
    const sum = () => items.reduce((t, it) => t + it.amount, 0);
    if (frame.expectedIncome > 0 && sum() > frame.spendable) {
      const fixed = items.filter((it) => it.isFixed).reduce((t, it) => t + it.amount, 0);
      const flexible = sum() - fixed;
      const ratio = flexible > 0 ? Math.max(0.5, (frame.spendable - fixed) / flexible) : 1;
      for (const it of items) if (!it.isFixed) it.amount = Math.floor((it.amount * ratio) / 10_000) * 10_000;
    }
    const total = items.reduce((t, it) => t + it.amount, 0);
    saveAiReport("plan", month, JSON.stringify({ summary: out.summary, items }), `${ai.name}:${ai.model}`);

    return Response.json({
      summary: out.summary,
      items,
      total,
      spendable: frame.spendable,
      overBudget: frame.expectedIncome > 0 && total > Math.max(frame.spendable, 0),
      model: ai.model,
    });
  } catch (e) {
    return Response.json({ error: `AI lỗi: ${e instanceof Error ? e.message : "không rõ"}` }, { status: 502 });
  }
}
