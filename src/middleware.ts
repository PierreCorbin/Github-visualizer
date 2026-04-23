import { NextRequest, NextResponse } from "next/server";

// Cookie-based password gate.
// Unset DASHBOARD_PASSWORD = no auth (dev). Set it and every request to the
// app or /api is gated on a cookie you get by submitting the login form.
const COOKIE = "dashboard-auth";

export function middleware(req: NextRequest) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return NextResponse.next();

  const path = req.nextUrl.pathname;
  // Always let the login screen + its API through.
  if (path === "/login" || path === "/api/login") return NextResponse.next();

  const cookie = req.cookies.get(COOKIE)?.value;
  if (cookie === password) return NextResponse.next();

  // API calls get a clean 401 so fetch() can handle it.
  if (path.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  // Page calls redirect to /login (preserving where they were headed).
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  if (path !== "/") url.searchParams.set("next", path);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
