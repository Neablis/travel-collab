import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "./db/client";
import { savedDays } from "./db/schema";
import { createReport, actOnReport } from "./reports";
import { executeTripCommand } from "./commands";
import {
  deleteSavedDay,
  insertSavedDay,
  newSavedDayRow,
  setSavedDayVisibility,
  updatePlaybookContent,
} from "./savedDays";

// Every write that can put a day in the library or take one out clears the
// cached library after it commits (ADR-063). Asserted on the write functions
// rather than on routes: `/api/saved-days`, `/v1/library`, `/v1/playbooks` and
// the operator's console all reach the library through these four.
vi.mock("./libraryCache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./libraryCache")>()),
  invalidatePublicDay: vi.fn(async () => {}),
  invalidateDayRead: vi.fn(async () => {}),
}));
const { invalidateDayRead, invalidatePublicDay } = await import("./libraryCache");

const RUN = randomUUID().slice(0, 8);
const AUTHOR = `writer-author-${RUN}`;
const STRANGER = `writer-stranger-${RUN}`;
const ids: string[] = [];

async function day(visibility: "public" | "private" = "private"): Promise<string> {
  const row = newSavedDayRow({
    ownerId: AUTHOR,
    name: "A day",
    stops: [],
    sourceTripId: randomUUID(),
    sourceTripName: "Source",
    createdAt: new Date(),
  });
  await db.insert(savedDays).values({ ...row, visibility, publishedAt: visibility === "public" ? new Date() : null });
  ids.push(row.id);
  return row.id;
}

beforeEach(() => {
  vi.mocked(invalidatePublicDay).mockClear();
  vi.mocked(invalidateDayRead).mockClear();
});

afterAll(async () => {
  await db.delete(savedDays).where(inArray(savedDays.id, ids));
});

describe("what clears the cached library", () => {
  it("a publish and an unpublish, for that day and its author; a refused one clears nothing", async () => {
    const id = await day();

    await setSavedDayVisibility(id, STRANGER, "public");
    expect(invalidatePublicDay).not.toHaveBeenCalled();

    await setSavedDayVisibility(id, AUTHOR, "public");
    await setSavedDayVisibility(id, AUTHOR, "private");
    expect(vi.mocked(invalidatePublicDay).mock.calls).toEqual([
      [id, AUTHOR],
      [id, AUTHOR],
    ]);
  });

  it("an edit that publishes, or renames a published day; not a summary, nor a private rename", async () => {
    const id = await day();

    await updatePlaybookContent(id, AUTHOR, { name: "Renamed in private", expectedVersion: 1 });
    expect(invalidatePublicDay).not.toHaveBeenCalled();

    await updatePlaybookContent(id, AUTHOR, { visibility: "public" });
    await updatePlaybookContent(id, AUTHOR, { summary: "Stale for a day is fine.", expectedVersion: 2 });
    await updatePlaybookContent(id, AUTHOR, { name: "Renamed in public", expectedVersion: 3 });
    expect(vi.mocked(invalidatePublicDay).mock.calls).toEqual([
      [id, AUTHOR],
      [id, AUTHOR],
    ]);
  });

  it("a delete, which moves its author's numbers", async () => {
    const id = await day();

    expect(await deleteSavedDay(id, AUTHOR)).toBe("deleted");
    expect(invalidatePublicDay).toHaveBeenCalledExactlyOnceWith(id, AUTHOR);
  });

  it("an add that counts clears that day's read and its author's, and never the library", async () => {
    const id = await day("public");
    const tripId = randomUUID();
    const created = await executeTripCommand({ type: "CreateTrip", tripId, name: "Somebody's" }, STRANGER);
    expect(created.ok).toBe(true);

    expect((await insertSavedDay(id, tripId, STRANGER)).ok).toBe(true);
    // The same day into the same trip again counts once (the ledger's key).
    expect((await insertSavedDay(id, tripId, STRANGER)).ok).toBe(true);

    expect(vi.mocked(invalidateDayRead).mock.calls).toEqual([[id, AUTHOR]]);
    expect(invalidatePublicDay).not.toHaveBeenCalled();
  });

  it("an operator's hide and restore, naming the day's author; a dismissal clears nothing", async () => {
    const id = await day("public");
    const filed = await createReport(STRANGER, { target: { kind: "saved_day", savedDayId: id }, reason: "spam", note: null });
    if (!filed.ok) throw new Error(filed.error.message);
    const { reportId } = filed.value.report;

    await actOnReport(reportId, { action: "dismiss" }, "operator");
    expect(invalidatePublicDay).not.toHaveBeenCalled();

    await actOnReport(reportId, { action: "hide-day" }, "operator");
    await actOnReport(reportId, { action: "restore-day" }, "operator");
    expect(vi.mocked(invalidatePublicDay).mock.calls).toEqual([
      [id, AUTHOR],
      [id, AUTHOR],
    ]);
  });
});
