import type { Metadata, Viewport } from "next";
import { Be_Vietnam_Pro } from "next/font/google";
import { AppNav } from "@/components/app-nav";
import { getCurrentUser } from "@/lib/session";
import "./globals.css";

const font = Be_Vietnam_Pro({
  variable: "--font-app",
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: { default: "Chi tiêu", template: "%s · Chi tiêu" },
  description: "Sổ chi tiêu cá nhân",
  appleWebApp: { capable: true, title: "Chi tiêu", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f1ea" },
    { media: "(prefers-color-scheme: dark)", color: "#12110f" },
  ],
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Chưa đăng nhập (trang đăng nhập/đăng ký) thì không hiện thanh điều hướng
  const user = await getCurrentUser();
  return (
    <html lang="vi" className={`${font.variable} antialiased`}>
      <body className="min-h-dvh font-sans">
        {user && <AppNav user={user} />}
        <main className={`mx-auto w-full max-w-5xl px-4 pt-4 md:px-6 md:pt-6 ${user ? "pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-12" : "pb-12"}`}>
          {children}
        </main>
      </body>
    </html>
  );
}
