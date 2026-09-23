import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { API_SCOPES, API_TOKEN_MAX_LIFETIME_DAYS, type ApiToken } from "@tc/contracts";
import { TokensSection, expiresSoon, reachLine, relativeDays, tokenState } from "./TokensSection";

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

// Real uuids, because `fetchTrips` parses the response against `TripSummary`
// and a placeholder string would fail the parse rather than the assertion.
const TRIP_ONE = "11111111-2222-4333-8444-555555555555";
const TRIP_TWO = "66666666-7777-4888-8999-aaaaaaaaaaaa";

function tripSummary(tripId: string, name: string) {
  return {
    tripId,
    name,
    status: "active" as const,
    members: [{ userId: "u1", role: "owner" as const }],
    createdAt: new Date().toISOString(),
  };
}

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
function serve(options: { tokens?: ApiToken[]; entitlements?: string[]; billingState?: string } = {}) {
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
        // `billing` is on every real response (`accountPlan.ts`) and the
        // stub omitted it, so this suite could not have caught a component
        // that read it unguarded — which is exactly what happened.
        JSON.stringify({
          plan: {
            entitlements: options.entitlements ?? ["api.tokens"],
            billing: { state: options.billingState ?? "active" },
          },
        }),
        { status: 200 },
      );
    }
    // Matched on the PATH, not the href: the trip list goes through
    // `apiClient.fetchTrips`, which builds an absolute URL via `apiUrl` — the
    // token calls above are raw `fetch` with a relative path. A `startsWith`
    // here silently matched nothing.
    if (new URL(href, "http://localhost").pathname === "/api/trips" && method === "GET") {
      return new Response(
        JSON.stringify({ trips: [tripSummary(TRIP_ONE, "Japan"), tripSummary(TRIP_TWO, "Lisbon")] }),
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
    // The whole sentence, not a fragment of it: "in 12 days" would survive the
    // label being dropped, or "Expired" being rendered for a live token.
    expect(text("token-expiry")).toBe("Expires in 12 days.");
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
    // The lifetime is a choice of three since M26 link 1, not a number field
    // (§34.1). Picked by its label, the way a person picks it.
    fireEvent.click(screen.getByRole("radio", { name: "30 days" }));
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

  // Mitchell, on the preview: "Add select all/ select none button to quickly
  // select or deselect all". Eight scopes is enough that picking them one at a
  // time is the tedious part of minting a token.
  it("selects and clears every scope in one click", async () => {
    render(<TokensSection />);
    await screen.findByTestId("tokens-section");
    fireEvent.click(screen.getByTestId("token-new"));

    const checked = () =>
      API_SCOPES.filter(
        (scope) => (screen.getByTestId(`token-scope-${scope}`) as HTMLInputElement).checked,
      );

    // The form opens with one scope pre-selected, so "Select all" has work to do
    // and "Select none" is already live — neither starts disabled by accident.
    expect(checked()).toEqual(["trips:read"]);

    fireEvent.click(screen.getByTestId("token-scopes-all"));
    expect(checked()).toEqual([...API_SCOPES]);
    // Nothing left to select; the button says so rather than being a no-op.
    expect((screen.getByTestId("token-scopes-all") as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByTestId("token-scopes-none"));
    expect(checked()).toEqual([]);
    expect((screen.getByTestId("token-scopes-none") as HTMLButtonElement).disabled).toBe(true);
    // And clearing them all leaves Create refused, as picking none by hand does.
    expect((screen.getByTestId("token-create") as HTMLButtonElement).disabled).toBe(true);
  });

  // **This asserted a validator over a free-text number field**, which held the
  // ceiling the copy promised against `""`, `12.5`, `400` and `abc`. M26 link 1
  // replaced the field with three named lifetimes (§34.1), so none of those
  // inputs can be expressed any more and the validator went with them.
  //
  // What replaces it is the claim that actually still needs holding: the
  // offered lifetimes are the only ones, and the longest of them IS the
  // ceiling — so the copy's "at most N days" cannot be contradicted by
  // anything the control can produce. An offered value above the contract's
  // ceiling would be the same defect in a new coat.
  it("offers only lifetimes it can honour, the longest being the stated ceiling", async () => {
    const posted = serve();
    render(<TokensSection />);
    await screen.findByTestId("tokens-section");
    fireEvent.click(screen.getByTestId("token-new"));

    const offered = screen.getAllByRole("radio").filter((r) => /day|year/i.test(r.textContent ?? ""));
    expect(offered.map((r) => r.textContent)).toEqual(["30 days", "90 days", "A year"]);

    fireEvent.change(screen.getByTestId("token-name"), { target: { value: "Named" } });
    fireEvent.click(screen.getByRole("radio", { name: "A year" }));
    fireEvent.click(screen.getByTestId("token-create"));

    await waitFor(() => expect(posted).toHaveLength(1));
    // Not 365 spelled here: the ceiling has one definition and this is it.
    expect((posted[0]!.body as { expiresInDays: number }).expiresInDays).toBe(API_TOKEN_MAX_LIFETIME_DAYS);
  });

  // **DRIFT D12, and the entire gap was one hardcoded value.** `trip_ids` has
  // been real and enforced end to end since M22 — the field, the wrapper check,
  // the per-call membership re-check and the route's refusal of `POST /v1/trips`
  // for a scoped token — and this UI posted `null` whatever the person meant.
  it("posts the chosen trips when the token is scoped to some of them", async () => {
    const posted = serve();
    render(<TokensSection />);
    await screen.findByTestId("tokens-section");
    fireEvent.click(screen.getByTestId("token-new"));
    fireEvent.change(screen.getByTestId("token-name"), { target: { value: "Calendar" } });

    fireEvent.click(screen.getByRole("radio", { name: "Chosen trips" }));
    const chip = await screen.findByTestId(`token-trip-${TRIP_ONE}`);
    fireEvent.click(chip);
    fireEvent.click(screen.getByTestId("token-create"));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect((posted[0]!.body as { tripIds: string[] | null }).tripIds).toEqual([TRIP_ONE]);
  });

  // A token scoped to no trips can do nothing at all, which nobody means to
  // create — the one state the three-choice control can still get wrong.
  it("refuses to create a token scoped to no trips at all", async () => {
    render(<TokensSection />);
    await screen.findByTestId("tokens-section");
    fireEvent.click(screen.getByTestId("token-new"));
    fireEvent.change(screen.getByTestId("token-name"), { target: { value: "Named" } });
    expect((screen.getByTestId("token-create") as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByRole("radio", { name: "Chosen trips" }));
    expect((screen.getByTestId("token-create") as HTMLButtonElement).disabled).toBe(true);
  });

  // §34.1: Decision 5's rule is not something to implement — the server already
  // refuses the widening — it is something to STATE, so the reader meets it
  // before minting rather than as an error afterwards.
  it("states that a trip-scoped token cannot create a trip", async () => {
    render(<TokensSection />);
    await screen.findByTestId("tokens-section");
    fireEvent.click(screen.getByTestId("token-new"));
    fireEvent.click(screen.getByRole("radio", { name: "Chosen trips" }));

    expect(await screen.findByText(/cannot create one/i)).toBeTruthy();
  });
});

describe("the one-time secret", () => {
  // **"Copied" is a claim, and there is no second chance at this string.** A
  // browser without the clipboard API, or one refusing the write, left the
  // button saying Copied over an empty clipboard — and the only copy of the
  // token was the one on screen the person was about to navigate away from.
  it("does not say Copied when the clipboard refused", async () => {
    serve();
    render(<TokensSection />);
    await screen.findByTestId("tokens-section");
    fireEvent.click(screen.getByTestId("token-new"));
    fireEvent.change(screen.getByTestId("token-name"), { target: { value: "Named" } });
    fireEvent.click(screen.getByTestId("token-create"));
    await screen.findByTestId("token-secret");

    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn(async () => Promise.reject(new Error("denied"))) },
    });
    fireEvent.click(screen.getByTestId("token-copy"));

    await screen.findByTestId("tokens-error");
    expect(text("tokens-error")).toContain("would not let us copy");
    expect(text("token-copy")).toBe("Copy");
    // The token itself is still on screen to select by hand, which is what the
    // error tells them to do.
    expect((screen.getByTestId("token-secret") as HTMLInputElement).value).toBe("tc_theonlycopy");
  });

  // The clipboard write is async, so its completion can land after the person
  // has moved on. Labelling a DIFFERENT one-time secret as copied is the worst
  // available lie here: they navigate away trusting a clipboard that holds the
  // previous token.
  it("does not label a second secret as copied when the first write lands late", async () => {
    serve();
    let settle: (() => void) | undefined;
    const writeText = vi.fn(() => new Promise<void>((resolve) => (settle = resolve)));
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    render(<TokensSection />);
    await screen.findByTestId("tokens-section");
    fireEvent.click(screen.getByTestId("token-new"));
    fireEvent.change(screen.getByTestId("token-name"), { target: { value: "First" } });
    fireEvent.click(screen.getByTestId("token-create"));
    await screen.findByTestId("token-secret");

    // Click Copy, then dismiss and mint again before the write resolves.
    fireEvent.click(screen.getByTestId("token-copy"));
    fireEvent.click(screen.getByTestId("token-reveal-dismiss"));
    fireEvent.click(screen.getByTestId("token-new"));
    fireEvent.change(screen.getByTestId("token-name"), { target: { value: "Second" } });
    fireEvent.click(screen.getByTestId("token-create"));
    await screen.findByTestId("token-secret");

    settle!();
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    // The stale completion must not claim the secret now on screen.
    expect(text("token-copy")).toBe("Copy");
  });

  it("says Copied when the clipboard took it", async () => {
    serve();
    const writeText = vi.fn(async () => undefined);
    render(<TokensSection />);
    await screen.findByTestId("tokens-section");
    fireEvent.click(screen.getByTestId("token-new"));
    fireEvent.change(screen.getByTestId("token-name"), { target: { value: "Named" } });
    fireEvent.click(screen.getByTestId("token-create"));
    await screen.findByTestId("token-secret");

    vi.stubGlobal("navigator", { clipboard: { writeText } });
    fireEvent.click(screen.getByTestId("token-copy"));

    await waitFor(() => expect(text("token-copy")).toBe("Copied"));
    expect(writeText).toHaveBeenCalledWith("tc_theonlycopy");
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
          return new Response(
            JSON.stringify({ plan: { entitlements: ["api.tokens"], billing: { state: "active" } } }),
            { status: 200 },
          );
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
          return new Response(
            JSON.stringify({ plan: { entitlements: ["api.tokens"], billing: { state: "active" } } }),
            { status: 200 },
          );
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


// §34.1's remaining obligations, added by M26 link 1.
describe("what the list says about reach and urgency", () => {
  // **Obligation 1's second half: under a week reads in `--color-warning-ink`.**
  //
  // The PAINT cannot be asserted here — the lint wall bans `toHaveClass` and
  // `expect(x.className)` outside `components/ui/**`, and jsdom has no layout
  // anyway; the colour wall owns that contract and now fails on an undefined
  // token name (`KI-2026-09-19-g`). What is testable, and what actually decides
  // the colour, is the predicate. Getting "soon" wrong is the defect; getting
  // the hex wrong is not a thing this code can do any more.
  it("counts a token with less than a week left as expiring soon", () => {
    const now = new Date("2026-09-19T12:00:00Z");
    const at = (ms: number) => token({ expiresAt: new Date(now.getTime() + ms).toISOString() });
    expect(expiresSoon(at(6 * DAY), now)).toBe(true);
    expect(expiresSoon(at(1 * DAY), now)).toBe(true);
    // Exactly a week is not "soon" — the boundary belongs on the calm side, so
    // the warning means something when it appears.
    expect(expiresSoon(at(7 * DAY), now)).toBe(false);
    expect(expiresSoon(at(30 * DAY), now)).toBe(false);
    // Already gone is not "soon": the row says Expired, and painting it as
    // urgent would be telling somebody to hurry about a thing that is over.
    expect(expiresSoon(at(-1 * DAY), now)).toBe(false);
  });

  // **`1 trip(s)` is the defect class KI-048 already records as `1 travellers`**,
  // and the two halves are different facts joined with ` · `, not a list joined
  // with a comma.
  it("states what a token may do and how far it reaches, in one line", () => {
    expect(reachLine(token({ tripIds: null }))).toBe("Read trips · all trips");
    expect(reachLine(token({ tripIds: ["a"] }))).toBe("Read trips · 1 trip");
    expect(reachLine(token({ tripIds: ["a", "b"] }))).toBe("Read trips · 2 trips");
    expect(reachLine(token({ tripIds: ["a"] }))).not.toContain("trip(s)");
    expect(reachLine(token({ scopes: [] }))).toContain("can do nothing");
  });
});

describe("the gate a locked account reads", () => {
  // §34.1: name the split here rather than let it be discovered in a support
  // conversation. Somebody reading "not on this plan" beside their own data
  // reasonably fears they cannot get it out, and the answer is one clause long.
  it("says tokens are Premium and that taking your trips with you is not", async () => {
    serve({ entitlements: [] });
    render(<TokensSection />);
    const gate = await screen.findByTestId("tokens-upgrade");
    expect(gate.textContent).toContain("Premium");
    expect(gate.textContent).toMatch(/downloading a trip/i);
  });

  // **`billing.state` was on the wire and unread.** An account whose
  // subscription ended was told it had never had the feature; "subscribe" and
  // "restart" are different acts.
  it("tells a lapsed account its tokens stopped rather than never existed", async () => {
    serve({ entitlements: [], billingState: "lapsed" });
    render(<TokensSection />);
    const gate = await screen.findByTestId("tokens-upgrade");
    expect(gate.textContent).toMatch(/subscription has ended/i);
    expect(gate.textContent).toMatch(/nothing was deleted/i);
    expect(screen.getByTestId("tokens-upgrade-link").textContent).toBe("Restart it");
  });

  // The whole section must survive a plan body that is missing the field the
  // copy above is keyed on — it decides one sentence, not whether the tokens
  // load. The first cut read it unguarded and lost the entire section.
  it("still renders when the plan body carries no billing at all", async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      if (href === "/api/account/tokens" && (init?.method ?? "GET") === "GET") {
        return new Response(JSON.stringify({ tokens: [token()] }), { status: 200 });
      }
      if (href === "/api/account/plan") {
        return new Response(JSON.stringify({ plan: { entitlements: ["api.tokens"] } }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TokensSection />);
    expect(await screen.findByTestId("tokens-list")).toBeTruthy();
  });
});
