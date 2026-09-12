import { z } from "zod";
import { getAi } from "@/lib/ai";
import { goalPrompt, SYSTEM_PROMPT } from "@/lib/ai-prompts";
import { buildDebtStrategy } from "@/lib/debt-plan";
import { formatVND, todayVN } from "@/lib/format";
import { buildPlanFrame, getPlan, savePlanAi } from "@/lib/planning";
import { getWallets } from "@/lib/repo";
import { apiUserId, UNAUTHORIZED } from "@/lib/session";

const bodySchema = z.object({ planId: z.coerce.number().int().positive() });

const m = (n: number) => formatVND(n);
const monthVN = (month: string) => `${Number(month.slice(5, 7))}/${month.slice(0, 4)}`;

/** Số liệu cho AI: tất cả đều do code tính */
function buildGoalFacts(userId: number, extraPerMonth: number): string {
  const frame = buildPlanFrame(userId, todayVN().slice(0, 7));
  const s = buildDebtStrategy(userId, extraPerMonth);
  const cash = getWallets(userId).filter((w) => w.kind !== "credit").reduce((t, w) => t + w.balance, 0);
  const lines: string[] = [];

  lines.push("# Thu nhập & nghĩa vụ mỗi tháng");
  lines.push(`- Thu nhập: ${m(frame.expectedIncome)}`);
  lines.push(`- Phải trả bắt buộc (trả góp + lãi + thẻ): ${m(s.requiredMonthly)}`);
  lines.push(`- Trong đó tiền lãi mất trắng mỗi tháng: ${m(s.interestMonthly)}`);
  const left = frame.expectedIncome - s.requiredMonthly;
  lines.push(
    `- Thu nhập trừ khoản bắt buộc: ${left < 0 ? "ÂM " : ""}${m(Math.abs(left))}${left < 0 ? " (không đủ trả, đang phải bù từ chỗ khác)" : " để ăn ở, đi lại và dồn trả nợ"}`,
  );
  lines.push(`- Tiền đang có trong các ví: ${m(cash)}`);

  lines.push("", "# Các khoản nợ, xếp theo lãi cao trước");
  for (const d of s.debts) {
    const kind =
      d.kind === "interest-only"
        ? "vay lãi ngoài, mỗi tháng chỉ trả lãi, gốc không giảm"
        : d.kind === "installment"
          ? "trả góp"
          : d.kind === "card"
            ? "thẻ tín dụng"
            : "vay người thân, không lãi";
    lines.push(
      `- ${d.name}: còn ${m(d.outstanding)} · ${kind} · bắt buộc ${m(d.required)}/tháng${d.yearlyRate ? ` · lãi khoảng ${d.yearlyRate}%/năm` : ""}`,
    );
  }
  lines.push(`- Tổng đang nợ: ${m(s.totalOutstanding)}`);

  lines.push("", `# Mô phỏng nếu mỗi tháng dồn thêm ${m(extraPerMonth)} để trả nợ`);
  lines.push(`- Thứ tự dồn tiền: ${s.priority.map((d) => d.name).join(" → ") || "chưa có khoản nào trả thêm được"}`);
  if (s.monthsToDebtFree !== null) {
    lines.push(`- Hết nợ sau ${s.monthsToDebtFree} tháng, khoảng tháng ${monthVN(s.debtFreeMonth!)}`);
    lines.push(`- Tổng tiền lãi phải trả từ giờ tới lúc hết nợ: ${m(s.totalInterest)}`);
  } else {
    lines.push(`- Với mức dồn này thì hơn 10 năm vẫn chưa hết nợ. Riêng tiền lãi 10 năm đã là ${m(s.totalInterest)}.`);
  }
  const cleared = s.steps.filter((x) => x.cleared.length > 0).slice(0, 6);
  for (const step of cleared) lines.push(`- Tháng ${monthVN(step.month)}: xong khoản ${step.cleared.join(", ")}`);

  return lines.join("\n");
}

/** POST /api/ai/muc-tieu → định hướng AI cho mục tiêu (trả về dần) */
export async function POST(request: Request) {
  const userId = await apiUserId();
  if (!userId) return UNAUTHORIZED();
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Yêu cầu không hợp lệ" }, { status: 400 });
  const plan = getPlan(userId, parsed.data.planId);
  if (!plan) return Response.json({ error: "Không tìm thấy mục tiêu" }, { status: 404 });

  const ai = getAi();
  const status = await ai.check();
  if (!status.ok) return Response.json({ error: status.message }, { status: 503 });

  const facts = buildGoalFacts(userId, plan.extraPerMonth);
  const prompt = goalPrompt(
    {
      title: plan.title,
      goalText: plan.goalText,
      target: plan.targetAmount ? formatVND(plan.targetAmount) : undefined,
      deadline: plan.targetDate ?? undefined,
    },
    facts,
  );

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let full = "";
      try {
        for await (const chunk of ai.streamText({ system: SYSTEM_PROMPT, prompt })) {
          full += chunk;
          controller.enqueue(encoder.encode(chunk));
        }
        if (full.trim()) savePlanAi(userId, plan.id, full.trim(), `${ai.name}:${ai.model}`);
      } catch (e) {
        controller.enqueue(encoder.encode(`\n\n⚠️ Lỗi AI: ${e instanceof Error ? e.message : "không rõ"}`));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
