/**
 * Bỏ dấu tiếng Việt + chữ thường, GIỮ NGUYÊN độ dài chuỗi (1 ký tự vào → 1 ký tự ra)
 * để vị trí tìm được trên chuỗi đã bỏ dấu dùng lại được trên chuỗi gốc.
 * Chuỗi vào nên được normalize("NFC") trước.
 */
export function fold(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "đ" || ch === "Đ") {
      out += "d";
      continue;
    }
    const base = ch.normalize("NFD")[0].toLowerCase();
    out += base.length === 1 ? base : ch;
  }
  return out;
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Regex khớp nguyên từ trên chuỗi đã fold (không dính chữ/số hai bên). */
export function wordRegex(foldedPhrase: string, flags = "g"): RegExp {
  const body = foldedPhrase.trim().split(/\s+/).map(escapeRegExp).join("\\s+");
  return new RegExp(`(?<![a-z0-9])${body}(?![a-z0-9])`, flags);
}
