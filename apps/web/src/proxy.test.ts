import { NextRequest } from "next/server";
import type { Session } from "next-auth";
import { describe, expect, it, vi } from "vitest";
import { SIGNED_IN_HINT_COOKIE } from "@/lib/sessionHint";

// The Auth.js wrapper is replaced by the identity, so the default export IS
// the handler and a test decides what `req.auth` holds. What is under test is
// this file's own branching, not Auth.js's JWT reading.
vi.mock("next-auth", () => ({ default: () => ({ auth: (handler: unknown) => handler }) }));

const { default: proxy, config } = await import("./proxy");
const handle = proxy as unknown as (req: NextRequest) => Response;

function request(path: string, { session, hint, dest }: { session: boolean; hint: boolean; dest?: string }) {
  const headers = new Headers();
  if (hint) headers.set("cookie", `${SIGNED_IN_HINT_COOKIE}=1`);
  if (dest) headers.set("sec-fetch-dest", dest);
  const req = new NextRequest(new URL(path, "https://caesura.test"), { headers });
  const auth: Session | null = session ? { user: { id: "u1" }, expires: "2099-01-01T00:00:00.000Z" } : null;
  return Object.assign(req, { auth });
}

function hintSetCookie(res: Response): string | undefined {
  return res.headers.getSetCookie().find((line) => line.startsWith(`${SIGNED_IN_HINT_COOKIE}=`));
}

// ADR-078: `/` is static, so it leaves the matcher, and of the hint the
// landing reads, the proxy only ever takes it away.
describe("proxy", () => {
  it("matches Home at /home, and no longer matches /", () => {
    expect(config.matcher).toContain("/home");
    expect(config.matcher).not.toContain("/");
  });

  // ADR-078: the app shell is the hint's only setter. A set here needed a
  // page load told apart from the client router's prefetch, and a prefetch
  // answered after sign-out's clear put the hint back (proxy.ts says when).
  it.each([undefined, "document", "empty"])(
    "never sets the hint on a signed-in matched request (Sec-Fetch-Dest %s)",
    (dest) => {
      const res = handle(request("/home", { session: true, hint: false, dest }));
      expect(res.headers.get("location")).toBeNull();
      expect(hintSetCookie(res)).toBeUndefined();
    },
  );

  it("leaves a signed-in browser's hint alone", () => {
    const res = handle(request("/trips/t1", { session: true, hint: true, dest: "document" }));
    expect(hintSetCookie(res)).toBeUndefined();
  });

  it("sends a signed-out /home to sign in and clears a stale hint", () => {
    const res = handle(request("/home", { session: false, hint: true }));
    expect(res.headers.get("location")).toBe("https://caesura.test/signin?callbackUrl=%2Fhome");
    expect(hintSetCookie(res)).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/);
  });

  it("leaves a signed-out visitor with no hint without one", () => {
    const res = handle(request("/trips/t1", { session: false, hint: false }));
    expect(hintSetCookie(res)).toBeUndefined();
  });

  // The library is matched to pick its copy (ADR-077), never to send anyone
  // to sign in; a signed-out request sheds the hint there as everywhere else.
  it("serves a signed-out reader the library's cached copy, and sheds a stale hint", () => {
    const res = handle(request("/playbooks/board", { session: false, hint: true }));
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-rewrite")).toBe("https://caesura.test/playbooks/cached/board");
    expect(hintSetCookie(res)).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/);
  });

  // The live copy renders the app shell, which sets the hint; this does not.
  it("serves a signed-in reader the library's live copy, without setting the hint", () => {
    expect(config.matcher).toContain("/playbooks/:path*");
    const res = handle(request("/playbooks", { session: true, hint: false, dest: "document" }));
    expect(res.headers.get("x-middleware-rewrite")).toBe("https://caesura.test/playbooks/live");
    expect(hintSetCookie(res)).toBeUndefined();
  });
});
