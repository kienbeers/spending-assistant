// Đọc câu nhập nhanh kiểu tự nhiên: "35k cafe momo", "lương 15tr shb",
// "chuyển 500k mb sang momo", "hôm qua đổ xăng 80k", "+2tr thưởng tết".
// Hàm thuần (không đụng DB) để chạy được cả ở client (xem trước) lẫn server.

import { addDays, isValidDate } from "./format";
import type { CategoryType, WalletKind } from "./seed";
import { escapeRegExp, fold, wordRegex } from "./text";

/** Loại giao dịch lưu trong DB */
export type TxType = "expense" | "income" | "transfer";
/** Loại khi nhập: thêm "debt" (giao dịch gắn khoản nợ) */
export type EntryType = TxType | "debt";
export type DebtDirection = "lend" | "borrow";
/** lend: cho vay · collect: thu nợ · borrow: đi vay · repay: trả nợ */
export type DebtAction = "lend" | "collect" | "borrow" | "repay";

export const DEBT_ACTION_DIRECTION: Record<DebtAction, DebtDirection> = {
  lend: "lend",
  collect: "lend",
  borrow: "borrow",
  repay: "borrow",
};
/** Tiền ra khỏi ví khi cho vay / trả nợ; vào ví khi thu nợ / đi vay */
export const DEBT_ACTION_TX_TYPE: Record<DebtAction, "expense" | "income"> = {
  lend: "expense",
  repay: "expense",
  collect: "income",
  borrow: "income",
};

export interface ParseContext {
  today: string; // YYYY-MM-DD
  wallets: { id: number; name: string; kind: WalletKind; aliases: string; isDefault: boolean }[];
  categories: { id: number; name: string; type: CategoryType }[];
  keywords: { keyword: string; categoryId: number }[];
  /** Các khoản nợ đang mở (kèm số tiền để tự điền khi câu không ghi số) */
  debts?: {
    id: number;
    name: string;
    aliases: string;
    direction: DebtDirection;
    monthlyPayment?: number | null;
    outstanding?: number;
    /** Gốc còn lại + lãi kỳ này */
    payoffAmount?: number;
    paymentIsInterest?: boolean;
  }[];
}

export interface QuickParseResult {
  type: EntryType;
  amount: number | null;
  walletId: number | null;
  toWalletId: number | null;
  categoryId: number | null;
  date: string;
  note: string;
  debtAction: DebtAction | null;
  /** null + debtName = khoản nợ mới */
  debtId: number | null;
  debtName: string;
}

type Span = [start: number, end: number];

const NOT_WORD_BEFORE = "(?<![a-z0-9])";
const NOT_WORD_AFTER = "(?![a-z0-9])";

export function quickParse(input: string, ctx: ParseContext): QuickParseResult {
  const text = input.normalize("NFC");
  const folded = fold(text);
  let work = folded; // bản làm việc: phần đã "dùng" được thay bằng khoảng trắng
  let workAccented = text.toLowerCase(); // như trên nhưng giữ dấu (để khớp tên danh mục)
  const removed: Span[] = [];

  const blank = (s: string, [a, b]: Span) => s.slice(0, a) + " ".repeat(b - a) + s.slice(b);
  const consume = (span: Span) => {
    removed.push(span);
    work = blank(work, span);
    workAccented = blank(workAccented, span);
  };

  // 1. Ngày (làm trước để "15/9" không bị hiểu là số tiền)
  const date = extractDate(work, ctx.today, consume);

  // 2. Số tiền
  const amountHit = extractAmount(work);
  if (amountHit) consume(amountHit.span);

  // 3. Ví
  const walletHits = extractWallets(work, ctx.wallets);
  for (const hit of walletHits) consume(hit.span);

  const result: QuickParseResult = {
    type: "expense",
    amount: amountHit?.value ?? null,
    walletId: null,
    toWalletId: null,
    categoryId: null,
    date,
    note: "",
    debtAction: null,
    debtId: null,
    debtName: "",
  };
  const defaultWallet = () =>
    walletHits[0]?.walletId ?? ctx.wallets.find((w) => w.isDefault)?.id ?? ctx.wallets[0]?.id ?? null;

  // 4a. "đóng lãi bác Tuân shb" → khoản chi danh mục "Lãi vay", KHÔNG trừ vào gốc,
  //     số tiền lấy theo tiền lãi hằng tháng của khoản đó nếu câu không ghi số
  const interestCategory = isInterestPayment(work)
    ? (ctx.categories.find((c) => fold(c.name.normalize("NFC")) === "lai vay" && c.type === "expense") ?? null)
    : null;
  const interestDebt = interestCategory ? findDebtInText(work, ctx.debts ?? [], "borrow") : null;
  // 4b. Nợ: "cho Nam mượn 500k", "vay mẹ 5tr", "trả nợ mẹ 1tr", "Nam trả 200k"
  const debt = interestCategory ? null : detectDebt(work, text, ctx.debts ?? []);
  // "Thịnh chuyển 100k", "mẹ gửi 500k" → tiền người ta đưa cho mình (không gắn khoản nợ nào)
  const incoming = !debt && isIncomingFromPerson(work);
  // 5. Chuyển tiền giữa các ví?
  const transfer = debt ? null : detectTransfer(folded, walletHits, ctx.wallets);
  if (debt) {
    result.type = "debt";
    result.walletId = defaultWallet();
    result.debtAction = debt.action;
    result.debtId = debt.debtId;
    result.debtName = debt.name;
    // Không ghi số tiền: trả nợ = trả hết (gốc + lãi kỳ này), thu nợ = thu hết
    if (result.amount === null && debt.debtId !== null) {
      const d = (ctx.debts ?? []).find((x) => x.id === debt.debtId);
      if (debt.action === "repay") result.amount = d?.payoffAmount ?? d?.outstanding ?? null;
      else if (debt.action === "collect") result.amount = d?.outstanding ?? null;
    }
  } else if (transfer) {
    result.type = "transfer";
    result.walletId = transfer.from;
    result.toWalletId = transfer.to;
  } else {
    result.walletId = defaultWallet();

    // 6. Danh mục theo từ khóa; dấu +/- ép loại thu/chi
    const forcedType: CategoryType | null =
      amountHit?.sign === "+" ? "income" : amountHit?.sign === "-" ? "expense" : incoming ? "income" : null;
    const category = interestCategory ?? matchCategory(work, workAccented, ctx, forcedType);
    result.categoryId = category?.id ?? null;
    result.type = interestCategory ? "expense" : (forcedType ?? category?.type ?? "expense");
    // "đóng lãi bác Tuân" → lấy tiền lãi hằng tháng của khoản đó
    if (interestCategory && result.amount === null && interestDebt?.monthlyPayment) {
      result.amount = interestDebt.monthlyPayment;
    }
  }

  result.note = buildNote(text, removed);
  return result;
}

// ---------------------------------------------------------------------------

function extractDate(work: string, today: string, consume: (s: Span) => void): string {
  const rel = new RegExp(`${NOT_WORD_BEFORE}(?:bua|hom)\\s+(nay|qua|kia)${NOT_WORD_AFTER}`).exec(work);
  if (rel) {
    consume([rel.index, rel.index + rel[0].length]);
    return addDays(today, rel[1] === "nay" ? 0 : rel[1] === "qua" ? -1 : -2);
  }

  const abs = new RegExp(
    `(?:${NOT_WORD_BEFORE}ngay\\s+)?(?<![\\d/.-])(\\d{1,2})[/-](\\d{1,2})(?:[/-](\\d{4}|\\d{2}))?(?![\\d/-])`,
  ).exec(work);
  if (abs) {
    const day = abs[1].padStart(2, "0");
    const month = abs[2].padStart(2, "0");
    let candidate: string;
    if (abs[3]) {
      const year = abs[3].length === 2 ? `20${abs[3]}` : abs[3];
      candidate = `${year}-${month}-${day}`;
    } else {
      const year = Number(today.slice(0, 4));
      candidate = `${year}-${month}-${day}`;
      // "30/12" gõ vào ngày 2/1 → năm ngoái
      if (candidate > today) candidate = `${year - 1}-${month}-${day}`;
    }
    if (isValidDate(candidate)) {
      consume([abs.index, abs.index + abs[0].length]);
      return candidate;
    }
  }
  return today;
}

interface AmountHit {
  value: number;
  span: Span;
  sign?: "+" | "-";
}

/** Dấu chấm/phẩy là thập phân: "2.175" → 2.175, "1,5" → 1.5 */
function toDecimal(raw: string): number {
  return Number(raw.replace(",", "."));
}

/** Với đơn vị "k": nhóm 3 chữ số là phân cách hàng nghìn ("1.500k" = 1.500 nghìn), còn lại là thập phân */
function toNumber(raw: string): number {
  if (/^\d{1,3}([.,]\d{3})+$/.test(raw)) return Number(raw.replace(/[.,]/g, ""));
  return toDecimal(raw);
}

const NUM = String.raw`(?<![\d.,])(\d+(?:[.,]\d+)*)`;
const CURRENCY = String.raw`(?:\s*(?:d|dong|vnd))?`;

// Quy ước: k = nghìn · l = trăm nghìn · m = triệu
const AMOUNT_PATTERNS: { re: RegExp; value: (m: RegExpExecArray) => number }[] = [
  {
    // 3m, 2.175m, 3tr, 3tr5 (=3.500.000), 2 củ, 1 triệu rưỡi
    re: new RegExp(`${NUM}\\s*(?:tr|trieu|cu|m)(\\d{1,3})?(\\s+ruoi)?${CURRENCY}${NOT_WORD_AFTER}`, "g"),
    value: (m) => {
      let v = toDecimal(m[1]);
      if (m[2]) v += Number(m[2]) / 10 ** m[2].length;
      else if (m[3]) v += 0.5;
      return v * 1_000_000;
    },
  },
  {
    // 4l = 400.000 · 4.5l = 450.000
    re: new RegExp(`${NUM}\\s*l${CURRENCY}${NOT_WORD_AFTER}`, "g"),
    value: (m) => toDecimal(m[1]) * 100_000,
  },
  {
    // 35k, 35 nghìn, 2.5k, 1.500k (=1.500 nghìn)
    re: new RegExp(`${NUM}\\s*(?:k|nghin|ngan)${CURRENCY}${NOT_WORD_AFTER}`, "g"),
    value: (m) => toNumber(m[1]) * 1_000,
  },
  {
    // 2 trăm (=200.000), trăm rưỡi
    re: new RegExp(`${NUM}\\s*tram(\\s+ruoi)?${CURRENCY}${NOT_WORD_AFTER}`, "g"),
    value: (m) => (toNumber(m[1]) + (m[2] ? 0.5 : 0)) * 100_000,
  },
  {
    // 35.000, 1,200,000đ
    re: new RegExp(`(?<![\\d.,])(\\d{1,3}(?:[.,]\\d{3})+)${CURRENCY}${NOT_WORD_AFTER}`, "g"),
    value: (m) => toNumber(m[1]),
  },
];

function extractAmount(work: string): AmountHit | null {
  let best: { m: RegExpExecArray; value: number } | null = null;
  for (const { re, value } of AMOUNT_PATTERNS) {
    re.lastIndex = 0;
    for (let m = re.exec(work); m; m = re.exec(work)) {
      if (!best || m.index < best.m.index) best = { m, value: value(m) };
    }
  }

  if (!best) {
    // Số trơn không có đơn vị: dưới 1000 hiểu là nghìn ("cafe 35" → 35.000), còn lại lấy nguyên
    const bare = new RegExp(`(?<![\\d.,/])(\\d+)${CURRENCY}${NOT_WORD_AFTER}(?![/.,]\\d)`).exec(work);
    if (bare) {
      const n = Number(bare[1]);
      best = { m: bare, value: n < 1000 ? n * 1000 : n };
    }
  }
  if (!best || !(best.value > 0)) return null;

  let start = best.m.index;
  const end = best.m.index + best.m[0].length;
  let sign: AmountHit["sign"];
  const before = /([+-])\s*$/.exec(work.slice(0, start));
  if (before) {
    sign = before[1] as "+" | "-";
    start = before.index;
  }
  return { value: Math.round(best.value), span: [start, end], sign };
}

interface WalletHit {
  walletId: number;
  index: number;
  span: Span;
  connector: string | null;
}

const WALLET_CONNECTOR = /(?:^|\s)(tu|sang|qua|vao|bang|the|tk|vi)\s+$/;

function extractWallets(work: string, wallets: ParseContext["wallets"]): WalletHit[] {
  const raw: { walletId: number; start: number; end: number }[] = [];
  for (const w of wallets) {
    const phrases = new Set(
      [w.name, ...w.aliases.split(",")].map((p) => fold(p.normalize("NFC")).trim()).filter(Boolean),
    );
    for (const phrase of phrases) {
      const re = wordRegex(phrase);
      for (let m = re.exec(work); m; m = re.exec(work)) {
        raw.push({ walletId: w.id, start: m.index, end: m.index + m[0].length });
      }
    }
  }
  // Ưu tiên cụm dài hơn khi chồng lấn ("mb bank" > "mb")
  raw.sort((a, b) => b.end - b.start - (a.end - a.start));
  const kept: typeof raw = [];
  for (const r of raw) {
    if (!kept.some((k) => r.start < k.end && k.start < r.end)) kept.push(r);
  }
  kept.sort((a, b) => a.start - b.start);

  return kept.map((k) => {
    const conn = WALLET_CONNECTOR.exec(work.slice(0, k.start));
    const start = conn ? conn.index + (conn[0].length - conn[0].trimStart().length) : k.start;
    return { walletId: k.walletId, index: k.start, span: [start, k.end], connector: conn?.[1] ?? null };
  });
}

function detectTransfer(
  folded: string,
  hits: WalletHit[],
  wallets: ParseContext["wallets"],
): { from: number; to: number } | null {
  const has = (word: string) => wordRegex(word, "").test(folded);
  const distinct = hits.filter((h, i) => hits.findIndex((x) => x.walletId === h.walletId) === i);

  if (distinct.length >= 2 && (has("chuyen") || has("nap") || has("rut") || has("sang") || /->|=>/.test(folded))) {
    let from = distinct.find((h) => h.connector === "tu");
    let to = distinct.find((h) => h.connector === "sang" || h.connector === "vao" || h.connector === "qua");
    if (from && !to) to = distinct.find((h) => h !== from);
    if (to && !from) from = distinct.find((h) => h !== to);
    if (!from || !to) {
      const napIdx = folded.search(wordRegex("nap", ""));
      if (napIdx >= 0) {
        // "nạp momo 200k mb": ví ngay sau "nạp" là ví nhận
        to = distinct.find((h) => h.index > napIdx) ?? distinct[1];
        from = distinct.find((h) => h !== to);
      } else {
        [from, to] = distinct;
      }
    }
    if (from && to && from.walletId !== to.walletId) return { from: from.walletId, to: to.walletId };
  }

  // "rút 2tr mb" → từ MB về tiền mặt
  if (distinct.length === 1 && has("rut")) {
    const src = wallets.find((w) => w.id === distinct[0].walletId);
    const cash = wallets.find((w) => w.kind === "cash");
    if (src && cash && src.kind !== "cash") return { from: src.id, to: cash.id };
  }
  return null;
}

const DEBT_PATTERNS: { re: RegExp; action: DebtAction; needsExisting?: boolean }[] = [
  // cho Nam mượn / cho Nam vay
  { re: /(?<![a-z0-9])cho\s+(.+?)\s+(?:muon|vay)(?![a-z0-9])/d, action: "lend" },
  // Nam trả (nợ) — chỉ khi Nam đang nợ mình
  { re: /^\s*(.+?)\s+tra(?:\s+no)?(?:\s+tien)?\s*$/d, action: "collect", needsExisting: true },
  { re: /(?<![a-z0-9])thu\s+no(?:\s+(.+?))?\s*$/d, action: "collect" },
  { re: /(?<![a-z0-9])tra\s+(?:no|gop)(?:\s+(.+?))?\s*$/d, action: "repay" },
  // "thanh toán 500k cho Nguyên shb" — chỉ khi tên khớp khoản nợ đang có
  { re: /(?<![a-z0-9])thanh\s*toan\s+(?:no\s+)?(?:cho\s+)?(.+?)\s*$/d, action: "repay", needsExisting: true },
  // vay mẹ / mượn tiền của Nam
  { re: /(?<![a-z0-9])(?:muon|vay)(?:\s+(?:tien|cua))*\s+(.+?)\s*$/d, action: "borrow" },
  // trả mẹ — chỉ khi đang nợ mẹ
  { re: /(?<![a-z0-9])tra(?:\s+tien)?\s+(.+?)\s*$/d, action: "repay", needsExisting: true },
];

function detectDebt(
  work: string,
  text: string,
  debts: NonNullable<ParseContext["debts"]>,
): { action: DebtAction; debtId: number | null; name: string } | null {
  for (const { re, action, needsExisting } of DEBT_PATTERNS) {
    const m = re.exec(work);
    if (!m) continue;

    const [s, e] = m.indices?.[1] ?? [0, 0];
    const name = text.slice(s, e).replace(/\s+/g, " ").trim();
    const nameFolded = fold(name);
    const direction = DEBT_ACTION_DIRECTION[action];
    const candidates = debts.filter((d) => d.direction === direction);

    // Khớp tên (hoặc tên gọi tắt) theo cả hai chiều: "xe" ↔ "Trả góp xe"
    let best: { id: number; name: string; len: number } | null = null;
    if (nameFolded) {
      for (const d of candidates) {
        for (const phrase of [d.name, ...d.aliases.split(",")].map((p) => fold(p.normalize("NFC")).trim())) {
          if (!phrase) continue;
          const hit = wordRegex(phrase, "").test(nameFolded) || wordRegex(nameFolded, "").test(phrase);
          if (hit && (!best || phrase.length > best.len)) best = { id: d.id, name: d.name, len: phrase.length };
        }
      }
    }

    if (best) return { action, debtId: best.id, name: best.name };
    if (needsExisting) continue;
    if (!nameFolded && candidates.length === 1) {
      // "trả góp 1tr2" khi chỉ có đúng 1 khoản vay
      return { action, debtId: candidates[0].id, name: candidates[0].name };
    }
    if ((action === "lend" || action === "borrow") && !name) continue;
    return { action, debtId: null, name: name ? name[0].toUpperCase() + name.slice(1) : "" };
  }
  return null;
}

/** Tìm khoản nợ có tên (hoặc tên gọi tắt) xuất hiện trong câu */
function findDebtInText(
  work: string,
  debts: NonNullable<ParseContext["debts"]>,
  direction: DebtDirection,
): NonNullable<ParseContext["debts"]>[number] | null {
  let best: { debt: NonNullable<ParseContext["debts"]>[number]; len: number } | null = null;
  for (const d of debts.filter((x) => x.direction === direction)) {
    for (const phrase of [d.name, ...d.aliases.split(",")].map((x) => fold(x.normalize("NFC")).trim())) {
      if (!phrase) continue;
      if (wordRegex(phrase, "").test(work) && (!best || phrase.length > best.len)) best = { debt: d, len: phrase.length };
    }
  }
  return best?.debt ?? null;
}

/** "trả lãi ...", "tiền lãi ...", "lãi vay ..." → trả tiền lãi, không phải trả gốc */
function isInterestPayment(work: string): boolean {
  return /(?<![a-z0-9])(?:tra\s+lai|tien\s+lai|lai\s+vay|lai\s+ngoai|dong\s+lai)(?![a-z0-9])/.test(work);
}

// "<tên người> trả / chuyển (khoản) / gửi <số tiền>" → tiền người ta đưa cho mình
const INCOMING_PATTERNS = [
  /^(.+?)\s+tra(?:\s+no)?(?:\s+tien)?$/,
  /^(.+?)\s+chuyen(?:\s+khoan)?(?:\s+cho(?:\s+(?:toi|minh|t|em|anh|chi))?)?$/,
  /^(.+?)\s+gui(?:\s+cho)?(?:\s+(?:toi|minh|t|em|anh|chi))?$/,
];

function isIncomingFromPerson(work: string): boolean {
  // `work` đã bỏ số tiền/ví/ngày, chỉ còn phần chữ
  const rest = work.replace(/\s+/g, " ").trim();
  return rest.length > 0 && INCOMING_PATTERNS.some((re) => re.test(rest));
}

function matchCategory(
  work: string,
  workAccented: string,
  ctx: ParseContext,
  forcedType: CategoryType | null,
): ParseContext["categories"][number] | null {
  const byId = new Map(ctx.categories.map((c) => [c.id, c]));
  // Từ khóa (không dấu) khớp trên bản bỏ dấu; tên danh mục khớp đúng dấu
  // để "bình thường" không bị hiểu là danh mục "Thưởng".
  const candidates = [
    ...ctx.keywords.map((k) => ({
      phrase: fold(k.keyword.normalize("NFC")).trim(),
      categoryId: k.categoryId,
      accented: false,
    })),
    ...ctx.categories.map((c) => ({
      phrase: c.name.normalize("NFC").toLowerCase().trim(),
      categoryId: c.id,
      accented: true,
    })),
  ]
    .filter((c) => c.phrase && byId.has(c.categoryId))
    .filter((c) => !forcedType || byId.get(c.categoryId)!.type === forcedType)
    .sort((a, b) => b.phrase.length - a.phrase.length);

  for (const c of candidates) {
    const hit = c.accented
      ? new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(c.phrase)}(?![\\p{L}\\p{N}])`, "u").test(workAccented)
      : wordRegex(c.phrase, "").test(work);
    if (hit) return byId.get(c.categoryId)!;
  }
  return null;
}

function buildNote(text: string, removed: Span[]): string {
  let out = text;
  for (const [s, e] of [...removed].sort((a, b) => b[0] - a[0])) {
    out = `${out.slice(0, s)} ${out.slice(e)}`;
  }
  return out
    .replace(/\s+/g, " ")
    .replace(/^[\s,;:.+\-–]+|[\s,;:+\-–]+$/g, "")
    .trim();
}
