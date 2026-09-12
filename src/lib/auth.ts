// Đăng nhập / đăng ký. Mật khẩu băm bằng scrypt của Node, phiên đăng nhập lưu trong DB.
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { getDb } from "./db";
import { SEED_CATEGORIES, SEED_WALLETS } from "./seed";

export interface User {
  id: number;
  username: string;
  name: string;
}

export const SESSION_COOKIE = "ct_session";
const SESSION_DAYS = 60;
const SCRYPT_KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string | null): boolean {
  if (!stored) return false;
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const actual = scryptSync(password, salt, SCRYPT_KEYLEN);
  const expected = Buffer.from(hash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Chuẩn hóa tên đăng nhập: chữ thường, bỏ khoảng trắng thừa */
export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function getUserByUsername(username: string): (User & { passwordHash: string | null }) | null {
  return (
    (getDb()
      .prepare("SELECT id, username, name, password_hash AS passwordHash FROM users WHERE username = ?")
      .get(normalizeUsername(username)) as (User & { passwordHash: string | null }) | undefined) ?? null
  );
}

export function getUser(id: number): User | null {
  return (getDb().prepare("SELECT id, username, name FROM users WHERE id = ?").get(id) as User | undefined) ?? null;
}

export function countUsers(): number {
  return (getDb().prepare("SELECT COUNT(*) AS n FROM users WHERE password_hash IS NOT NULL").get() as { n: number }).n;
}

/**
 * Tài khoản đầu tiên nhận luôn dữ liệu đang có (người dùng số 1),
 * các tài khoản sau là sổ mới và được tạo ví/danh mục mặc định.
 */
export function registerUser(input: { username: string; name: string; password: string }): User {
  const db = getDb();
  const username = normalizeUsername(input.username);
  if (getUserByUsername(username)) throw new Error("Tên đăng nhập này đã có người dùng");

  const owner = db.prepare("SELECT id FROM users WHERE id = 1 AND password_hash IS NULL").get() as
    | { id: number }
    | undefined;
  const passwordHash = hashPassword(input.password);

  if (owner) {
    db.prepare("UPDATE users SET username = ?, name = ?, password_hash = ? WHERE id = 1").run(
      username,
      input.name || username,
      passwordHash,
    );
    return { id: 1, username, name: input.name || username };
  }

  const r = db
    .prepare("INSERT INTO users (username, name, password_hash) VALUES (?, ?, ?)")
    .run(username, input.name || username, passwordHash);
  const id = Number(r.lastInsertRowid);
  seedNewUser(id);
  return { id, username, name: input.name || username };
}

/** Ví và danh mục mặc định cho người dùng mới */
function seedNewUser(userId: number) {
  const db = getDb();
  const insWallet = db.prepare(
    "INSERT INTO wallets (user_id, name, kind, aliases, color, is_default, sort) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const insCat = db.prepare("INSERT INTO categories (user_id, name, type, icon, sort) VALUES (?, ?, ?, ?, ?)");
  const insKw = db.prepare("INSERT OR IGNORE INTO keywords (user_id, keyword, category_id) VALUES (?, ?, ?)");

  db.transaction(() => {
    for (const [i, w] of SEED_WALLETS.entries()) {
      insWallet.run(userId, w.name, w.kind, w.aliases, w.color, w.isDefault ? 1 : 0, i);
    }
    for (const [i, c] of SEED_CATEGORIES.entries()) {
      const { lastInsertRowid } = insCat.run(userId, c.name, c.type, c.icon, i);
      for (const k of c.keywords) insKw.run(userId, k, lastInsertRowid);
    }
    db.prepare("UPDATE categories SET is_fixed = 1 WHERE user_id = ? AND name IN ('Nhà ở', 'Hóa đơn', 'Lãi vay')").run(
      userId,
    );
  })();
}

// --- Phiên đăng nhập ------------------------------------------------------------

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Tạo phiên mới, trả về token để lưu vào cookie */
export function createSession(userId: number): { token: string; expiresAt: Date } {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  getDb()
    .prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .run(hashToken(token), userId, expiresAt.toISOString());
  return { token, expiresAt };
}

export function getSessionUser(token: string | undefined): User | null {
  if (!token) return null;
  const db = getDb();
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(new Date().toISOString());
  return (
    (db
      .prepare(
        `SELECT u.id, u.username, u.name FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at >= ?`,
      )
      .get(hashToken(token), new Date().toISOString()) as User | undefined) ?? null
  );
}

export function destroySession(token: string | undefined) {
  if (!token) return;
  getDb().prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
}
