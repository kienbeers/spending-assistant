"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  changePassword,
  createSession,
  destroyOtherSessions,
  destroySession,
  deviceLabel,
  getUserByUsername,
  normalizeUsername,
  registerUser,
  SESSION_COOKIE,
  updateUserName,
  verifyPassword,
} from "@/lib/auth";
import { requireUserId } from "@/lib/session";

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
  const device = deviceLabel((await headers()).get("user-agent") ?? "");
  const { token, expiresAt } = createSession(userId, device);
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

// --- Tài khoản --------------------------------------------------------------------

export async function updateNameAction(formData: FormData) {
  const userId = await requireUserId();
  updateUserName(userId, z.string().trim().max(60).parse(formData.get("name") ?? ""));
  revalidatePath("/", "layout");
}

export async function changePasswordAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const userId = await requireUserId();
  const parsed = z
    .object({
      oldPassword: z.string().min(1, "Nhập mật khẩu hiện tại"),
      newPassword: z.string().min(4, "Mật khẩu mới cần ít nhất 4 ký tự").max(200),
      confirm: z.string(),
    })
    .refine((d) => d.newPassword === d.confirm, { message: "Hai ô mật khẩu mới không giống nhau" })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ", username: "" };

  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  try {
    changePassword(userId, parsed.data.oldPassword, parsed.data.newPassword, token);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Không đổi được mật khẩu", username: "" };
  }
  revalidatePath("/", "layout");
  redirect("/tai-khoan?doi-mat-khau=xong");
}

/** Đăng xuất khỏi mọi thiết bị khác, giữ thiết bị đang dùng */
export async function logoutOthersAction() {
  const userId = await requireUserId();
  destroyOtherSessions(userId, (await cookies()).get(SESSION_COOKIE)?.value);
  revalidatePath("/", "layout");
}
