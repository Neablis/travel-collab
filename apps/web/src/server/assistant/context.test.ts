import { describe, expect, it } from "vitest";
import type { Conflict, TripGlobals } from "@tc/contracts";
import { tripDetailFactory, tripDetailFixture } from "@tc/factories";
import {
  ASK_SCOPE_PREFIX,
  activeConflicts,
  askScopeLine,
  clockTimesLine,
  nowBlocks,
  parseAskScope,
  turnNowOf,
  type AskScope,
} from "./context";
import { renderPrompt } from "./prompt";

// Two conflicts with compound, UUID-embedding ids (as detectConflicts emits) —
// exactly the ids the model must NEVER be asked to copy.
const OVERLAP: Conflict = {
  id: "time-overlap:1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d:2c3d4e5f-6071-4b8c-9d0e-1f2a3b4c5d6e:3d4e5f60-7182-4c9d-0e1f-2a3b4c5d6e7f",
  kind: "time-overlap",
  severity: "warn",
  subjects: ["2c3d4e5f-6071-4b8c-9d0e-1f2a3b4c5d6e", "3d4e5f60-7182-4c9d-0e1f-2a3b4c5d6e7f"],
  description: '"Colosseum tour" and "Roman Forum" overlap in time on the same day.',
  resolutions: ["Change one activity's time window"],
};
const OVER_BUDGET: Conflict = {
  id: "over-budget:6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f",
  kind: "over-budget",
  severity: "warn",
  subjects: ["6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f"],
  description: "Trip total exceeds the budget.",
  resolutions: ["Raise the budget"],
};

// `activeConflicts` is the SINGLE source of conflict `ref` numbering: /ask's
// `read_trip` (readTools.ts) and `batchResolver`'s `conflictRef` resolution both
// read it, so the number the model is shown and the id the server resolves it
// back to cannot drift. Asserted here directly, because nothing else asserts the
// dismissal filter or the renumbering that follows it.
//
// It used to sit under a `buildEnvelope` describe. That envelope went with the
// command endpoint (ADR-033 Decision 4) and its tests with it; this did not.
describe("activeConflicts", () => {
  it("keeps input order and carries the id for the resolver", () => {
    const detail = tripDetailFixture({ conflicts: [OVERLAP, OVER_BUDGET], dismissedConflictIds: [] });

    expect(activeConflicts(detail)).toEqual([
      { ref: 1, id: OVERLAP.id, kind: "time-overlap", description: OVERLAP.description },
      { ref: 2, id: OVER_BUDGET.id, kind: "over-budget", description: OVER_BUDGET.description },
    ]);
  });

  it("excludes dismissed conflicts and renumbers refs over what remains", () => {
    const detail = tripDetailFixture({
      conflicts: [OVERLAP, OVER_BUDGET],
      dismissedConflictIds: [OVERLAP.id],
    });

    expect(activeConflicts(detail)).toEqual([
      { ref: 1, id: OVER_BUDGET.id, kind: "over-budget", description: OVER_BUDGET.description },
    ]);
  });

  it("is empty when every conflict is dismissed", () => {
    const detail = tripDetailFixture({
      conflicts: [OVERLAP, OVER_BUDGET],
      dismissedConflictIds: [OVERLAP.id, OVER_BUDGET.id],
    });

    expect(activeConflicts(detail)).toEqual([]);
  });
});

// The /ask turn's scope travels to the model inside the system instruction, and
// `simulatedModel` reads it back out to decide whether to call `read_day`. The
// writer and the reader live in one module precisely so this round trip can be
// asserted; if it ever broke, a day-scoped question would silently be answered
// about the whole trip.
describe("the ask scope encoding", () => {
  const scopes: AskScope[] = [
    { kind: "trip" },
    { kind: "day", dayIndex: 0 },
    { kind: "day", dayIndex: 13 },
    // The page member (ADR-033 Decision 4). The id round-trips unread — the
    // page was resolved server-side before this line was written — but it has
    // to SURVIVE, because `simulatedModel` decides to compose rather than
    // answer from `kind` alone and a scope that degraded to `trip` here would
    // make a page turn answer a question instead.
    { kind: "page", pageId: "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f" },
    // M45: no trip at all. Degrading to `trip` here would send the simulated
    // model to `read_trip`, which an account turn is not handed.
    { kind: "account" },
    // M45 D9: a playbook page, which the simulated model reads to choose its
    // tools — a list page's or a shared day's.
    { kind: "playbook", page: { kind: "day", savedDayId: "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f" } },
    { kind: "playbook", page: { kind: "tag", tag: "meal", city: "kyoto", page: 2 } },
  ];

  it("round-trips every scope through an instruction", () => {
    for (const scope of scopes) {
      const instructions = ["You are the assistant.", askScopeLine(scope), "Answer briefly."].join("\n");
      expect(parseAskScope(instructions)).toEqual(scope);
    }
  });

  // Total by design: a narrowing that silently failed would answer about one
  // day without saying it had. The whole trip is the wider, safer reading.
  it("reads anything it cannot parse as the whole trip", () => {
    // Built from the real prefix, not a hard-coded "Scope: " — otherwise a
    // prefix change would silently stop these from reaching the
    // JSON.parse catch branch (and the invalid-dayIndex rejection below it)
    // they claim to cover, and still pass by matching parseAskScope's own
    // "anything unparseable" default.
    expect(parseAskScope("")).toEqual({ kind: "trip" });
    expect(parseAskScope(`${ASK_SCOPE_PREFIX}not json`)).toEqual({ kind: "trip" });
    expect(parseAskScope(`${ASK_SCOPE_PREFIX}{"kind":"day"}`)).toEqual({ kind: "trip" });
    expect(parseAskScope(`${ASK_SCOPE_PREFIX}{"kind":"day","dayIndex":"2"}`)).toEqual({ kind: "trip" });
    expect(parseAskScope(`${ASK_SCOPE_PREFIX}{"kind":"page"}`)).toEqual({ kind: "trip" });
    expect(parseAskScope(`${ASK_SCOPE_PREFIX}{"kind":"page","pageId":""}`)).toEqual({ kind: "trip" });
    expect(parseAskScope("The user mentioned a scope of day 4.")).toEqual({ kind: "trip" });
  });
});

describe("clockTimesLine", () => {
  // Each clock is named by its own examples, and neither line lets the
  // reader's format leak into a tool call: stored times stay `HH:mm`.
  it("names the asker's clock by example, and keeps tool input on HH:mm", () => {
    expect(clockTimesLine("12h")).toContain('"2 pm"');
    expect(clockTimesLine("12h")).toContain("keep passing HH:mm to a tool");
    expect(clockTimesLine("24h")).toContain('"14:00"');
    expect(clockTimesLine("24h")).toContain("24-hour HH:mm as well");
    expect(clockTimesLine("24h")).not.toContain("pm");
  });
});

// M52 decision 14a: an under-way turn is told the local time, today and the
// stops either side of now, and no other turn is told anything new.
describe("the turn's now", () => {
  // Three stops, 09-10, 10-11 and 11-12, at the Colosseum, the Forum and the
  // Vatican, on 2026-06-10.
  const trip = tripDetailFactory.build({}, { transient: { dayCount: 1, activitiesPerDay: 3, located: true, startDate: "2026-06-10" } });
  const [first, second, third] = trip.days[0]!.activityIds;
  const inTokyo = {
    days: [{ index: 0, date: "2026-06-10", cities: ["Rome"], activityCount: 3, costSubtotal: 0, place: { lat: 41.89, lng: 12.49, city: "Rome" }, timeZone: "Asia/Tokyo" }],
  } as unknown as TripGlobals;

  it("reads the stops either side of now on the day's own clock", () => {
    // 01:30 UTC is 10:30 in Tokyo, inside the second stop's window.
    const now = turnNowOf(trip, inTokyo, Date.parse("2026-06-10T01:30:00Z"));
    expect(now).toMatchObject({ phase: "underway", dayIndex: 0, local: { date: "2026-06-10", time: "10:30" } });
    expect([now.passed?.activityId, now.current?.activityId, now.next?.activityId]).toEqual([first, second, third]);
    expect(now.city).toEqual({ name: "Rome", lat: 41.89, lng: 12.49 });
  });

  // ADR-080 decision 1: a day with no zone is read on the device's. At 20:30
  // in New York it is already 00:30 tomorrow on UTC, which put the assistant a
  // day ahead of Home's badge every evening, and past the end of this one-day
  // trip while Home still showed it under way (PR 534 review, finding 1).
  it("reads a zone-less trip on the asker's zone, so a New York evening is still today", () => {
    const now = turnNowOf(trip, null, Date.parse("2026-06-11T00:30:00Z"), "America/New_York");
    expect(now).toMatchObject({ phase: "underway", dayIndex: 0, local: { date: "2026-06-10", time: "20:30" } });
    expect(now.passed?.activityId).toBe(third);
  });

  it("runs on UTC when no day has a zone and the asker sent none", () => {
    const now = turnNowOf(trip, null, Date.parse("2026-06-10T10:30:00Z"));
    expect(now.current?.activityId).toBe(second);
    expect(now.local.time).toBe("10:30");
    expect(now.city).toBeNull();
  });

  it("passes over a zone this runtime does not know rather than failing the turn", () => {
    const unknown = { days: [{ ...inTokyo.days[0]!, timeZone: "Mars/Olympus_Mons" }] } as unknown as TripGlobals;
    const now = turnNowOf(trip, unknown, Date.parse("2026-06-10T10:30:00Z"));
    expect(now.local).toEqual({ date: "2026-06-10", time: "10:30" });
    expect(now.current?.activityId).toBe(second);
  });

  // The device zone is bounded by length only; one reaching `clockIn` would
  // throw a RangeError after quota is reserved.
  it("passes over a device zone this runtime does not know, reading on UTC", () => {
    const now = turnNowOf(trip, null, Date.parse("2026-06-10T10:30:00Z"), "Mars/Olympus_Mons");
    expect(now.local).toEqual({ date: "2026-06-10", time: "10:30" });
    expect(now.current?.activityId).toBe(second);
  });

  // ADR-080 decision 1, as Home's badge reads it. Today has no zone of its own
  // unless given one; the second day is in Tokyo. 14:30 UTC is 16:30 in Rome,
  // 10:30 in New York and 23:30 in Tokyo.
  it("reads today on its own zone, then the asker's, then the trip's first, then UTC", () => {
    const twoDays = tripDetailFactory.build({}, { transient: { dayCount: 2, activitiesPerDay: 3, startDate: "2026-06-10" } });
    const day = (index: number, timeZone: string | null) => ({ ...inTokyo.days[0]!, index, place: null, timeZone });
    const globals = (today: string | null) => ({ days: [day(0, today), day(1, "Asia/Tokyo")] }) as unknown as TripGlobals;
    const at = Date.parse("2026-06-10T14:30:00Z");
    const timeOf = (today: string | null, deviceZone: string | null) => turnNowOf(twoDays, globals(today), at, deviceZone).local.time;
    expect(timeOf("Europe/Rome", "America/New_York")).toBe("16:30");
    expect(timeOf(null, "America/New_York")).toBe("10:30");
    expect(timeOf(null, null)).toBe("23:30");
    expect(turnNowOf(twoDays, null, at).local.time).toBe("14:30");
  });

  it("puts the local time, the day and the fenced stop titles in a data line, under way only", () => {
    const rendered = renderPrompt(nowBlocks(turnNowOf(trip, null, Date.parse("2026-06-10T10:30:00Z")), trip));
    const line = rendered.split("\n").find((text) => text.startsWith("Now: "))!;
    expect(JSON.parse(line.slice("Now: ".length))).toEqual({
      date: "2026-06-10",
      time: "10:30",
      day: 1,
      current: { title: `⟦${trip.activities[second!]!.title}⟧`, day: 1, from: "10:00", to: "11:00" },
      next: { title: `⟦${trip.activities[third!]!.title}⟧`, day: 1, from: "11:00", to: "12:00" },
    });
    expect(nowBlocks(turnNowOf(trip, null, Date.parse("2026-05-01T10:30:00Z")), trip)).toEqual([]);
    expect(nowBlocks(turnNowOf(trip, null, Date.parse("2026-06-12T10:30:00Z")), trip)).toEqual([]);
    expect(nowBlocks(null, trip)).toEqual([]);
  });
});
