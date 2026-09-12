// Lấy người dùng đang đăng nhập từ cookie phiên. Mọi trang/action đều đi qua đây.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionUser, SESSION_COOKIE, type User } from "./auth";

export async function getCurrentUser(): Promise<User | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return getSessionUser(token);
}

/** Chưa đăng nhập → chuyển sang trang đăng nhập. */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/dang-nhap");
  return user;
}

export async function requireUserId(): Promise<number> {
  return (await requireUser()).id;
}

/** Dùng trong route handler: chưa đăng nhập thì trả 401 thay vì chuyển trang. */
export async function apiUserId(): Promise<number | null> {
  return (await getCurrentUser())?.id ?? null;
}

export const UNAUTHORIZED = () => Response.json({ error: "Chưa đăng nhập" }, { status: 401 });
