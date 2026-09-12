"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  createSession,
  destroySession,
  getUserByUsername,
  normalizeUsername,
  registerUser,
  SESSION_COOKIE,
  verifyPassword,
} from "@/lib/auth";

// React tự xóa form sau khi action chạy xong → trả lại tên đăng nhập để khỏi phải gõ lại
export type AuthState = { error: string; username: string } | null;

const credentials = z.object({
  username: z
    .string()
    .trim()
    .min(3, "Tên đăng nhập cần ít nhất 3 ký tự")
    .max(32, "Tên đăng nhập tối đa 32 ký tự")
    .regex(/^[a-zA-Z0-9._-]+$/, "Tên đăng nhập chỉ gồm chữ, số và . _ -"),
  password: z.string().min(4, "Mật khẩu cần ít nhất 4 ký tự").max(200),
});

async function startSession(userId: number) {
  const { token, expiresAt } = createSession(userId);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function loginAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const typed = String(formData.get("username") ?? "");
  const parsed = credentials.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ", username: typed };

  const user = getUserByUsername(parsed.data.username);
  // Cùng một câu báo lỗi cho sai tên và sai mật khẩu
  if (!user || !verifyPassword(parsed.data.password, user.passwordHash)) {
    return { error: "Sai tên đăng nhập hoặc mật khẩu", username: typed };
  }
  await startSession(user.id);
  redirect("/");
}

export async function registerAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const typed = String(formData.get("username") ?? "");
  const parsed = credentials.extend({ name: z.string().trim().max(60).default("") }).safeParse(
    Object.fromEntries(formData),
  );
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ", username: typed };

  let userId: number;
  try {
    userId = registerUser({
      username: normalizeUsername(parsed.data.username),
      name: parsed.data.name,
      password: parsed.data.password,
    }).id;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Không tạo được tài khoản", username: typed };
  }
  await startSession(userId);
  redirect("/");
}

export async function logoutAction() {
  const jar = await cookies();
  destroySession(jar.get(SESSION_COOKIE)?.value);
  jar.delete(SESSION_COOKIE);
  redirect("/dang-nhap");
}
