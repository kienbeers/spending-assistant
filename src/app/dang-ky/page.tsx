import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { registerAction } from "@/app/auth-actions";
import { AuthForm } from "@/components/auth-form";
import { countUsers } from "@/lib/auth";
import { getCurrentUser } from "@/lib/session";

export const metadata: Metadata = { title: "Đăng ký" };

export default async function RegisterPage() {
  await connection();
  if (await getCurrentUser()) redirect("/");
  const first = countUsers() === 0;

  return (
    <div className="mx-auto max-w-sm space-y-4 pt-8">
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight">
          Chi tiêu<span className="text-accent">.</span>
        </h1>
        <p className="mt-1 text-[13px] text-ink-3">
          {first ? "Tạo tài khoản chủ sổ — dữ liệu đang có sẽ thuộc về tài khoản này" : "Mỗi tài khoản là một sổ riêng"}
        </p>
      </div>
      <section className="card p-4">
        <AuthForm action={registerAction} mode="register" submitLabel="Tạo tài khoản" />
      </section>
      {!first && (
        <p className="text-center text-[13px] text-ink-3">
          Đã có tài khoản?{" "}
          <Link href="/dang-nhap" className="font-medium text-accent">
            Đăng nhập
          </Link>
        </p>
      )}
    </div>
  );
}
