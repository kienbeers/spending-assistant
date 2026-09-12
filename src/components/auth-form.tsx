"use client";

import { useActionState } from "react";
import type { AuthState } from "@/app/auth-actions";

export function AuthForm({
  action,
  mode,
  submitLabel,
}: {
  action: (prev: AuthState, formData: FormData) => Promise<AuthState>;
  mode: "login" | "register";
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} className="space-y-3">
      {mode === "register" && (
        <label className="block">
          <span className="text-[13px] text-ink-3">Tên hiển thị</span>
          <input name="name" autoComplete="name" maxLength={60} className="field mt-1" placeholder="Tuỳ chọn" />
        </label>
      )}
      <label className="block">
        <span className="text-[13px] text-ink-3">Tên đăng nhập</span>
        <input
          name="username"
          required
          defaultValue={state?.username ?? ""}
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="username"
          maxLength={32}
          className="field mt-1"
        />
      </label>
      <label className="block">
        <span className="text-[13px] text-ink-3">Mật khẩu</span>
        <input
          name="password"
          type="password"
          required
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          className="field mt-1"
        />
      </label>

      {state?.error && (
        <p role="alert" className="rounded-lg bg-expense/10 px-3 py-2 text-[13px] text-expense">
          {state.error}
        </p>
      )}

      <button type="submit" disabled={pending} className="btn-primary min-h-11 w-full disabled:opacity-60">
        {pending ? "Đang xử lý…" : submitLabel}
      </button>
    </form>
  );
}
