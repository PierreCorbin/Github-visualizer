import { NextRequest, NextResponse } from "next/server";

// Super-simple shared-password gate using HTTP Basic auth.
// The browser shows a native login dialog — enter anything for username,
// the configured password for the password. Creds are cached by the browser
// for the session, so devs only type it once per browser.
//
// Set DASHBOARD_PASSWORD in env to enable. Leave it unset to disable auth
// (useful for local dev — `npm run dev` without a password just works).
export function middleware(req: NextRequest) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return NextResponse.next();

  const auth = req.headers.get("authorization") ?? "";
  if (auth.startsWith("Basic ")) {
    try {
      const decoded = atob(auth.slice(6));
      const idx = decoded.indexOf(":");
      const provided = idx >= 0 ? decoded.slice(idx + 1) : decoded;
      if (provided === password) return NextResponse.next();
    } catch {
      // Fall through to 401
    }
  }
  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Flash Repo Visualizer", charset="UTF-8"',
    },
  });
}

export const config = {
  // Gate the app + API, skip Next.js internals and static files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
