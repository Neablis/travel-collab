import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiToken } from "@tc/contracts";
import { TokensSection, relativeDays, tokenState } from "./TokensSection";

// **What a person can READ and DO on this screen** — `PlanSection.test.tsx`'s
// rule, and the reason it was written applies here twice over: the wire carries
// `expiresAt` and `revokedAt`, and what this section owes is the DIFFERENCE
// between them in words somebody acts on. A test reading the props would pass
// against a screen that shows two dead tokens identically.
//
// The three obligations mandatory expiry puts on this UI (Decision 13) are each
// a test below: time remaining rather than a creation date, expired reading
// differently from revoked, and rotation named as two actions.

const DAY = 24 * 60 * 60 * 1000;

function token(over: Partial<ApiToken> = {}): ApiToken {
  return {
    tokenId: "3f1a5b6c-7d8e-4f90-a1b2-c3d4e5f60718",
    name: "Calendar sync",
    prefix: "tc_7Fq2xR9a",
    scopes: ["trips:read"],
    tripIds: null,
    createdAt: new Date(Date.now() - 10 * DAY).toISOString(),
    lastUsedAt: null,
    // A minute of slack: the component floors against its own `new Date()`,
    // which is a few milliseconds later than this fixture — exactly 12 days
    // floors to 11.
    expiresAt: new Date(Date.now() + 12 * DAY + 60_000).toISOString(),
    revokedAt: null,
    ...over,
  };
}

/** Serve the two reads this section makes, and record what it posts. */
function serve(options: { tokens?: ApiToken[]; entitlements?: string[] } = {}) {
  const posted: { url: string; method: string; body: unknown }[] = [];
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const href = String(url);
    const method = init?.method ?? "GET";
    if (method !== "GET") {
      posted.push({ url: href, method, body: init?.body === undefined ? null : JSON.parse(String(init.body)) });
    }
    if (href === "/api/account/tokens" && method === "GET") {
      return new Response(JSON.stringify({ tokens: options.tokens ?? [] }), { status: 200 });
    }
    if (href === "/api/account/plan") {
      return new Response(
        JSON.stringify({ plan: { entitlements: options.entitlements ?? ["api.tokens"] } }),
        { status: 200 },
      );
    }
    if (href === "/api/account/tokens" && method === "POST") {
      return new Response(
        JSON.stringify({ token: token({ name: "New one" }), secret: "tc_theonlycopy" }),
        { status: 201 },
      );
    }
    if (href.startsWith("/api/account/tokens/") && method === "DELETE") {
      return new Response(
        JSON.stringify({ token: token({ revokedAt: new Date().toISOString() }) }),
        { status: 200 },
      );
    }
    return new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return posted;
}

const text = (testId: string) => screen.getByTestId(testId).textContent ?? "";

beforeEach(() => serve());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("what mandatory expiry owes the person looking at this", () => {
  // **Obligation 1.** "Expires in 12 days" is the only form of this anyone acts
  // on; a creation date makes them do the arithmetic and they will not.
  it("shows time remaining, not a creation date", async () => {
    serve({ tokens: [token()] });
    render(<TokensSection />);
    await screen.findByTestId("tokens-list");
    expect(text("token-expiry")).toContain("in 12 days");
    // The creation date is deliberately absent — it answers nothing anyone asks.
    expect(text("token-expiry")).not.toContain("2026");
  });

  // **Obligation 2.** Both are dead; one is a schedule and one is a decision,
  // and the person reading is reading for exactly that difference.
  it("says which kind of dead a dead token is", async () => {
    serve({
      tokens: [
        token({ tokenId: "a", expiresAt: new Date(Date.now() - 3 * DAY).toISOString() }),
        token({ tokenId: "b", revokedAt: new Date(Date.now() - 1 * DAY).toISOString() }),
      ],
    });
    render(<TokensSection />);
    await screen.findByTestId("tokens-list");
    const expired = screen.getByTestId("token-a").textContent ?? "";
    const revoked = screen.getByTestId("token-b").textContent ?? "";
    expect(expired).toContain("Expired");
    expect(expired).toContain("Create a new one");
    expect(revoked).toContain("Revoked");
    // And they do not read the same, which is the whole point.
    expect(revoked).not.toContain("Expired");
  });

  // **Obligation 3.** Rotation is two actions and saying so is what stops it
  // being assumed to be a feature.
  it("names rotation as two actions rather than promising a feature", async () => {
    render(<TokensSection />);
    fireEvent.click(await screen.findByTestId("token-new"));
    const form = text("token-form");
    expect(form).toContain("create its replacement");
    expect(form).toContain("revoke this one");
    // The ceiling is stated rather than enforced silently — a field that
    // rejects 400 without having said the limit wastes somebody's afternoon.
    expect(form).toContain("365 days");
  });

  // A dead token keeps no Revoke button — there is nothing left to switch off.
  it("offers Revoke only on a live token", async () => {
    serve({ tokens: [token({ tokenId: "dead", revokedAt: new Date().toISOString() })] });
    render(<TokensSection />);
    await screen.findByTestId("tokens-list");
    expect(screen.queryByTestId("token-revoke")).toBeNull();
  });
});

describe("the one-time reveal", () => {
  // **There is no second chance.** Nothing stores the secret, so a screen that
  // loses it costs the person a new token.
  it("shows the secret once, says so, and only after creating", async () => {
    render(<TokensSection />);
    await screen.findByTestId("tokens-section");
    expect(screen.queryByTestId("token-revealed")).toBeNull();

    fireEvent.click(screen.getByTestId("token-new"));
    fireEvent.change(screen.getByTestId("token-name"), { target: { value: "Calendar" } });
    fireEvent.click(screen.getByTestId("token-create"));

    await screen.findByTestId("token-revealed");
    expect(text("token-revealed")).toContain("not shown again");
    expect((screen.getByTestId("token-secret") as HTMLInputElement).value).toBe("tc_theonlycopy");
  });

  it("posts what the form actually says", async () => {
    const posted = serve();
    render(<TokensSection />);
    await screen.findByTestId("tokens-section");
    fireEvent.click(screen.getByTestId("token-new"));
    fireEvent.change(screen.getByTestId("token-name"), { target: { value: "  Calendar  " } });
    fireEvent.click(screen.getByTestId("token-scope-notebook:read"));
    fireEvent.change(screen.getByTestId("token-days"), { target: { value: "30" } });
    fireEvent.click(screen.getByTestId("token-create"));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]!.body).toEqual({
      // Trimmed: a name with trailing spaces is the same name.
      name: "Calendar",
      scopes: ["trips:read", "notebook:read"],
      tripIds: null,
      expiresInDays: 30,
    });
  });

  // A credential that can do nothing is a mistake wearing a safe default, and
  // the person will not find out until it 403s.
  it("will not create a token with no name or no permissions", async () => {
    render(<TokensSection />);
    await screen.findByTestId("tokens-section");
    fireEvent.click(screen.getByTestId("token-new"));
    expect((screen.getByTestId("token-create") as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByTestId("token-name"), { target: { value: "Named" } });
    expect((screen.getByTestId("token-create") as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByTestId("token-scope-trips:read"));
    expect((screen.getByTestId("token-create") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("when it fails", () => {
  // **Three answers, because they need three different actions.** The first
  // version had two, so a deployment that could not mint at all told the person
  // to check their own typing — found by an e2e walk against a server missing
  // its pepper.
  it("does not blame the person's typing for a server-side failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        const href = String(url);
        if (href === "/api/account/plan") {
          return new Response(JSON.stringify({ plan: { entitlements: ["api.tokens"] } }), { status: 200 });
        }
        if ((init?.method ?? "GET") === "POST") return new Response("{}", { status: 500 });
        return new Response(JSON.stringify({ tokens: [] }), { status: 200 });
      }),
    );
    render(<TokensSection />);
    await screen.findByTestId("tokens-section");
    fireEvent.click(screen.getByTestId("token-new"));
    fireEvent.change(screen.getByTestId("token-name"), { target: { value: "Anything" } });
    fireEvent.click(screen.getByTestId("token-create"));

    await screen.findByTestId("tokens-error");
    expect(text("tokens-error")).toContain("our side, not yours");
    expect(text("tokens-error")).not.toContain("Check the name");
  });

  it("names the plan when the plan is the reason", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        const href = String(url);
        if (href === "/api/account/plan") {
          return new Response(JSON.stringify({ plan: { entitlements: ["api.tokens"] } }), { status: 200 });
        }
        if ((init?.method ?? "GET") === "POST") return new Response("{}", { status: 402 });
        return new Response(JSON.stringify({ tokens: [] }), { status: 200 });
      }),
    );
    render(<TokensSection />);
    await screen.findByTestId("tokens-section");
    fireEvent.click(screen.getByTestId("token-new"));
    fireEvent.change(screen.getByTestId("token-name"), { target: { value: "Anything" } });
    fireEvent.click(screen.getByTestId("token-create"));

    await screen.findByTestId("tokens-error");
    expect(text("tokens-error")).toContain("Premium");
  });
});

describe("what a free or plus account sees", () => {
  // **A prompt, not a hidden section.** Hiding it answers "this product has no
  // API"; showing it locked answers "not on this plan", which is both true and
  // actionable.
  it("shows an upgrade prompt and no way to create", async () => {
    serve({ entitlements: ["ai.ask"] });
    render(<TokensSection />);
    await screen.findByTestId("tokens-section");
    expect(text("tokens-upgrade")).toContain("Premium");
    expect(screen.queryByTestId("token-new")).toBeNull();
    expect(screen.queryByTestId("token-form")).toBeNull();
  });

  // **A lapsed account must still be able to see and revoke what it holds.**
  // Refusing would leave live credentials the owner can no longer reach, which
  // is the opposite of what a lapse should do.
  it("still lists and can revoke the tokens it already has", async () => {
    serve({ entitlements: [], tokens: [token()] });
    render(<TokensSection />);
    await screen.findByTestId("tokens-list");
    expect(screen.getByTestId("tokens-upgrade")).toBeTruthy();
    expect(screen.getByTestId("token-revoke")).toBeTruthy();
  });
});

describe("revoking", () => {
  it("marks the token revoked in place without reloading the list", async () => {
    const posted = serve({ tokens: [token()] });
    render(<TokensSection />);
    await screen.findByTestId("tokens-list");
    fireEvent.click(screen.getByTestId("token-revoke"));

    await waitFor(() => expect(text("token-state")).toBe("Revoked"));
    expect(posted).toEqual([
      { url: "/api/account/tokens/3f1a5b6c-7d8e-4f90-a1b2-c3d4e5f60718", method: "DELETE", body: null },
    ]);
  });
});

describe("the two pure helpers", () => {
  // **Deadlines floor toward LESS time remaining**, so a token with 23 hours
  // left reads "today" rather than "tomorrow". Rounding toward MORE time is the
  // direction that gets somebody caught out, and the first version of this test
  // asserted the unsafe direction while its own comment argued for the safe one.
  it("floors a remaining deadline rather than rounding it", () => {
    const now = new Date("2026-09-16T12:00:00Z");
    expect(relativeDays("2026-09-17T11:00:00Z", now)).toBe("today");
    expect(relativeDays("2026-09-17T13:00:00Z", now)).toBe("tomorrow");
    expect(relativeDays("2026-09-16T23:59:00Z", now)).toBe("today");
    expect(relativeDays("2026-09-28T12:00:00Z", now)).toBe("in 12 days");
    expect(relativeDays("2026-09-13T12:00:00Z", now)).toBe("3 days ago");
  });

  // Resolved on read, exactly as the server does — and revoked wins over
  // expired, because a token that was cut off and then also ran out was cut
  // off, and that is the more useful thing to be told.
  it("resolves state on read, with revoked beating expired", () => {
    const now = new Date("2026-09-16T12:00:00Z");
    expect(tokenState(token({ expiresAt: "2026-10-16T12:00:00Z" }), now)).toBe("live");
    expect(tokenState(token({ expiresAt: "2026-09-15T12:00:00Z" }), now)).toBe("expired");
    expect(
      tokenState(token({ expiresAt: "2026-09-15T12:00:00Z", revokedAt: "2026-09-14T12:00:00Z" }), now),
    ).toBe("revoked");
  });
});
