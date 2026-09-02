import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { upsertUser, writePreferences } from "@/server/users";

let currentUserId = "";

vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

const { GET, PATCH, NO_ACCOUNT_CODE } = await import("./route");

// No truncation: every test mints its own id, the convention the sibling route
// int tests use.
const newUserId = () => `dev-${randomUUID()}`;

async function seedUser(): Promise<string> {
  const id = newUserId();
  await upsertUser({ id, email: `${id}@example.com`, name: "Provider Name", image: null });
  return id;
}

const patch = (body: unknown) =>
  PATCH(new Request("http://test/x", { method: "PATCH", body: JSON.stringify(body) }));

type Body = { preferences?: unknown; error?: string };

beforeEach(() => {
  currentUserId = "";
});

describe("GET /api/account/preferences", () => {
  it("401s when unauthenticated", async () => {
    expect((await GET()).status).toBe(401);
  });

  it("answers the storage defaults for a session whose row has gone", async () => {
    // JWT sessions outlive rows (ADR-025). A signed-in person seeing their
    // account screen render with defaults is right; a 500 is not.
    currentUserId = newUserId();
    const res = await GET();
    expect(res.status).toBe(200);
    expect(((await res.json()) as Body).preferences).toEqual({
      displayName: null,
      homeAirport: null,
      distanceUnit: "km",
    });
  });

  it("answers what is stored", async () => {
    currentUserId = await seedUser();
    await writePreferences(currentUserId, { displayName: "Mitchell", homeAirport: "LHR" });

    const body = (await (await GET()).json()) as Body;
    expect(body.preferences).toEqual({
      displayName: "Mitchell",
      homeAirport: "LHR",
      distanceUnit: "km",
    });
  });
});

describe("PATCH /api/account/preferences", () => {
  it("401s when unauthenticated, before it parses anything", async () => {
    expect((await patch({ distanceUnit: "mi" })).status).toBe(401);
  });

  it("applies a one-field patch and answers with the whole record", async () => {
    currentUserId = await seedUser();
    const res = await patch({ distanceUnit: "mi" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Body).preferences).toEqual({
      displayName: null,
      homeAirport: null,
      distanceUnit: "mi",
    });
  });

  // The contract validates `^[A-Z]{3}$` and carries no transform — the package
  // holds none by convention, and `packages/contracts/test/identity.test.ts`
  // pins that "sfo" is REJECTED there. This route is what makes "sfo" work
  // anyway, by normalizing BEFORE the parse rather than trusting a client to
  // have done it.
  it("normalizes a typed airport code before validating it", async () => {
    currentUserId = await seedUser();
    const res = await patch({ homeAirport: "  sfo " });
    expect(res.status).toBe(200);
    expect((((await res.json()) as Body).preferences as { homeAirport: string }).homeAirport).toBe("SFO");
  });

  it("trims a display name, and refuses one that is only spaces", async () => {
    currentUserId = await seedUser();
    const ok = await patch({ displayName: "  Mitchell  " });
    expect((((await ok.json()) as Body).preferences as { displayName: string }).displayName).toBe("Mitchell");
    // "   " passes a raw min-length check and then renders as a nameless
    // person — the same trap `saveDay` records about a saved day's name.
    expect((await patch({ displayName: "   " })).status).toBe(400);
  });

  it("clears a field with an explicit null, and leaves absent ones alone", async () => {
    currentUserId = await seedUser();
    await patch({ displayName: "Mitchell", homeAirport: "SFO", distanceUnit: "mi" });

    const res = await patch({ homeAirport: null });
    expect(((await res.json()) as Body).preferences).toEqual({
      displayName: "Mitchell",
      homeAirport: null,
      distanceUnit: "mi",
    });
  });

  // A PATCH carrying nothing is far more likely to be a client bug — a field
  // name that silently failed to match — than a request to change nothing.
  it("400s an empty patch rather than answering 200 to it", async () => {
    currentUserId = await seedUser();
    expect((await patch({})).status).toBe(400);
  });

  // Per-field validity is `UpdateUserPreferences`' own claim and is asserted
  // where the schema lives (`packages/contracts/test/identity.test.ts`, "still
  // validates the fields it is given"): a bad airport code, a unit that is not
  // a unit, an over-long name. Re-listing them here proved the schema twice and
  // the route not at all. What the route owes is that a parse failure becomes a
  // 400 rather than a 500 or a silent 200, and the two tests either side of
  // this say exactly that.
  it("400s a body that is not an object at all", async () => {
    currentUserId = await seedUser();
    expect((await patch(null)).status).toBe(400);
    expect((await patch("nonsense")).status).toBe(400);
    expect((await patch([{ distanceUnit: "mi" }])).status).toBe(400);
  });

  // Deliberately NOT an insert: `upsertUser` in the sign-in callback is the
  // only creator of user rows and it sits behind the admission gate (M11a).
  it("404s a session whose row has gone rather than minting one", async () => {
    currentUserId = newUserId();
    const res = await patch({ distanceUnit: "mi" });
    expect(res.status).toBe(404);

    // The settings Sheet renders `error` verbatim, so it has to be a sentence
    // for a person, with the branchable identifier in `code` beside it. This
    // used to be `error: "no-account"` — a log identifier shown to a signed-in
    // user (review, pull request 112).
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe(NO_ACCOUNT_CODE);
    expect(body.error).not.toBe(NO_ACCOUNT_CODE);
    expect(body.error).toMatch(/sign out/i);

    expect((await GET()).status).toBe(200);
  });
});
