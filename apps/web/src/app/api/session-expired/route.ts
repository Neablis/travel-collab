import { NextResponse } from "next/server";
import { isSessionCookieName, SIGNED_IN_HINT_COOKIE } from "@/lib/sessionHint";
import { safeCallbackUrl } from "@/lib/safeCallbackUrl";
import { auth } from "@/server/auth";

// Where `servedForApp` sends a session cookie that `auth()` refuses, because
// the account's security epoch moved past it (M62). A server component's
// `redirect()` cannot clear a cookie, and the proxy cannot tell this case (it
// reads no database), so left to /signin the browser kept both the session
// cookie and the `tc_signed_in` hint and the landing sent it round again. This
// is the one place that clears them, then goes to sign-in carrying the page the
// person was on. Auth.js's own sign-out is a POST with a CSRF token, which a
// redirect cannot make.
//
// A GET that clears cookies would let any page sign a visitor out, so it asks
// `auth()` first and only clears what it refuses.
/** Clears a session cookie `auth()` refuses and redirects to sign-in; a session it accepts goes straight back. */
export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("callbackUrl");
  const back = safeCallbackUrl(raw);
  // A relative Location, so the origin is the browser's own, never one rebuilt from a Host header.
  if ((await auth()) !== null) return new NextResponse(null, { status: 307, headers: { Location: back } });

  const to = raw !== null && back === raw ? `/signin?callbackUrl=${encodeURIComponent(back)}` : "/signin";
  const response = new NextResponse(null, { status: 307, headers: { Location: to } });
  const names = (request.headers.get("cookie") ?? "").split(";").map((pair) => pair.split("=")[0]!.trim());
  for (const name of names.filter(isSessionCookieName)) {
    // A `__Secure-` cookie is only accepted, and so only deleted, with `Secure`.
    response.cookies.set(name, "", { path: "/", maxAge: 0, httpOnly: true, secure: name.startsWith("__Secure-") });
  }
  response.cookies.set(SIGNED_IN_HINT_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}
