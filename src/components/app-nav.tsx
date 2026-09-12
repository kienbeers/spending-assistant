"use client";

import { ChartColumn, Flag, HandCoins, LayoutDashboard, List, LogOut, Plus, Tags, Target, Wallet } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAction } from "@/app/auth-actions";

// Thanh dưới (điện thoại): 4 mục chính + nút Thêm ở giữa
const PRIMARY = [
  { href: "/", label: "Tổng quan", icon: LayoutDashboard },
  { href: "/phan-tich", label: "Phân tích", icon: ChartColumn },
  { href: "/them", label: "Thêm", icon: Plus, add: true },
  { href: "/no", label: "Sổ nợ", icon: HandCoins },
  { href: "/ke-hoach", label: "Kế hoạch", icon: Target },
];

// Thanh trên (điện thoại): các trang phụ
const SECONDARY = [
  { href: "/muc-tieu", label: "Mục tiêu", icon: Flag },
  { href: "/giao-dich", label: "Giao dịch", icon: List },
  { href: "/vi", label: "Ví", icon: Wallet },
  { href: "/danh-muc", label: "Danh mục", icon: Tags },
];

export function AppNav({ user }: { user: { name: string; username: string } }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <>
      {/* Desktop: một thanh trên chứa tất cả */}
      <header className="sticky top-0 z-30 hidden border-b border-line bg-bg/90 backdrop-blur md:block">
        <nav className="mx-auto flex h-14 max-w-5xl items-center gap-1 px-6">
          <Link href="/" className="mr-4 text-[17px] font-bold tracking-tight">
            Chi tiêu<span className="text-accent">.</span>
          </Link>
          {[...PRIMARY.filter((i) => !i.add), ...SECONDARY].map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              aria-current={isActive(href) ? "page" : undefined}
              className="rounded-lg px-2.5 py-2 text-sm font-medium text-ink-3 transition hover:text-ink aria-[current=page]:bg-surface-2 aria-[current=page]:text-ink"
            >
              {label}
            </Link>
          ))}
          <Link
            href="/them"
            className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3 text-sm font-medium text-accent-ink"
          >
            <Plus size={16} strokeWidth={2.5} /> Thêm
          </Link>
          <form action={logoutAction} className="ml-2 flex items-center gap-1.5">
            <span className="max-w-32 truncate text-sm text-ink-3">{user.name || user.username}</span>
            <button
              type="submit"
              aria-label="Đăng xuất"
              title="Đăng xuất"
              className="flex size-9 items-center justify-center rounded-lg text-ink-3 transition hover:text-ink"
            >
              <LogOut size={17} />
            </button>
          </form>
        </nav>
      </header>

      {/* Mobile: thanh trên gọn */}
      <header className="sticky top-0 z-30 border-b border-line bg-bg/90 pt-[env(safe-area-inset-top)] backdrop-blur md:hidden">
        <nav className="flex h-12 items-center px-4" aria-label="Trang phụ">
          <Link href="/" className="flex-1 text-[16px] font-bold tracking-tight">
            Chi tiêu<span className="text-accent">.</span>
          </Link>
          {SECONDARY.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-label={label}
              aria-current={isActive(href) ? "page" : undefined}
              className="flex size-11 items-center justify-center rounded-full text-ink-3 active:bg-surface-2 aria-[current=page]:text-accent"
            >
              <Icon size={21} />
            </Link>
          ))}
          <form action={logoutAction} className="flex">
            <button
              type="submit"
              aria-label={`Đăng xuất ${user.name || user.username}`}
              className="flex size-11 items-center justify-center rounded-full text-ink-3 active:bg-surface-2"
            >
              <LogOut size={20} />
            </button>
          </form>
        </nav>
      </header>

      {/* Mobile: thanh dưới trong tầm ngón cái */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
        aria-label="Điều hướng chính"
      >
        <ul className="mx-auto grid h-16 max-w-md grid-cols-5">
          {PRIMARY.map(({ href, label, icon: Icon, add }) => (
            <li key={href} className="flex">
              <Link
                href={href}
                aria-current={isActive(href) ? "page" : undefined}
                className={`flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
                  isActive(href) ? "text-accent" : "text-ink-3"
                }`}
              >
                {add ? (
                  <span className="flex size-11 items-center justify-center rounded-full bg-accent text-accent-ink shadow-sm">
                    <Icon size={24} strokeWidth={2.5} />
                    <span className="sr-only">{label}</span>
                  </span>
                ) : (
                  <>
                    <Icon size={22} strokeWidth={isActive(href) ? 2.4 : 1.8} />
                    {label}
                  </>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
