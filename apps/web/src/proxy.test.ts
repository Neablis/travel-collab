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

// ADR-078: `/` is static, so it leaves the matcher, and the hint the landing
// reads is kept by whatever the proxy does see.
describe("proxy", () => {
  it("matches Home at /home, and no longer matches /", () => {
    expect(config.matcher).toContain("/home");
    expect(config.matcher).not.toContain("/");
  });

  it.each([undefined, "document"])("refreshes the hint on a signed-in page load (Sec-Fetch-Dest %s)", (dest) => {
    const res = handle(request("/home", { session: true, hint: false, dest }));
    expect(res.headers.get("location")).toBeNull();
    const cookie = hintSetCookie(res);
    expect(cookie).toMatch(new RegExp(`^${SIGNED_IN_HINT_COOKIE}=1;`));
    expect(cookie).toMatch(/Max-Age=2592000/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).not.toMatch(/HttpOnly/i);
  });

  // A prefetch answered after sign-out's clear would put the hint back, and
  // the landing would send a signed-out visitor to Home (proxy.ts says when).
  it("does not set the hint on a fetch, such as the client router's prefetch", () => {
    const res = handle(request("/home", { session: true, hint: false, dest: "empty" }));
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
});
