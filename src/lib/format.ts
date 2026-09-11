const nf = new Intl.NumberFormat("vi-VN");

export function formatVND(n: number): string {
  return `${nf.format(n)} đ`;
}

/** 35.000 → "35k", 1.250.000 → "1,25tr" (dùng cho nhãn biểu đồ). */
export function formatCompact(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}${trim(abs / 1_000_000_000)}tỷ`;
  if (abs >= 1_000_000) return `${sign}${trim(abs / 1_000_000)}tr`;
  if (abs >= 1_000) return `${sign}${trim(abs / 1_000)}k`;
  return `${sign}${abs}`;
}

function trim(x: number): string {
  return nf.format(Math.round(x * 100) / 100);
}

export const TIME_ZONE = "Asia/Ho_Chi_Minh";

/** Ngày hôm nay theo giờ Việt Nam, dạng YYYY-MM-DD. */
export function todayVN(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(now);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function isValidDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

export function isValidMonth(month: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
}

/** "2026-09" + (-1) → "2026-08" */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `Tháng ${m}/${y}`;
}

const WEEKDAYS = ["Chủ nhật", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"];

export function dayLabel(date: string, today = todayVN()): string {
  if (date === today) return "Hôm nay";
  if (date === addDays(today, -1)) return "Hôm qua";
  const d = new Date(`${date}T00:00:00Z`);
  const dm = `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  const year = date.slice(0, 4) === today.slice(0, 4) ? "" : `/${date.slice(0, 4)}`;
  return `${WEEKDAYS[d.getUTCDay()]}, ${dm}${year}`;
}
