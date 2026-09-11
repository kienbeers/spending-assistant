import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { SEED_CATEGORIES, SEED_WALLETS } from "./seed";
import { fold } from "./text";

const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), "data", "chi-tieu.db");

// CHÚ Ý: chỉ được THÊM VÀO CUỐI danh sách. Chèn vào giữa sẽ làm lệch user_version
// của các máy đã nâng cấp và chạy lại sai bản.
const MIGRATIONS: string[] = [
  `
  CREATE TABLE wallets (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('bank', 'ewallet', 'cash')),
    aliases TEXT NOT NULL DEFAULT '',
    initial_balance INTEGER NOT NULL DEFAULT 0,
    color TEXT NOT NULL DEFAULT '#64748b',
    is_default INTEGER NOT NULL DEFAULT 0,
    sort INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE categories (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('expense', 'income')),
    icon TEXT NOT NULL DEFAULT '📦',
    sort INTEGER NOT NULL DEFAULT 0,
    UNIQUE (name, type)
  );

  -- Từ khóa lưu dạng không dấu, chữ thường
  CREATE TABLE keywords (
    id INTEGER PRIMARY KEY,
    keyword TEXT NOT NULL UNIQUE,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE
  );

  CREATE TABLE transactions (
    id INTEGER PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('expense', 'income', 'transfer')),
    amount INTEGER NOT NULL CHECK (amount > 0),
    wallet_id INTEGER NOT NULL REFERENCES wallets(id),
    to_wallet_id INTEGER REFERENCES wallets(id),
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    note TEXT NOT NULL DEFAULT '',
    occurred_on TEXT NOT NULL, -- YYYY-MM-DD theo giờ VN
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK ((type = 'transfer') = (to_wallet_id IS NOT NULL))
  );
  CREATE INDEX idx_tx_date ON transactions(occurred_on);
  CREATE INDEX idx_tx_wallet ON transactions(wallet_id);
  `,
  `
  -- Sổ nợ. Số còn nợ = opening_amount + tiền phát sinh thêm − tiền đã trả (tính từ transactions.debt_id)
  CREATE TABLE debts (
    id INTEGER PRIMARY KEY,
    direction TEXT NOT NULL CHECK (direction IN ('lend', 'borrow')), -- lend: mình cho vay, borrow: mình đi vay
    name TEXT NOT NULL,
    aliases TEXT NOT NULL DEFAULT '',
    opening_amount INTEGER NOT NULL DEFAULT 0 CHECK (opening_amount >= 0), -- nợ có sẵn, không đi qua ví
    interest_rate REAL,     -- %/năm, để tham khảo
    monthly_payment INTEGER, -- trả góp mỗi tháng
    payment_day INTEGER CHECK (payment_day BETWEEN 1 AND 31),
    due_date TEXT,
    note TEXT NOT NULL DEFAULT '',
    closed INTEGER NOT NULL DEFAULT 0,
    created_on TEXT NOT NULL
  );
  -- Giao dịch gắn với khoản nợ: không tính vào thu/chi, chỉ làm thay đổi số dư ví & số nợ
  ALTER TABLE transactions ADD COLUMN debt_id INTEGER REFERENCES debts(id);
  CREATE INDEX idx_tx_debt ON transactions(debt_id);

  -- Khoản chi cố định (tiền nhà, hóa đơn...) để tách khỏi chi linh hoạt
  ALTER TABLE categories ADD COLUMN is_fixed INTEGER NOT NULL DEFAULT 0;
  UPDATE categories SET is_fixed = 1 WHERE name IN ('Nhà ở', 'Hóa đơn');

  CREATE TABLE budgets (
    month TEXT NOT NULL,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL CHECK (amount >= 0),
    PRIMARY KEY (month, category_id)
  );

  CREATE TABLE goals (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    target_amount INTEGER NOT NULL CHECK (target_amount > 0),
    saved_amount INTEGER NOT NULL DEFAULT 0,
    target_date TEXT,
    created_on TEXT NOT NULL
  );

  -- Kết quả AI lưu lại (model local chạy chậm, không sinh lại mỗi lần mở trang)
  CREATE TABLE ai_reports (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,
    month TEXT NOT NULL,
    content TEXT NOT NULL,
    model TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX idx_ai_reports ON ai_reports(kind, month);
  `,
  `
  -- Thẻ tín dụng là một loại ví: quẹt thẻ = chi tiêu (số dư âm dần), thanh toán thẻ = chuyển tiền vào ví thẻ.
  -- SQLite không sửa được CHECK nên phải dựng lại bảng wallets.
  CREATE TABLE wallets_new (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('bank', 'ewallet', 'cash', 'credit')),
    aliases TEXT NOT NULL DEFAULT '',
    initial_balance INTEGER NOT NULL DEFAULT 0,
    color TEXT NOT NULL DEFAULT '#64748b',
    is_default INTEGER NOT NULL DEFAULT 0,
    sort INTEGER NOT NULL DEFAULT 0,
    credit_limit INTEGER,   -- chỉ thẻ tín dụng
    payment_day INTEGER CHECK (payment_day BETWEEN 1 AND 31),
    monthly_payment INTEGER -- để trống = thanh toán toàn bộ dư nợ
  );
  INSERT INTO wallets_new (id, name, kind, aliases, initial_balance, color, is_default, sort)
    SELECT id, name, kind, aliases, initial_balance, color, is_default, sort FROM wallets;
  DROP TABLE wallets;
  ALTER TABLE wallets_new RENAME TO wallets;
  `,
  `
  -- Vay lãi ngoài: mỗi tháng chỉ trả lãi, gốc không giảm → tiền lãi ghi là khoản chi, không phải trả nợ
  ALTER TABLE debts ADD COLUMN payment_is_interest INTEGER NOT NULL DEFAULT 0;
  INSERT OR IGNORE INTO categories (name, type, icon, sort, is_fixed) VALUES ('Lãi vay', 'expense', '🏦', 100, 1);
  INSERT OR IGNORE INTO keywords (keyword, category_id)
    SELECT 'lai vay', id FROM categories WHERE name = 'Lãi vay' AND type = 'expense';
  INSERT OR IGNORE INTO keywords (keyword, category_id)
    SELECT 'lai ngoai', id FROM categories WHERE name = 'Lãi vay' AND type = 'expense';
  `,
  `
  -- Cài đặt dạng khóa/giá trị (vd. thu nhập dự kiến hằng tháng)
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  `
  -- Khoản định kỳ: số tiền có thể đổi mỗi tháng (tiền điện, thuê bao tính bằng USD...)
  CREATE TABLE recurring (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    amount INTEGER,        -- số tiền dự kiến (VND), để trống nếu chưa rõ
    amount_usd REAL,       -- khoản tính bằng USD (vd. 22)
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    wallet_id INTEGER REFERENCES wallets(id),
    day_of_month INTEGER CHECK (day_of_month BETWEEN 1 AND 31),
    note TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    sort INTEGER NOT NULL DEFAULT 0
  );
  ALTER TABLE transactions ADD COLUMN recurring_id INTEGER REFERENCES recurring(id);
  CREATE INDEX idx_tx_recurring ON transactions(recurring_id);
  `,
  `
  -- Kế hoạch mục tiêu: mong muốn của bạn + định hướng AI gần nhất
  CREATE TABLE plans (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    goal_text TEXT NOT NULL DEFAULT '',
    target_amount INTEGER,
    target_date TEXT,
    extra_per_month INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'done', 'archived')),
    ai_content TEXT,
    ai_model TEXT,
    ai_at TEXT,
    created_on TEXT NOT NULL
  );
  `,
  `
  -- Khoản định kỳ nhận cả khoản THU (nhiều nguồn thu nhập), không chỉ khoản chi
  ALTER TABLE recurring ADD COLUMN kind TEXT NOT NULL DEFAULT 'expense' CHECK (kind IN ('expense', 'income'));
  `,
];

function open(): Database.Database {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  // Cho phép tìm kiếm không dấu: WHERE fold(note) LIKE ...
  db.function("fold", { deterministic: true }, (s: unknown) => (typeof s === "string" ? fold(s) : s));

  migrate(db);
  return db;
}

/**
 * Chạy các bản nâng cấp còn thiếu, mỗi bản một transaction riêng và ghi số phiên bản ngay sau đó.
 * Bỏ qua lỗi "đã có sẵn" để chạy lại không sao (tránh kẹt khi số phiên bản lệch).
 */
function migrate(db: Database.Database) {
  const start = db.pragma("user_version", { simple: true }) as number;
  if (start >= MIGRATIONS.length) return;

  // Dựng lại bảng (đổi CHECK) cần tắt khóa ngoại; pragma không đổi được khi đang trong transaction
  db.pragma("foreign_keys = OFF");
  try {
    for (let v = start; v < MIGRATIONS.length; v++) {
      db.exec("BEGIN");
      try {
        for (const sql of splitStatements(MIGRATIONS[v])) runTolerant(db, sql);
        db.exec(`PRAGMA user_version = ${v + 1}`);
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw new Error(`Nâng cấp dữ liệu bước ${v + 1} thất bại: ${e instanceof Error ? e.message : e}`);
      }
    }
  } finally {
    db.pragma("foreign_keys = ON");
  }

  // Dữ liệu mẫu chỉ tạo cho DB mới, và chạy sau khi đã có đủ cột của mọi bản nâng cấp
  if (start === 0) db.transaction(() => seed(db))();

  const broken = db.pragma("foreign_key_check") as unknown[];
  if (broken.length) throw new Error(`Dữ liệu bị hỏng khóa ngoại sau khi nâng cấp: ${JSON.stringify(broken)}`);
}

/** Tách file SQL thành từng câu lệnh (migration trong file này không có dấu ; trong chuỗi) */
function splitStatements(sql: string): string[] {
  return sql
    .split(";")
    // bỏ các dòng ghi chú ở đầu mỗi câu, không bỏ cả câu lệnh
    .map((part) => part.replace(/^(?:\s*--[^\n]*\n?)+/, "").trim())
    .filter(Boolean);
}

/** Lỗi kiểu "đã tồn tại" nghĩa là bước này từng chạy rồi → bỏ qua */
const ALREADY_APPLIED = /already exists|duplicate column name/i;

function runTolerant(db: Database.Database, sql: string) {
  try {
    db.exec(`${sql};`);
  } catch (e) {
    if (!(e instanceof Error) || !ALREADY_APPLIED.test(e.message)) throw e;
  }
}

function seed(db: Database.Database) {
  const insWallet = db.prepare(
    "INSERT INTO wallets (name, kind, aliases, color, is_default, sort) VALUES (?, ?, ?, ?, ?, ?)",
  );
  SEED_WALLETS.forEach((w, i) => insWallet.run(w.name, w.kind, w.aliases, w.color, w.isDefault ? 1 : 0, i));

  // OR IGNORE: bản nâng cấp có thể đã thêm sẵn vài danh mục (vd. "Lãi vay")
  const insCat = db.prepare("INSERT OR IGNORE INTO categories (name, type, icon, sort) VALUES (?, ?, ?, ?)");
  const catId = db.prepare("SELECT id FROM categories WHERE name = ? AND type = ?").pluck();
  const insKw = db.prepare("INSERT OR IGNORE INTO keywords (keyword, category_id) VALUES (?, ?)");
  SEED_CATEGORIES.forEach((c, i) => {
    insCat.run(c.name, c.type, c.icon, i);
    const id = catId.get(c.name, c.type);
    for (const k of c.keywords) insKw.run(k, id);
  });
  db.exec("UPDATE categories SET is_fixed = 1 WHERE name IN ('Nhà ở', 'Hóa đơn', 'Lãi vay')");
}

export const MIGRATIONS_COUNT = MIGRATIONS.length;

/** Mở một file DB bất kỳ và nâng cấp (dùng cho test) */
export function openDbAt(file: string): Database.Database {
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.function("fold", { deterministic: true }, (x: unknown) => (typeof x === "string" ? fold(x) : x));
  migrate(db);
  return db;
}

// Mở khi dùng lần đầu; giữ 1 kết nối duy nhất qua các lần hot-reload khi dev
const g = globalThis as unknown as { __chiTieuDb?: Database.Database };
export function getDb(): Database.Database {
  return (g.__chiTieuDb ??= open());
}
