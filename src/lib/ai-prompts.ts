// Câu lệnh cho AI. Viết chặt để model nhỏ chạy local không bịa số.
import { z } from "zod";
import { formatVND } from "./format";
import type { PlanFrame } from "./planning";

export const SYSTEM_PROMPT = `Bạn là trợ lý tài chính cá nhân nói tiếng Việt, xưng "mình", gọi người dùng là "bạn".
Quy tắc bắt buộc:
- CHỈ dùng các con số có trong phần SỐ LIỆU. Không tự cộng trừ ra số mới, không bịa số, không giả định thu nhập hay ngân sách không có trong số liệu.
- Nếu số liệu chưa đủ để kết luận, nói thẳng là chưa đủ.
- Viết ngắn gọn, cụ thể, sát thực tế ở Việt Nam. Tối đa khoảng 200 từ.
- Viết số tiền dạng "1,2 triệu" hoặc "350 nghìn".
- Dùng gạch đầu dòng "- ". Không dùng bảng, không dùng tiêu đề markdown (#).`;

const monthVN = (month: string) => `${Number(month.slice(5, 7))}/${month.slice(0, 4)}`;

export function reviewPrompt(month: string, snapshot: string) {
  return `SỐ LIỆU:
${snapshot}

YÊU CẦU: Nhận xét tình hình tài chính tháng ${monthVN(month)}. Trả lời đúng 3 phần, mỗi phần 2–3 gạch đầu dòng:
**Tình hình:** điểm tốt và chưa tốt.
**Cần chú ý:** khoản tăng bất thường, khoản dự kiến vượt ngân sách, nợ sắp đến hạn hoặc quá hạn (chỉ nêu nếu có trong số liệu).
**Nên làm:** việc cụ thể, có số tiền, cho những ngày còn lại hoặc tháng tới.`;
}

export function askPrompt(question: string, snapshot: string) {
  return `SỐ LIỆU:
${snapshot}

CÂU HỎI CỦA BẠN ẤY: ${question}

Trả lời dựa trên số liệu trên. Nếu câu hỏi không liên quan đến tiền bạc, chi tiêu, nợ hay tiết kiệm của người dùng thì nói ngắn gọn rằng mình chỉ hỗ trợ các việc đó.`;
}

export const planSchema = z.object({
  summary: z.string().describe("Nhận xét ngắn về kế hoạch, tối đa 60 từ"),
  items: z.array(
    z.object({
      categoryId: z.number().int(),
      amount: z.number(),
      reason: z.string().describe("Lý do ngắn, tối đa 12 từ"),
    }),
  ),
});
export type PlanOutput = z.infer<typeof planSchema>;

export function planPrompt(frame: PlanFrame, snapshot: string) {
  const list = frame.suggestions
    .map((s) => `- id ${s.categoryId} | ${s.name}${s.isFixed ? " (cố định)" : ""} | TB 3 tháng ${formatVND(s.avg3)} | gợi ý theo quy tắc ${formatVND(s.amount)}`)
    .join("\n");
  return `SỐ LIỆU:
${snapshot}

NHIỆM VỤ: Lập ngân sách chi tiêu cho tháng ${monthVN(frame.month)}.
- Tiền có thể chi trong tháng (đã trừ trả nợ và để dành mục tiêu): ${formatVND(frame.spendable)}.
- Danh sách danh mục (chỉ dùng đúng các id này):
${list}

Quy tắc:
- Tổng các khoản KHÔNG vượt quá ${formatVND(Math.max(frame.spendable, 0))}${frame.spendable <= 0 ? " — thu nhập không đủ, hãy giảm mạnh các khoản linh hoạt và nói rõ trong summary" : ""}.
- Khoản cố định giữ gần bằng trung bình. Cắt giảm ưu tiên các khoản linh hoạt đang tăng bất thường.
- Số tiền làm tròn đến hàng chục nghìn.
- Trả về JSON với "summary" và "items" (mỗi item: categoryId, amount, reason).`;
}

/** Định hướng cho một mục tiêu cụ thể: số liệu đã tính sẵn, AI chỉ diễn giải + nhắc việc */
export function goalPrompt(goal: { title: string; goalText: string; target?: string; deadline?: string }, facts: string) {
  return `SỐ LIỆU (đã tính sẵn, dùng đúng các số này):
${facts}

MỤC TIÊU CỦA BẠN ẤY: ${goal.title}${goal.target ? ` · số tiền cần: ${goal.target}` : ""}${goal.deadline ? ` · hạn: ${goal.deadline}` : ""}
${goal.goalText ? `Mô tả thêm: ${goal.goalText}` : ""}

NHIỆM VỤ: Viết định hướng cho mục tiêu này, đúng 4 phần, mỗi phần 2–3 gạch đầu dòng, tổng dưới 250 từ:
**Khả thi hay không:** dựa trên tiền còn lại mỗi tháng và mốc thời gian đã tính. Nếu không đủ, nói rõ thiếu bao nhiêu mỗi tháng.
**Trả nợ theo thứ tự nào:** nêu tên khoản và số tiền, ưu tiên khoản lãi cao nhất đã có trong số liệu.
**Chi tiêu mỗi tháng:** gợi ý mức chi linh hoạt còn lại, chia theo tuần nếu hợp lý.
**Việc cần làm ngay tuần này:** 2–3 việc cụ thể, có số tiền hoặc ngày.
Không đưa lời khuyên chung chung kiểu "hãy tiết kiệm hơn". Không bịa thêm khoản nợ hay thu nhập nào.`;
}
