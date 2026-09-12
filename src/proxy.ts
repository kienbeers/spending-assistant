// Chặn sớm: không có cookie phiên thì chuyển thẳng sang trang đăng nhập, khỏi dựng trang rồi mới chuyển.
// Ở đây chỉ xem cookie có hay không (proxy không đọc được SQLite); phiên thật vẫn do requireUserId kiểm tra.
import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "ct_session";
const PUBLIC = ["/dang-nhap", "/dang-ky"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const signedIn = request.cookies.has(SESSION_COOKIE);
  const isPublic = PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  // Chỉ chặn chiều "chưa có cookie": cookie cũ/hết hiệu lực phải để trang tự kiểm tra,
  // nếu chặn cả chiều ngược lại sẽ thành vòng lặp chuyển hướng.
  if (!signedIn && !isPublic) return NextResponse.redirect(new URL("/dang-nhap", request.url));
  return NextResponse.next();
}

export const config = {
  // Bỏ qua file tĩnh và các lời gọi API (API tự trả 401)
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.(?:png|svg|ico|webmanifest)$).*)"],
};
