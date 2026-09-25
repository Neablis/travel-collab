import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { locationFactory } from "@tc/factories";
import type { DiscoverResponse, LeaderboardResponse, PublicProfileResponse } from "@/lib/playbooks";
import type { AdminReportsResponse, CreateReportResponse } from "@/lib/reports";
import type { CityMatch } from "@/lib/cities";
import { executeTripCommand } from "@/server/commands";
import { db } from "@/server/db/client";
import { contentReports, savedDayReviews, savedDays, users } from "@/server/db/schema";
import { upsertUser } from "@/server/users";

// Reporting and moderation (M12 link 6), against the real database and the
// real routes.
//
// The exit-gate box this file exists for: *"a reported day is removed from
// Discover, the board and profiles by one action, the author still has their
// copy"*. One test asserts every one of those surfaces after a single
// `hide-day`, because the risk is a read that forgets `moderated_at` — and a
// test per surface would pass for each surface someone remembered.
//
// Cities are minted per run for `playbooks/route.int.test.ts`'s reason: the
// library is global, and a shared name would depend on what else is in it.
const RUN = randomUUID().slice(0, 8);
const AUTHOR = `rep-author-${RUN}`;
const READER = `rep-reader-${RUN}`;
const SECOND = `rep-second-${RUN}`;
const REVIEWER = `rep-reviewer-${RUN}`;
const ADMIN = `rep-admin-${RUN}`;

const city = (stem: string) => `${stem}${randomUUID().slice(0, 8)}`;

let currentUserId: string | null = AUTHOR;

vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (currentUserId ? { user: { id: currentUserId } } : null)),
}));

const { POST: REPORT } = await import("./route");
const { GET: QUEUE } = await import("../admin/reports/route");
const { POST: ACT } = await import("../admin/reports/[reportId]/route");
const { GET: DISCOVER } = await import("../playbooks/route");
const { GET: BOARD } = await import("../playbooks/board/route");
const { GET: PROFILE } = await import("../playbooks/profile/[userId]/route");
const { GET: CITIES } = await import("../cities/route");
const { GET: LIBRARY, POST: SAVE } = await import("../saved-days/route");
const { GET: READ } = await import("../saved-days/[savedDayId]/route");
const { POST: PUBLISH, DELETE: UNPUBLISH } = await import("../saved-days/[savedDayId]/publish/route");
const { POST: INSERT } = await import("../trips/[tripId]/saved-days/[savedDayId]/route");

async function as<T>(userId: string | null, run: () => Promise<T>): Promise<T> {
  const before = currentUserId;
  currentUserId = userId;
  try {
    return await run();
  } finally {
    currentUserId = before;
  }
}

/** A published (unless `publish: false`) one-stop day in `cityName`, owned by `owner`. */
async function sharedDay(owner: string, cityName: string, options: { publish?: boolean } = {}): Promise<string> {
  return as(owner, async () => {
    const tripId = randomUUID();
    const dayId = randomUUID();
    await executeTripCommand({ type: "CreateTrip", tripId, name: "Source" }, owner);
    await executeTripCommand({ type: "AddDay", tripId, dayId }, owner);
    await executeTripCommand(
      {
        type: "AddActivity",
        tripId,
        activityId: randomUUID(),
        dayId,
        title: `Stop in ${cityName}`,
        timeWindow: { start: "09:00", end: "10:00" },
        location: locationFactory.build({ city: cityName }),
      },
      owner,
    );
    const res = await SAVE(
      new Request("http://test/x", {
        method: "POST",
        body: JSON.stringify({ name: `Day in ${cityName}`, tripId, dayIds: [dayId] }),
      }),
    );
    expect(res.status).toBe(201);
    const savedDayId = ((await res.json()) as { savedDay: { savedDayId: string } }).savedDay.savedDayId;
    if (options.publish !== false) await publish(savedDayId);
    return savedDayId;
  });
}

async function publish(savedDayId: string): Promise<void> {
  const res = await PUBLISH(new Request("http://test/x", { method: "POST" }), {
    params: Promise.resolve({ savedDayId }),
  });
  expect(res.status).toBe(200);
}

/** A fresh trip of the signed-in person's, with `savedDayId` inserted into it. */
async function take(savedDayId: string): Promise<Response> {
  const tripId = randomUUID();
  await executeTripCommand({ type: "CreateTrip", tripId, name: "Target" }, currentUserId!);
  return INSERT(new Request("http://test/x", { method: "POST" }), {
    params: Promise.resolve({ tripId, savedDayId }),
  });
}

function report(body: unknown): Promise<Response> {
  return REPORT(new Request("http://test/api/reports", { method: "POST", body: JSON.stringify(body) }));
}

async function reportDay(savedDayId: string): Promise<CreateReportResponse> {
  const res = await report({ target: { kind: "saved_day", savedDayId }, reason: "spam" });
  expect([200, 201]).toContain(res.status);
  return (await res.json()) as CreateReportResponse;
}

function act(reportId: string, action: unknown): Promise<Response> {
  return ACT(new Request("http://test/x", { method: "POST", body: JSON.stringify(action) }), {
    params: Promise.resolve({ reportId }),
  });
}

async function queue(status = "open"): Promise<AdminReportsResponse> {
  const res = await QUEUE(new Request(`http://test/api/admin/reports?status=${status}`));
  expect(res.status).toBe(200);
  return (await res.json()) as AdminReportsResponse;
}

async function discover(query: string): Promise<DiscoverResponse> {
  return (await (await DISCOVER(new Request(`http://test/api/playbooks?${query}`))).json()) as DiscoverResponse;
}

async function profile(userId: string): Promise<PublicProfileResponse> {
  const res = await PROFILE(new Request("http://test/x"), { params: Promise.resolve({ userId }) });
  return (await res.json()) as PublicProfileResponse;
}

async function citiesFor(q: string): Promise<CityMatch[]> {
  return ((await (await CITIES(new Request(`http://test/api/cities?q=${q}`))).json()) as { cities: CityMatch[] })
    .cities;
}

async function read(savedDayId: string): Promise<Response> {
  return READ(new Request("http://test/x"), { params: Promise.resolve({ savedDayId }) });
}

// The operator. `users.is_admin` is what `requireAdminApi` reads, and the
// admin console's own tests set it the same way.
await upsertUser({ id: ADMIN, email: `${ADMIN}@example.test`, name: null, image: null });
await db.update(users).set({ isAdmin: true }).where(eq(users.id, ADMIN));

describe("POST /api/reports", () => {
  it("refuses an anonymous report and an ill-formed one", async () => {
    const day = await sharedDay(AUTHOR, city("repanon"));
    expect((await as(null, () => report({ target: { kind: "saved_day", savedDayId: day }, reason: "spam" }))).status)
      .toBe(401);
    expect((await as(READER, () => report({ target: { kind: "saved_day", savedDayId: day }, reason: "rude" }))).status)
      .toBe(400);
  });

  it("refuses your own day with 403 own-content", async () => {
    const day = await sharedDay(AUTHOR, city("repown"));
    const res = await as(AUTHOR, () => report({ target: { kind: "saved_day", savedDayId: day }, reason: "spam" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "own-content" });
  });

  // The 403 above must not be reachable for what the reporter cannot read, or
  // it would confirm a private day exists. A private day and an id that names
  // nothing get one identical answer.
  it("answers 404, identically, for a private day and for nothing at all", async () => {
    const hidden = await sharedDay(AUTHOR, city("reppriv"), { publish: false });
    const privateRes = await as(READER, () => report({ target: { kind: "saved_day", savedDayId: hidden }, reason: "spam" }));
    const noneRes = await as(READER, () =>
      report({ target: { kind: "saved_day", savedDayId: randomUUID() }, reason: "spam" }),
    );
    expect(privateRes.status).toBe(404);
    expect(noneRes.status).toBe(404);
    expect(await privateRes.json()).toEqual(await noneRes.json());
  });

  it("files once: a re-report is 200 with the report already filed", async () => {
    const day = await sharedDay(AUTHOR, city("repagain"));
    const first = await as(READER, () => report({ target: { kind: "saved_day", savedDayId: day }, reason: "spam" }));
    const again = await as(READER, () =>
      report({ target: { kind: "saved_day", savedDayId: day }, reason: "offensive", note: "second thoughts" }),
    );
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    const [a, b] = [(await first.json()) as CreateReportResponse, (await again.json()) as CreateReportResponse];
    expect(b.report).toEqual(a.report);
    const rows = await db.select().from(contentReports).where(eq(contentReports.savedDayId, day));
    expect(rows).toHaveLength(1);
  });
});

describe("the operator's queue", () => {
  // M20's rule for the whole admin surface: not merely hidden, a 404.
  it("404s both admin report endpoints for a signed-in non-admin and for nobody", async () => {
    for (const who of [READER, null]) {
      await as(who, async () => {
        expect((await QUEUE(new Request("http://test/api/admin/reports"))).status).toBe(404);
        expect((await act(randomUUID(), { action: "dismiss" })).status).toBe(404);
      });
    }
  });

  it("refuses a review action on a day report", async () => {
    const day = await sharedDay(AUTHOR, city("repmis"));
    const { report: filed } = await as(READER, () => reportDay(day));
    const res = await as(ADMIN, () => act(filed.reportId, { action: "hide-review" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "action-mismatch" });
  });

  it("dismisses every open report on the target and hides nothing", async () => {
    const CITY = city("repdis");
    const day = await sharedDay(AUTHOR, CITY);
    const { report: first } = await as(READER, () => reportDay(day));
    const { report: second } = await as(SECOND, () => reportDay(day));
    const res = await as(ADMIN, () => act(first.reportId, { action: "dismiss" }));
    expect(res.status).toBe(200);
    const rows = await db.select().from(contentReports).where(eq(contentReports.savedDayId, day));
    expect(rows.map((r) => [r.id, r.status, r.resolvedBy]).sort()).toEqual(
      [
        [first.reportId, "dismissed", ADMIN],
        [second.reportId, "dismissed", ADMIN],
      ].sort(),
    );
    const seen = await as(READER, () => discover(`city=${CITY}`));
    expect(seen.days.map((d) => d.savedDayId)).toEqual([day]);
  });
});

describe("hide-day", () => {
  // THE EXIT-GATE BOX. One action, every surface.
  it("removes a reported day from Discover, the board and profiles, and the author keeps their copy", async () => {
    const MOD_AUTHOR = `rep-modauthor-${RUN}`;
    const CITY = city("Repmod");
    const day = await sharedDay(MOD_AUTHOR, CITY);
    // Somebody took it, so the author is on the board and the day is in the
    // taker's `saved` scope — two more surfaces for the hide to reach.
    expect((await as(READER, () => take(day))).status).toBe(200);

    const { report: first } = await as(READER, () => reportDay(day));
    await as(SECOND, () => reportDay(day));

    // Before: visible everywhere a stranger looks. Without this the "after"
    // assertions below would pass on a day that was never visible at all.
    const sharedBefore = (await as(READER, () => discover(`city=${CITY}`))).sharedDayCount;
    await as(READER, async () => {
      expect((await discover(`city=${CITY}`)).days.map((d) => d.savedDayId)).toEqual([day]);
      expect((await discover(`city=${CITY}&scope=saved`)).days.map((d) => d.savedDayId)).toEqual([day]);
      expect(((await (await BOARD()).json()) as LeaderboardResponse).authors.map((a) => a.userId)).toContain(MOD_AUTHOR);
      const seen = await profile(MOD_AUTHOR);
      expect(seen.days.map((d) => d.savedDayId)).toEqual([day]);
      expect(seen.knows).toEqual([{ city: CITY, days: 1 }]);
      expect(seen.author.playbooksShared).toBe(1);
      expect(await citiesFor(CITY)).toEqual([{ city: CITY, days: 1 }]);
      expect((await read(day)).status).toBe(200);
    });

    // The operator sees what they are deciding about.
    const item = (await as(ADMIN, () => queue())).reports.find((r) => r.report.reportId === first.reportId)!;
    expect(item).toMatchObject({
      day: { savedDayId: day, name: `Day in ${CITY}`, ownerId: MOD_AUTHOR, moderatedAt: null },
      review: null,
      reportsOnTarget: 2,
    });

    // ONE action.
    const acted = await as(ADMIN, () => act(first.reportId, { action: "hide-day", note: "Spam links." }));
    expect(acted.status).toBe(200);
    expect(((await acted.json()) as { report: { status: string; resolvedBy: string } }).report).toMatchObject({
      status: "actioned",
      resolvedBy: ADMIN,
    });
    // Both people's reports are settled by it, and the queue no longer holds either.
    const rows = await db.select().from(contentReports).where(eq(contentReports.savedDayId, day));
    expect(rows.map((r) => r.status)).toEqual(["actioned", "actioned"]);
    expect((await as(ADMIN, () => queue())).reports.map((r) => r.report.target.savedDayId))
      .not.toContain(day);

    // After, for a stranger: gone from every surface.
    await as(READER, async () => {
      expect((await discover(`city=${CITY}`)).days).toEqual([]);
      expect((await discover(`city=${CITY}&scope=saved`)).days).toEqual([]);
      expect((await discover(`city=${CITY}`)).sharedDayCount).toBe(sharedBefore - 1);
      expect(((await (await BOARD()).json()) as LeaderboardResponse).authors.map((a) => a.userId)).not.toContain(
        MOD_AUTHOR,
      );
      const seen = await profile(MOD_AUTHOR);
      expect(seen.days).toEqual([]);
      expect(seen.knows).toEqual([]);
      expect(seen.author.playbooksShared).toBe(0);
      expect(await citiesFor(CITY)).toEqual([]);
    });

    // The shared-day read and the insert both 404 exactly as a private day does.
    const privateDay = await sharedDay(MOD_AUTHOR, city("repprivate"), { publish: false });
    await as(READER, async () => {
      const [moderated, isPrivate] = [await read(day), await read(privateDay)];
      expect(moderated.status).toBe(404);
      expect(await moderated.json()).toEqual(await isPrivate.json());
      const [insertModerated, insertPrivate] = [await take(day), await take(privateDay)];
      expect(insertModerated.status).toBe(404);
      expect(await insertModerated.json()).toEqual(await insertPrivate.json());
    });

    // The author still has their copy: library, `yours`, their own read.
    await as(MOD_AUTHOR, async () => {
      const library = (await (await LIBRARY()).json()) as { savedDays: { savedDayId: string }[] };
      expect(library.savedDays.map((d) => d.savedDayId)).toContain(day);
      expect((await discover(`city=${CITY}&scope=yours`)).days.map((d) => d.savedDayId)).toEqual([day]);
      expect((await read(day)).status).toBe(200);
      // But their PROFILE is what other people see, and shows them the same page.
      expect((await profile(MOD_AUTHOR)).days).toEqual([]);
    });

    const [stored] = await db.select().from(savedDays).where(eq(savedDays.id, day));
    expect(stored).toMatchObject({ visibility: "public", moderationNote: "Spam links." });
    expect(stored!.moderatedAt).not.toBeNull();
  });

  // The two axes are independent (the schema's `moderatedAt` note): an author
  // cannot unpublish-and-republish their way out of an operator's decision.
  it("is not undone by the author republishing", async () => {
    const CITY = city("repagain");
    const day = await sharedDay(AUTHOR, CITY);
    const { report: filed } = await as(READER, () => reportDay(day));
    expect((await as(ADMIN, () => act(filed.reportId, { action: "hide-day" }))).status).toBe(200);

    await as(AUTHOR, async () => {
      const res = await UNPUBLISH(new Request("http://test/x", { method: "DELETE" }), {
        params: Promise.resolve({ savedDayId: day }),
      });
      expect(res.status).toBe(200);
      await publish(day);
    });
    const [stored] = await db.select().from(savedDays).where(eq(savedDays.id, day));
    expect(stored!.visibility).toBe("public");
    expect((await as(READER, () => discover(`city=${CITY}`))).days).toEqual([]);
  });

  it("is undone by restore-day, which brings the day back everywhere", async () => {
    const RESTORE_AUTHOR = `rep-restore-${RUN}`;
    const CITY = city("Represt");
    const day = await sharedDay(RESTORE_AUTHOR, CITY);
    const { report: filed } = await as(READER, () => reportDay(day));
    expect((await as(ADMIN, () => act(filed.reportId, { action: "hide-day" }))).status).toBe(200);
    expect((await as(READER, () => discover(`city=${CITY}`))).days).toEqual([]);

    expect((await as(ADMIN, () => act(filed.reportId, { action: "restore-day" }))).status).toBe(200);

    await as(READER, async () => {
      expect((await discover(`city=${CITY}`)).days.map((d) => d.savedDayId)).toEqual([day]);
      expect(((await (await BOARD()).json()) as LeaderboardResponse).authors.map((a) => a.userId)).toContain(
        RESTORE_AUTHOR,
      );
      expect((await profile(RESTORE_AUTHOR)).days.map((d) => d.savedDayId)).toEqual([day]);
      expect(await citiesFor(CITY)).toEqual([{ city: CITY, days: 1 }]);
      expect((await read(day)).status).toBe(200);
    });
    // The report keeps its record of what was done.
    const [row] = await db.select().from(contentReports).where(eq(contentReports.id, filed.reportId));
    expect(row!.status).toBe("actioned");
  });
});

describe("hide-review", () => {
  // Written through the database: the review write path is Unit 2's, and these
  // are ordinary CRUD rows. The counters are set as that path would leave them.
  it("takes the review out of the day's counters, and restore-review puts it back", async () => {
    const CITY = city("reprev");
    const day = await sharedDay(AUTHOR, CITY);
    const now = new Date();
    await db.insert(savedDayReviews).values([
      { savedDayId: day, reviewerId: REVIEWER, stars: 1, note: "Awful", createdAt: now, updatedAt: now },
      { savedDayId: day, reviewerId: SECOND, stars: 5, note: null, createdAt: now, updatedAt: now },
    ]);
    await db.update(savedDays).set({ rating: 3, reviewCount: 2 }).where(eq(savedDays.id, day));

    const res = await as(READER, () =>
      report({ target: { kind: "review", savedDayId: day, reviewerId: REVIEWER }, reason: "offensive" }),
    );
    expect(res.status).toBe(201);
    const { report: filed } = (await res.json()) as CreateReportResponse;

    const item = (await as(ADMIN, () => queue())).reports.find((r) => r.report.reportId === filed.reportId)!;
    expect(item.review).toMatchObject({ reviewerId: REVIEWER, stars: 1, note: "Awful", hiddenAt: null });

    expect((await as(ADMIN, () => act(filed.reportId, { action: "hide-review" }))).status).toBe(200);
    const card = async () => (await as(READER, () => discover(`city=${CITY}`))).days[0]!;
    expect(await card()).toMatchObject({ rating: 5, reviewCount: 1 });
    // The day itself is untouched.
    expect((await as(READER, () => read(day))).status).toBe(200);

    expect((await as(ADMIN, () => act(filed.reportId, { action: "restore-review" }))).status).toBe(200);
    expect(await card()).toMatchObject({ rating: 3, reviewCount: 2 });
  });

  it("refuses your own review with 403 own-content", async () => {
    const day = await sharedDay(AUTHOR, city("repownrev"));
    const now = new Date();
    await db
      .insert(savedDayReviews)
      .values({ savedDayId: day, reviewerId: REVIEWER, stars: 4, note: null, createdAt: now, updatedAt: now });
    const res = await as(REVIEWER, () =>
      report({ target: { kind: "review", savedDayId: day, reviewerId: REVIEWER }, reason: "spam" }),
    );
    expect(res.status).toBe(403);
  });
});
