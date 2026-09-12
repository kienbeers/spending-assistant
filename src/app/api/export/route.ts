import type { NextRequest } from "next/server";
import { debtLabel } from "@/components/tx-list";
import { isValidMonth } from "@/lib/format";
import { listTransactions } from "@/lib/repo";
import { apiUserId, UNAUTHORIZED } from "@/lib/session";

const TYPE_LABEL = { expense: "Chi", income: "Thu", transfer: "Chuyển ví" } as const;

function csvCell(value: string | number | null): string {
  const s = String(value ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** GET /api/export?m=YYYY-MM → file CSV (mở được bằng Excel). Bỏ `m` để xuất tất cả. */
export async function GET(request: NextRequest) {
  const userId = await apiUserId();
  if (!userId) return UNAUTHORIZED();
  const m = request.nextUrl.searchParams.get("m");
  const month = m && isValidMonth(m) ? m : undefined;
  const txs = listTransactions(userId, { month, limit: 1_000_000 }).reverse();

  const header = ["Ngày", "Loại", "Số tiền", "Ví", "Sang ví", "Danh mục", "Khoản nợ", "Ghi chú"];
  const rows = txs.map((t) => [
    t.date,
    debtLabel(t) ?? TYPE_LABEL[t.type],
    t.amount,
    t.walletName,
    t.toWalletName,
    t.categoryName,
    t.debtName,
    t.note,
  ]);
  // BOM để Excel đọc đúng tiếng Việt
  const csv = "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="chi-tieu-${month ?? "tat-ca"}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
