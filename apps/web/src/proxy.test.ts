import { NextRequest } from "next/server";
import type { Session } from "next-auth";
import { describe, expect, it, vi } from "vitest";
import { SIGNED_IN_HINT_COOKIE } from "@/lib/sessionHint";
import { SIGNUP_REF_COOKIE } from "@/lib/signupRef";

// The Auth.js wrapper is replaced by one that only counts, so a test decides
// what `req.auth` holds and can see whether a request reached `auth()` at all.
// What is under test is this file's own branching, not Auth.js's JWT reading.
const authCalls = vi.hoisted(() => ({ count: 0 }));
vi.mock("next-auth", () => ({
  default: () => ({
    auth: (handler: (req: unknown) => unknown) => (req: unknown) => {
      authCalls.count += 1;
      return handler(req);
    },
  }),
}));

const { default: proxy, config } = await import("./proxy");
const handle = proxy as unknown as (req: NextRequest) => Response;

// The matcher as Next itself compiles it, transport forms and all. Vercel
// matches a route source case-insensitively, hence the flag. Next exports
// `getMiddlewareMatchers` at runtime but leaves it out of its `.d.ts`.
const { getMiddlewareMatchers } = (await import("next/dist/build/analysis/get-page-static-info")) as unknown as {
  getMiddlewareMatchers: (matchers: (typeof config.matcher)[number][], nextConfig: object) => { regexp: string }[];
};
function nextMatches(entries: typeof config.matcher, pathname: string): boolean {
  return getMiddlewareMatchers([...entries], {}).some((m) => new RegExp(m.regexp, "i").test(pathname));
}

function request(
  path: string,
  { session, hint, dest, ref }: { session: boolean; hint: boolean; dest?: string; ref?: string },
) {
  const headers = new Headers();
  const cookies = [hint ? `${SIGNED_IN_HINT_COOKIE}=1` : null, ref ? `${SIGNUP_REF_COOKIE}=${ref}` : null];
  if (cookies.some(Boolean)) headers.set("cookie", cookies.filter(Boolean).join("; "));
  if (dest) headers.set("sec-fetch-dest", dest);
  const req = new NextRequest(new URL(path, "https://caesura.test"), { headers });
  const auth: Session | null = session ? { user: { id: "u1" }, expires: "2099-01-01T00:00:00.000Z" } : null;
  return Object.assign(req, { auth });
}

function hintSetCookie(res: Response): string | undefined {
  return res.headers.getSetCookie().find((line) => line.startsWith(`${SIGNED_IN_HINT_COOKIE}=`));
}

function refSetCookie(res: Response): string | undefined {
  return res.headers.getSetCookie().find((line) => line.startsWith(`${SIGNUP_REF_COOKIE}=`));
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

  // KI-2026-10-11-b: `/plans` was outside the matcher, so a signed-out visitor
  // was served the page, whose plan read answered 401, and saw "Your plan
  // could not be loaded just now".
  it("matches /plans and sends a signed-out one to sign in, query and all", () => {
    const paths = config.matcher.filter((entry) => typeof entry === "string");
    expect(nextMatches(paths, "/plans")).toBe(true);
    const res = handle(request("/plans?checkout=cs_test_1", { session: false, hint: false }));
    expect(res.headers.get("location")).toBe(
      "https://caesura.test/signin?callbackUrl=%2Fplans%3Fcheckout%3Dcs_test_1",
    );
  });

  it("serves a signed-in /plans as it is", () => {
    const res = handle(request("/plans", { session: true, hint: true }));
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
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

  // ADR-079: a launch link's `?ref=` is banked for signup, first touch only.
  describe("a ?ref= link", () => {
    it("is matched on any page by a query condition, never under /api or /_next", () => {
      const refEntry = config.matcher.filter((entry) => typeof entry !== "string");
      expect(refEntry).toEqual([expect.objectContaining({ has: [{ type: "query", key: "ref" }] })]);
      expect(config.matcher).not.toContain("/");
      for (const page of ["/", "/signin", "/places/kyoto"]) expect(nextMatches(refEntry, page)).toBe(true);
      for (const other of ["/api/trips", "/_next/static/chunk.js"]) expect(nextMatches(refEntry, other)).toBe(false);
    });

    it("banks the channel on the landing, without auth() or a rewrite, on a response no CDN keeps", () => {
      authCalls.count = 0;
      const res = handle(request("/?ref=ShowHN", { session: false, hint: false }));
      expect(authCalls.count).toBe(0);
      expect(res.headers.get("location")).toBeNull();
      expect(res.headers.get("x-middleware-rewrite")).toBeNull();
      const cookie = refSetCookie(res);
      expect(cookie).toMatch(/^caesura_ref=showhn;/);
      expect(cookie).toMatch(/Max-Age=2592000/);
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).toMatch(/SameSite=lax/i);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
    });

    // The ref branch skips `auth()`, so a path-matched route must never be
    // mistaken for a ref-only one, with or without a ref.
    it.each(["/home", "/trips/t1", "/invite/tok", "/playbooks", "/home?ref=showhn"])(
      "still sends %s through auth()",
      (path) => {
        authCalls.count = 0;
        handle(request(path, { session: false, hint: false }));
        expect(authCalls.count).toBe(1);
      },
    );

    // Next lets a path entry in by any case and in its transport forms, so
    // the ref branch must not read those as unguarded.
    it.each(["/Trips/x?ref=a", "/HOME?ref=a", "/home.segments/_tree.segment.rsc?ref=a"])(
      "still sends %s, which a path entry matches, through auth()",
      (path) => {
        const { pathname } = new URL(path, "https://caesura.test");
        expect(nextMatches(config.matcher.filter((entry) => typeof entry === "string"), pathname)).toBe(true);
        authCalls.count = 0;
        handle(request(path, { session: false, hint: false }));
        expect(authCalls.count).toBe(1);
      },
    );

    it("answers a path that only shares a guarded prefix without auth()", () => {
      authCalls.count = 0;
      handle(request("/homeless?ref=a", { session: false, hint: false }));
      expect(authCalls.count).toBe(0);
    });

    it("keeps the first channel: a later ref does not overwrite it", () => {
      const res = handle(request("/?ref=other", { session: false, hint: false, ref: "showhn" }));
      expect(refSetCookie(res)).toBeUndefined();
    });

    it("drops a ref that is not a channel label", () => {
      const res = handle(request("/?ref=%3Cscript%3E", { session: false, hint: false }));
      expect(refSetCookie(res)).toBeUndefined();
    });

    // A launch link can open a playbook, which is matched for its own reason.
    // No playbook page reads `ref`, so it still gets the cached copy.
    it("banks it beside a guarded route's own answer", () => {
      const res = handle(request("/playbooks/board?ref=showhn", { session: false, hint: false }));
      expect(res.headers.get("x-middleware-rewrite")).toBe("https://caesura.test/playbooks/cached/board?ref=showhn");
      expect(refSetCookie(res)).toMatch(/^caesura_ref=showhn;/);
    });
  });
});
