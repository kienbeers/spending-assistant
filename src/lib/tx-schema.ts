// Kiểm tra dữ liệu giao dịch trước khi lưu. Tách riêng để test được (không phụ thuộc Next).
import { z } from "zod";
import { isValidDate } from "./format";

export const txSchema = z
  .object({
    type: z.enum(["expense", "income", "transfer", "debt"]),
    amount: z.number().int("Số tiền phải là số nguyên").positive("Nhập số tiền").max(1e13, "Số tiền quá lớn"),
    walletId: z.number({ message: "Chọn ví" }).int().positive(),
    toWalletId: z.number().int().positive().nullable(),
    categoryId: z.number().int().positive().nullable(),
    note: z.string().max(500).transform((s) => s.trim()),
    date: z.string().refine(isValidDate, "Ngày không hợp lệ"),
    debtAction: z.enum(["lend", "collect", "borrow", "repay"]).nullable().default(null),
    debtId: z.number().int().positive().nullable().default(null),
    debtName: z.string().max(80).default(""),
    recurringId: z.number().int().positive().nullable().default(null),
  })
  .refine((t) => t.type !== "transfer" || (t.toWalletId !== null && t.toWalletId !== t.walletId), {
    message: "Chọn ví nhận khác ví chuyển",
  })
  .refine((t) => t.type !== "debt" || t.debtAction !== null, { message: "Chọn loại giao dịch nợ" })
  // Khoản thu/chi phải biết dùng vào việc gì: có ghi chú hoặc có danh mục
  .refine((t) => !(t.type === "expense" || t.type === "income") || t.note !== "" || t.categoryId !== null, {
    message: "Ghi chú hoặc chọn danh mục để biết tiêu vào việc gì",
  });
