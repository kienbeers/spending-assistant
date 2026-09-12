import { Check, LogOut, Smartphone } from "lucide-react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { changePasswordAction, logoutAction, logoutOthersAction, updateNameAction } from "@/app/auth-actions";
import { ConfirmButton } from "@/components/confirm-button";
import { PasswordForm } from "@/components/password-form";
import { listSessions, SESSION_COOKIE } from "@/lib/auth";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Tài khoản" };

/** "12/09/2026 09:18" theo giờ Việt Nam */
function whenVN(iso: string | null) {
  if (!iso) return "chưa dùng";
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(new Date(iso));
}

export default async function AccountPage({ searchParams }: PageProps<"/tai-khoan">) {
  await connection();
  const user = await requireUser();
  const sp = await searchParams;
  const changed = sp["doi-mat-khau"] === "xong";
  const sessions = listSessions(user.id, (await cookies()).get(SESSION_COOKIE)?.value);
  const others = sessions.filter((s) => !s.current).length;

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Tài khoản</h1>
        <p className="text-[13px] text-ink-3">
          Đăng nhập bằng <span className="font-medium text-ink-2">{user.username}</span>. Mỗi tài khoản là một sổ
          riêng, không ai thấy dữ liệu của nhau.
        </p>
      </div>

      {changed && (
        <p className="card flex items-center gap-2 border-income/30 px-4 py-3 text-[14px] text-income">
          <Check size={16} /> Đã đổi mật khẩu.
        </p>
      )}

      <section className="card p-4">
        <h2 className="mb-3 font-semibold">Tên hiển thị</h2>
        <form action={updateNameAction} className="flex gap-2">
          <input
            name="name"
            defaultValue={user.name}
            maxLength={60}
            className="field min-w-0 flex-1"
            aria-label="Tên hiển thị"
          />
          <button type="submit" className="btn-ghost px-4">
            Lưu
          </button>
        </form>
      </section>

      <section className="card p-4">
        <h2 className="mb-3 font-semibold">Đổi mật khẩu</h2>
        <PasswordForm action={changePasswordAction} />
      </section>

      <section className="card p-4">
        <h2 className="flex items-center gap-2 font-semibold">
          <Smartphone size={18} className="text-accent" /> Thiết bị đang đăng nhập
        </h2>
        <ul className="mt-3 divide-y divide-line">
          {sessions.map((s) => (
            <li key={s.id} className="flex items-baseline justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="block truncate text-[15px] font-medium">
                  {s.device || "Không rõ thiết bị"}
                  {s.current && <span className="ml-2 text-[12px] font-normal text-accent">thiết bị này</span>}
                </span>
                <span className="block text-[12px] text-ink-3">
                  Đăng nhập {whenVN(s.createdAt)} · dùng gần nhất {whenVN(s.lastSeen)}
                </span>
              </span>
            </li>
          ))}
        </ul>
        {others > 0 && (
          <form action={logoutOthersAction} className="mt-3">
            <ConfirmButton className="btn-ghost w-full" message={`Đăng xuất ${others} thiết bị khác?`}>
              Đăng xuất khỏi {others} thiết bị khác
            </ConfirmButton>
          </form>
        )}
      </section>

      <form action={logoutAction}>
        <button type="submit" className="btn-ghost w-full text-expense">
          <LogOut size={16} /> Đăng xuất khỏi thiết bị này
        </button>
      </form>
    </div>
  );
}
