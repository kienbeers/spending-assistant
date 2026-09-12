"use client";

import { useActionState } from "react";
import type { AuthState } from "@/app/auth-actions";

export function PasswordForm({
  action,
}: {
  action: (prev: AuthState, formData: FormData) => Promise<AuthState>;
}) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} className="space-y-3">
      <label className="block">
        <span className="text-[13px] text-ink-3">Mật khẩu hiện tại</span>
        <input name="oldPassword" type="password" required autoComplete="current-password" className="field mt-1" />
      </label>
      <label className="block">
        <span className="text-[13px] text-ink-3">Mật khẩu mới</span>
        <input name="newPassword" type="password" required autoComplete="new-password" className="field mt-1" />
      </label>
      <label className="block">
        <span className="text-[13px] text-ink-3">Nhập lại mật khẩu mới</span>
        <input name="confirm" type="password" required autoComplete="new-password" className="field mt-1" />
      </label>

      {state?.error && (
        <p role="alert" className="rounded-lg bg-expense/10 px-3 py-2 text-[13px] text-expense">
          {state.error}
        </p>
      )}

      <button type="submit" disabled={pending} className="btn-primary min-h-11 w-full disabled:opacity-60">
        {pending ? "Đang đổi…" : "Đổi mật khẩu"}
      </button>
      <p className="text-[12px] text-ink-3">Đổi xong, các thiết bị khác sẽ phải đăng nhập lại.</p>
    </form>
  );
}
