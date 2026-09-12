import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { loginAction } from "@/app/auth-actions";
import { AuthForm } from "@/components/auth-form";
import { countUsers } from "@/lib/auth";
import { getCurrentUser } from "@/lib/session";

export const metadata: Metadata = { title: "Đăng nhập" };

export default async function LoginPage() {
  await connection();
  if (await getCurrentUser()) redirect("/");
  // Chưa có tài khoản nào → vào thẳng trang đăng ký
  if (countUsers() === 0) redirect("/dang-ky");

  return (
    <div className="mx-auto max-w-sm space-y-4 pt-8">
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight">
          Chi tiêu<span className="text-accent">.</span>
        </h1>
        <p className="mt-1 text-[13px] text-ink-3">Đăng nhập để mở sổ chi tiêu của bạn</p>
      </div>
      <section className="card p-4">
        <AuthForm action={loginAction} mode="login" submitLabel="Đăng nhập" />
      </section>
      <p className="text-center text-[13px] text-ink-3">
        Chưa có tài khoản?{" "}
        <Link href="/dang-ky" className="font-medium text-accent">
          Đăng ký
        </Link>
      </p>
    </div>
  );
}
