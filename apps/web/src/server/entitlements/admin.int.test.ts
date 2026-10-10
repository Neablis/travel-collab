// **The operator console** (M20 link 7), against a real database.
//
// Three gate boxes: the console answers from real data, a non-admin reaches no
// route and no endpoint, and granting is the only write.
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { entitlementGrants, events, subscriptions, users } from "@/server/db/schema";
import { executeTripCommand } from "@/server/commands";
import { upsertUser } from "@/server/users";
import type { TurnLedger } from "@/server/assistant/ledger";
import { recordTurnLedger } from "./usage";
import { activeGrantHolders, allGrantsFor, issueGrant, offerTrial } from "./grants";
import { accountCan } from "./resolver";
import {
  ACCOUNT_FILTER_IDS,
  ACCOUNTS_PAGE_SIZE,
  adminAccounts,
  adminAccountsPage,
  adminTopSpenders,
  isAdmin,
  planPanel,
  type AccountFilterId,
  type AdminAccountRow,
} from "./admin";
import { PLAN_VERSIONS, livePlanVersion, versionsOf } from "./planVersions";

let currentUserId = "";
vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

const { GET: OVERVIEW } = await import("@/app/api/admin/overview/route");
const { POST: GRANT, DELETE: REVOKE } = await import("@/app/api/admin/grants/route");

const newUser = () => `dev-${randomUUID()}`;

async function account(options: { admin?: boolean; planId?: "free" | "plus" | "premium" } = {}) {
  const id = newUser();
  await upsertUser({ id, email: `${id}@example.test`, name: null, image: null });
  await db
    .update(users)
    .set({ isAdmin: options.admin ?? false, planId: options.planId ?? "free", planVersion: 1 })
    .where(eq(users.id, id));
  return id;
}

function usage(userId: string): TurnLedger {
  return {
    cost: {
      userId,
      endpoint: "ask",
      outcome: "completed",
      taskClass: "question",
      classifierCertainty: "sure",
      turn: { model: "deepseek/deepseek-v4-flash-0731", tokensIn: 3363, tokensOut: 512 },
      classifier: { model: "zai/glm-4.7-flash", tokensIn: 198, tokensOut: 49 },
      steps: 2,
      planVersionRef: "plus@v1",
      turnId: null,
      latencyMs: null,
    },
    capacity: [],
    toolCalls: [],
    stepSpend: [],
  };
}

const grantBody = (userId: string, planId: string, expiresAt: string | null = null) =>
  new Request("http://localhost/api/admin/grants", {
    method: "POST",
    body: JSON.stringify({ userId, planId, expiresAt, reason: "Comped for a support case." }),
  });

describe("a non-admin reaches no admin endpoint", () => {
  // **The gate box, and it is explicit that hiding is not enough**: *"checked
  // server-side, and a test proves the route group is not merely hidden."*
  it("404s every admin endpoint for a signed-in non-admin", async () => {
    currentUserId = await account();
    expect((await OVERVIEW()).status).toBe(404);
    expect((await GRANT(grantBody(currentUserId, "premium"))).status).toBe(404);
    expect(
      (
        await REVOKE(
          new Request("http://localhost/api/admin/grants", {
            method: "DELETE",
            body: JSON.stringify({ grantId: randomUUID() }),
          }),
        )
      ).status,
    ).toBe(404);
  });

  it("404s every admin endpoint for nobody at all", async () => {
    currentUserId = "";
    expect((await OVERVIEW()).status).toBe(404);
    expect((await GRANT(grantBody("someone", "premium"))).status).toBe(404);
  });

  // **404, not 403.** A 403 confirms the route exists, and an operator console
  // whose existence is confirmable is a list of endpoints worth attacking.
  it("says nothing about the route existing", async () => {
    currentUserId = await account();
    const res = await OVERVIEW();
    expect(res.status).toBe(404);
    expect(JSON.stringify(await res.json())).not.toMatch(/admin|forbidden|permission/i);
  });

  it("lets an admin through the same endpoint", async () => {
    currentUserId = await account({ admin: true });
    expect(await isAdmin(currentUserId)).toBe(true);
    expect((await OVERVIEW()).status).toBe(200);
  });

  // The operator bit is not acquirable by signing in, and there is no path
  // that sets it. It is a column an operator sets by hand.
  it("gives a new account no operator bit", async () => {
    const id = await account();
    expect(await isAdmin(id)).toBe(false);
  });
});

describe("the console answers from real data", () => {
  it("counts accounts per plan and carries each plan's version history", async () => {
    await account({ planId: "premium" });
    const panel = await planPanel();
    const premium = panel.find((row) => row.planId === "premium")!;
    expect(premium.accounts).toBeGreaterThan(0);
    // **Derived, not a literal.** These read "the live version" and "every
    // published version"; spelling them `1` and `[1]` was a coincidence of
    // `premium` having had one version, and it broke the day M22 published
    // `premium@v2` — which is this panel working, not this panel failing.
    expect(premium.live.version).toBe(livePlanVersion("premium").version);
    expect(premium.versions.map((v) => v.version)).toEqual(
      versionsOf("premium").map((v) => v.version),
    );
    // The live version is the NEWEST published one, which is the property the
    // literal was standing in for.
    expect(premium.live.version).toBe(Math.max(...versionsOf("premium").map((v) => v.version)));
    // Read-only over plans: the panel carries no field anything could write.
    // `holdsByVersion` and `medianMicroUsd` joined it when the tier panel moved
    // to the design's shape; `mrrMicroUsd` and `medianMarginMicroUsd` joined it
    // with M21 link 7, which is the half of this panel that needed a
    // subscription to exist. **All four are derived reads**, and pinning the
    // key list is what makes a writable field added here impossible to miss —
    // which is the whole point of the list rather than a `toMatchObject`.
    expect(Object.keys(premium)).toEqual([
      "planId",
      "versions",
      "live",
      "accounts",
      "holdsByVersion",
      "medianMicroUsd",
      "mrrMicroUsd",
      "medianMarginMicroUsd",
    ]);
    // Every holder is on some published version, so the per-version counts sum
    // to the plan total — the design shows both and they must agree.
    expect(
      Object.values(premium.holdsByVersion).reduce((total, held) => total + held, 0),
    ).toBe(premium.accounts);
    // **A version nobody holds is PRESENT with a zero**, not absent. The map was
    // built from the group-by, so it was sparse, and a sparse map makes "nobody
    // is on studio v1" and "studio v1 is not a version" the same shape at every
    // call site. Asserted on `studio` because it is the disabled fourth-plan
    // proof — published, and by construction held by nobody. CodeRabbit,
    // PR #174.
    const studio = panel.find((row) => row.planId === "studio")!;
    for (const version of studio.versions) {
      expect(studio.holdsByVersion[version.version]).toBe(0);
    }
    expect(Object.keys(studio.holdsByVersion)).toHaveLength(studio.versions.length);
  });

  // What *Underwater by construction* counts per source (M36 link 1 deleted
  // the grant-cost panel that used to be asserted here; the read is the same).
  it("counts accounts per ACTIVE grant source", async () => {
    const trialled = await account();
    await offerTrial(trialled);
    const onTrial = async (now?: Date) =>
      (await activeGrantHolders(now)).some((row) => row.source === "trial" && row.userId === trialled);
    expect(await onTrial()).toBe(true);

    // An expired trial stops being counted — and the row is still there,
    // because nothing sweeps that table. "On a trial now" and "ever had one"
    // are different questions and this read asks the first.
    const later = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    expect(await onTrial(later)).toBe(false);
    expect(await allGrantsFor(trialled)).toHaveLength(1);
  });

  it("reports cost per account and ranks the top spenders", async () => {
    const heavy = await account({ planId: "plus" });
    for (let i = 0; i < 3; i += 1) await recordTurnLedger(usage(heavy));
    const spenders = await adminTopSpenders(50);
    const entry = spenders.find((row) => row.userId === heavy);
    expect(entry!.requests).toBe(3);
    expect(entry!.microUsd).toBeGreaterThan(0);
  });

  // **Resolved through the real resolver**, never reassembled. A second
  // implementation of the union is a second thing that can disagree with the
  // gates, and it is always the one nobody is looking at.
  it("shows what each account may actually do", async () => {
    const id = await account({ planId: "premium" });
    const rows = await adminAccounts(200);
    const row = rows.find((account) => account.userId === id)!;
    expect(row.planVersionRef).toBe("premium@v1");
    expect([...row.entitlements].sort()).toEqual(["ai.ask", "ai.command", "trip.collaborators"]);
    expect(await accountCan(id, "trip.collaborators")).toBe(true);
  });
});

// **Asked 30d and Last active** (M36 link 2, D6). Read from the ledger and the
// event log at the console's own window, so each case plants rows on both
// sides of it and on another account.
describe("the accounts table's activity columns", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = new Date();
  const ago = (ms: number) => new Date(now.getTime() - ms);

  /** One planning event by `actorId`, through the command path, then dated. */
  async function plannedAt(actorId: string, at: Date) {
    const tripId = randomUUID();
    expect((await executeTripCommand({ type: "CreateTrip", tripId, name: "Activity" }, actorId)).ok).toBe(true);
    // Back-dated in place: the command stamps its own clock, and the read under
    // test is about WHEN, which only the stored row can be made to say.
    await db.update(events).set({ occurredAt: at.toISOString() }).where(eq(events.streamId, tripId));
  }

  const rowOf = async (userId: string) =>
    (await adminAccounts(500, now)).find((row) => row.userId === userId)!;

  it("counts only the window's turns as Asked", async () => {
    const id = await account({ planId: "plus" });
    await recordTurnLedger(usage(id), ago(2 * DAY));
    await recordTurnLedger(usage(id), ago(40 * DAY));
    expect((await rowOf(id)).requests).toBe(1);
  });

  it("takes the later of a turn and a planning event, whichever it is", async () => {
    const askedLast = await account({ planId: "plus" });
    await plannedAt(askedLast, ago(5 * DAY));
    await recordTurnLedger(usage(askedLast), ago(2 * DAY));

    const plannedLast = await account({ planId: "plus" });
    await recordTurnLedger(usage(plannedLast), ago(3 * DAY));
    await plannedAt(plannedLast, ago(DAY));

    expect((await rowOf(askedLast)).lastActiveAt).toBe(ago(2 * DAY).toISOString());
    expect((await rowOf(plannedLast)).lastActiveAt).toBe(ago(DAY).toISOString());
  });

  it("does not count another account's events", async () => {
    const quiet = await account();
    await plannedAt(quiet, ago(10 * DAY));
    // Newer, and somebody else's.
    await plannedAt(await account(), ago(DAY));
    expect((await rowOf(quiet)).lastActiveAt).toBe(ago(10 * DAY).toISOString());
  });

  it("is null for an account whose activity is all older than the window", async () => {
    const lapsed = await account({ planId: "plus" });
    await plannedAt(lapsed, ago(40 * DAY));
    await recordTurnLedger(usage(lapsed), ago(45 * DAY));
    const row = await rowOf(lapsed);
    expect(row.lastActiveAt).toBeNull();
    expect(row.requests).toBe(0);
  });
});

// **The accounts table is paged, counted and searched in SQL** (M36 perf
// pass). Each filter used to be a predicate over rows the resolver had
// already built (`AccountsPanel`'s `matchesFilter`); now it is a boolean in
// `accountsMatching`. So the fixture plants one account per rule — and per
// edge of a rule — and holds the SQL's counts and pages to the rule the row
// itself is drawn by, as the old client applied it.
describe("the accounts table's page", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = new Date();

  /**
   * One account whose address carries `tag`, so a search isolates the fixture,
   * each signed up a second after the last so "newest first" has one answer.
   */
  let signups = 0;
  async function tagged(tag: string, name: string, planId: "free" | "plus" = "free") {
    const id = `dev-${tag}-${name}-${randomUUID().slice(0, 8)}`;
    await upsertUser({ id, email: `${name}.${tag}@example.test`, name: null, image: null });
    signups += 1;
    const createdAt = new Date(now.getTime() - DAY + signups * 1000).toISOString();
    await db.update(users).set({ planId, planVersion: 1, createdAt }).where(eq(users.id, id));
    return id;
  }

  async function subscribe(
    userId: string,
    status: "active" | "past_due" | "canceled",
    options: { planId?: "free" | "plus" | "studio"; pastDueDays?: number; createdDaysAgo?: number } = {},
  ) {
    const created = new Date(now.getTime() - (options.createdDaysAgo ?? 10) * DAY);
    await db.insert(subscriptions).values({
      id: randomUUID(),
      userId,
      stripeCustomerId: `cus_${userId}`,
      stripeSubscriptionId: `sub_${randomUUID()}`,
      planId: options.planId ?? "plus",
      planVersion: 1,
      status,
      currentPeriodEnd: new Date(now.getTime() + 20 * DAY),
      cancelAtPeriodEnd: false,
      pastDueSince: options.pastDueDays === undefined ? null : new Date(now.getTime() - options.pastDueDays * DAY),
      lastEventAt: created,
      createdAt: created,
      updatedAt: created,
    });
  }

  async function grant(userId: string, options: { expired?: boolean; revoked?: boolean } = {}) {
    const premium = livePlanVersion("premium");
    await db.insert(entitlementGrants).values({
      id: randomUUID(),
      userId,
      planId: premium.planId,
      planVersion: premium.version,
      source: "admin",
      grantedBy: null,
      reason: "fixture",
      createdAt: new Date(now.getTime() - 5 * DAY),
      expiresAt: options.expired ? new Date(now.getTime() - DAY) : null,
      revokedAt: options.revoked ? new Date(now.getTime() - DAY) : null,
      revokedBy: null,
    });
  }

  /** Every account, one per rule and per edge of one. */
  async function fixture() {
    const tag = randomUUID().slice(0, 8);
    const ids = {
      payer: await tagged(tag, "payer", "plus"),
      // A conferring subscription this deploy cannot price still pays.
      unpriced: await tagged(tag, "unpriced", "plus"),
      // A subscription to a version sold at no charge confers and pays nothing.
      freeSub: await tagged(tag, "freesub"),
      late: await tagged(tag, "late", "plus"),
      lapsed: await tagged(tag, "lapsed", "plus"),
      // Its newest row is cancelled; `subscriptionFor` picks the older active one.
      resubscribed: await tagged(tag, "resubscribed", "plus"),
      granted: await tagged(tag, "granted"),
      expired: await tagged(tag, "expired"),
      revoked: await tagged(tag, "revoked"),
      sinking: await tagged(tag, "sinking", "plus"),
      idle: await tagged(tag, "idle"),
    };
    await subscribe(ids.payer, "active");
    // `studio@v1` is published and sold for no price (`price: null`), so a
    // subscription to it is unpriceable without inventing a version — which
    // `planVersions.republish.int.test.ts` refuses in any row.
    await subscribe(ids.unpriced, "active", { planId: "studio" });
    await subscribe(ids.freeSub, "active", { planId: "free" });
    await subscribe(ids.late, "past_due", { pastDueDays: 1 });
    await subscribe(ids.lapsed, "past_due", { pastDueDays: 5 });
    await subscribe(ids.resubscribed, "active", { createdDaysAgo: 40 });
    await subscribe(ids.resubscribed, "canceled", { createdDaysAgo: 2 });
    await subscribe(ids.sinking, "active");
    await grant(ids.granted);
    await grant(ids.expired, { expired: true });
    await grant(ids.revoked, { revoked: true });
    return { tag, ids, underwater: [ids.sinking] };
  }

  /** The old client's `matchesFilter`, over a row the resolver drew. */
  const grantsNothing = new Set<string>(
    [...new Set(PLAN_VERSIONS.map((entry) => entry.planId))].filter(
      (planId) => livePlanVersion(planId).entitlements.length === 0,
    ),
  );
  function drawnAs(row: AdminAccountRow, filter: AccountFilterId, underwater: readonly string[]): boolean {
    switch (filter) {
      case "all":
        return true;
      case "paying":
        return row.paysMicroUsd !== 0;
      case "granted":
        return row.grants.length > 0;
      case "unentitled":
        return grantsNothing.has(row.planVersionRef.split("@")[0]!);
      case "pastDue":
        return row.subscriptionState === "past_due";
      case "underwater":
        return underwater.includes(row.userId);
    }
  }

  /** Every page of one filter, in order, until the server runs out. */
  async function everyPage(query: string, filter: AccountFilterId, underwater: readonly string[]) {
    const pages = [];
    for (let page = 0; ; page += 1) {
      const served = await adminAccountsPage({ query, filter, page }, now, [], underwater);
      if (served.page !== page) break;
      pages.push(served);
      if ((page + 1) * ACCOUNTS_PAGE_SIZE >= served.counts[filter]) break;
    }
    return pages;
  }

  it("counts each filter by the rule its rows are drawn by", async () => {
    const { tag, ids, underwater } = await fixture();
    const [all] = await everyPage(tag, "all", underwater);
    const served = await everyPage(tag, "all", underwater);
    const rows = served.flatMap((page) => page.rows);
    // The witness: the search found the fixture and nothing else.
    expect(rows.map((row) => row.userId).sort()).toEqual(Object.values(ids).sort());

    // The rule each count is held to, and the number it comes to here.
    for (const filter of ACCOUNT_FILTER_IDS) {
      expect(all!.counts[filter], filter).toBe(rows.filter((row) => drawnAs(row, filter, underwater)).length);
    }
    expect(all!.counts).toEqual({
      all: 11,
      // payer, unpriced, late (inside its window), resubscribed, sinking.
      paying: 5,
      granted: 1,
      // freesub, granted, expired, revoked, idle — their held plan grants nothing.
      unentitled: 5,
      pastDue: 1,
      underwater: 1,
    });
  });

  it("serves each filter's own rows, newest first", async () => {
    const { tag, ids, underwater } = await fixture();
    const ofFilter = async (filter: AccountFilterId) =>
      (await everyPage(tag, filter, underwater)).flatMap((page) => page.rows.map((row) => row.userId));
    expect((await ofFilter("paying")).sort()).toEqual(
      [ids.payer, ids.unpriced, ids.late, ids.resubscribed, ids.sinking].sort(),
    );
    expect(await ofFilter("pastDue")).toEqual([ids.late]);
    expect(await ofFilter("granted")).toEqual([ids.granted]);
    expect(await ofFilter("underwater")).toEqual([ids.sinking]);
    // Newest first: `idle` was signed up last.
    expect((await ofFilter("all"))[0]).toBe(ids.idle);
  });

  it("serves at most a page of rows, covers the set once, and keeps the counts page to page", async () => {
    const { tag, ids, underwater } = await fixture();
    const pages = await everyPage(tag, "all", underwater);
    // 11 accounts: a full page and a short one.
    expect(pages.map((page) => page.rows.length)).toEqual([ACCOUNTS_PAGE_SIZE, 11 - ACCOUNTS_PAGE_SIZE]);
    expect(pages[1]!.counts).toEqual(pages[0]!.counts);
    const seen = pages.flatMap((page) => page.rows.map((row) => row.userId));
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.sort()).toEqual(Object.values(ids).sort());
    // Only the page's underwater rows are named, and they are on the page.
    for (const page of pages) {
      expect(page.underwater.every((id) => page.rows.some((row) => row.userId === id))).toBe(true);
    }
  });

  it("serves the last page with rows when asked past the end", async () => {
    const { tag, underwater } = await fixture();
    const served = await adminAccountsPage({ query: tag, filter: "all", page: 40 }, now, [], underwater);
    expect(served.page).toBe(1);
    expect(served.rows).toHaveLength(11 - ACCOUNTS_PAGE_SIZE);
  });

  // An address search is a substring, not a pattern: a `%` typed into the box
  // would otherwise match every account there is.
  it("searches addresses and ids as text, case-insensitively", async () => {
    const { tag, ids, underwater } = await fixture();
    const found = async (query: string) =>
      (await adminAccountsPage({ query, filter: "all", page: 0 }, now, [], underwater)).counts.all;
    expect(await found(`  LATE.${tag.toUpperCase()}  `)).toBe(1);
    // And the other way round: an address stored with capitals is found by a
    // lower-case search. The box lowercases what it sends, so this is the half
    // only the query's ILIKE can hold.
    await tagged(tag, "Shouty");
    expect(await found(`shouty.${tag}`)).toBe(1);
    // The id, which holds `-late-` where the address holds `late.`.
    expect(await found(ids.late)).toBe(1);
    expect(await found(`${tag}%`)).toBe(0);
    expect(await found(`${tag}_`)).toBe(0);
  });
});

describe("granting is the only write", () => {
  it("grants a plan at the live version, with an expiry and a reason", async () => {
    const admin = await account({ admin: true });
    const target = await account();
    currentUserId = admin;

    expect(await accountCan(target, "trip.collaborators")).toBe(false);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const res = await GRANT(grantBody(target, "premium", expiresAt));
    expect(res.status).toBe(201);

    // **Applies on the next request, with no sign-out and no token refresh.**
    expect(await accountCan(target, "trip.collaborators")).toBe(true);

    const [grant] = await allGrantsFor(target);
    expect(grant!.source).toBe("admin");
    // Who did it, and why — an audit column that would be a lie if it named
    // nobody.
    expect(grant!.grantedBy).toBe(admin);
    expect(grant!.reason).toBe("Comped for a support case.");
    // **Pinned to what was live when it was issued**, not re-read later. The
    // literal `1` here was the same coincidence as above: it asserted the pin
    // by naming the only version that existed. It now names the live one, which
    // is what `issueGrant` actually pins — and `resolver.test.ts` is where the
    // pin's real property lives, that a grant issued at `v1` still confers `v1`
    // after `v2` is published.
    expect(grant!.planVersion).toBe(livePlanVersion("premium").version);

    // And it lapses on its own, with no job.
    const after = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
    expect(await accountCan(target, "trip.collaborators", after)).toBe(false);
  });

  // `enabled` bounds what an operator may hand out, never what a holder may
  // do. That is what lets the fourth-plan proof ship without anyone receiving
  // it.
  it("refuses to hand out a disabled plan", async () => {
    currentUserId = await account({ admin: true });
    const target = await account();
    const res = await GRANT(grantBody(target, "studio"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("plan-not-available");
    expect(await allGrantsFor(target)).toHaveLength(0);
  });

  it("refuses a grant with no reason", async () => {
    currentUserId = await account({ admin: true });
    const res = await GRANT(
      new Request("http://localhost/api/admin/grants", {
        method: "POST",
        body: JSON.stringify({ userId: "someone", planId: "premium", expiresAt: null, reason: "" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  // **Revoking marks, it never deletes.** The row is what answers "has this
  // account ever held a trial", and removing it would hand the trial back.
  it("revokes by marking the row rather than removing it", async () => {
    currentUserId = await account({ admin: true });
    const target = await account();
    await issueGrant({
      userId: target,
      planId: "premium",
      planVersion: 1,
      source: "admin",
      grantedBy: currentUserId,
      expiresAt: null,
    });
    const [grant] = await allGrantsFor(target);
    const res = await REVOKE(
      new Request("http://localhost/api/admin/grants", {
        method: "DELETE",
        body: JSON.stringify({ grantId: grant!.id }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await accountCan(target, "trip.collaborators")).toBe(false);
    const [still] = await db.select().from(entitlementGrants).where(eq(entitlementGrants.id, grant!.id));
    expect(still).toBeDefined();
    expect(still!.revokedBy).toBe(currentUserId);
  });

  // **Already revoked is not the gate's 404.** The gate answers a caller who is
  // no longer an operator with 404 `not-found`; a second revoke of the same
  // grant must answer something the console can tell apart from that.
  it("answers 409 no-active-grant for a grant already revoked", async () => {
    currentUserId = await account({ admin: true });
    const target = await account();
    await issueGrant({
      userId: target,
      planId: "premium",
      planVersion: 1,
      source: "admin",
      grantedBy: currentUserId,
      expiresAt: null,
    });
    const [grant] = await allGrantsFor(target);
    const revoke = () =>
      REVOKE(
        new Request("http://localhost/api/admin/grants", {
          method: "DELETE",
          body: JSON.stringify({ grantId: grant!.id }),
        }),
      );
    expect((await revoke()).status).toBe(200);
    const again = await revoke();
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "no-active-grant" });
  });
});

describe("the operator bootstrap", () => {
  // **How the first operator exists at all.** Nothing in the product sets
  // `is_admin` — granting writes `entitlement_grants`, not this column — so
  // without a configured allowlist the first operator could only be made with
  // a psql session, and an operator surface nobody can reach is one that does
  // not exist. Found by trying to walk the gate end to end.
  it("promotes a configured id on sign-in", async () => {
    const id = newUser();
    vi.stubEnv("ADMIN_USER_IDS", id);
    try {
      await upsertUser({ id, email: null, name: null, image: null });
      expect(await isAdmin(id)).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  // **It only ever promotes.** An id removed from the variable keeps the bit
  // until somebody takes it away deliberately — demoting on absence would mean
  // a deploy that forgot the variable silently locking every operator out of
  // the console, which is the failure you notice at the worst moment.
  it("does not demote on a later sign-in with the id removed", async () => {
    const id = newUser();
    vi.stubEnv("ADMIN_USER_IDS", id);
    await upsertUser({ id, email: null, name: null, image: null });
    vi.unstubAllEnvs();
    await upsertUser({ id, email: "later@example.test", name: null, image: null });
    expect(await isAdmin(id)).toBe(true);
  });

  it("leaves an unconfigured account alone", async () => {
    const id = newUser();
    vi.stubEnv("ADMIN_USER_IDS", "somebody-else");
    try {
      await upsertUser({ id, email: null, name: null, image: null });
      expect(await isAdmin(id)).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
