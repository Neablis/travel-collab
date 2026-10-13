// **The playbook pages' tools** (M45 D9): each page sees what is on it.
//
// A shared day reads the playbook on screen and holds the page's own two
// buttons as proposals: *add it to a trip, on a day* and *start a trip with
// it*. A list page (Discover, a city, a tag) reads its own list and nothing
// else. Which page gets which is the surface table's (`grants.ts`).
//
// The writes draft and commit nothing, like every write tool. A card carries
// the proposal, and Approve runs the button's own calls (`createTrip`,
// `insertSavedDay`), so the insert, its one history entry and the adds ledger
// are the button's.
//
// **The trip and the day are the person's to name** (D9: "The assistant
// never goes looking for a trip with room"). A trip is matched by the name
// they gave, among the trips they can open, and must be one they can edit
// (AGENTS.md invariant 7). With no name, or one that matches nothing or
// several, the tool answers with the question to ask rather than a guess.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Money, type AssistantProposal } from "@tc/contracts";
import { hasAtLeast } from "@/server/accessPolicy";
import { defineTool } from "@/server/assistant/defineTool";
import { untrusted, untrustedAll } from "@/server/assistant/prompt";
import type { PlaybookPageReads } from "@/server/assistant/deps";
import { tripsCalled } from "./navigate";

export const READ_PLAYBOOK_TOOL_NAME = "read_playbook";
export const ADD_PLAYBOOK_TO_TRIP_TOOL_NAME = "add_playbook_to_trip";
export const START_TRIP_WITH_PLAYBOOK_TOOL_NAME = "start_trip_with_playbook";
export const SEARCH_THIS_PAGE_TOOL_NAME = "search_this_page";

const PlaybookStopSchema = z.object({
  title: z.string(),
  start: z.string().nullable(),
  end: z.string().nullable(),
  place: z.string().nullable(),
  city: z.string().nullable(),
  costPerPerson: Money.nullable(),
  notes: z.string().nullable(),
});

const PlaybookReadoutSchema = z.object({
  name: z.string(),
  summary: z.string().nullable(),
  cities: z.array(z.string()),
  dayCount: z.number().int(),
  days: z.array(z.object({ day: z.number().int(), stops: z.array(PlaybookStopSchema) })),
});
export type PlaybookReadout = z.infer<typeof PlaybookReadoutSchema>;

/** The shared day `PlaybookPageReads` reads. */
type PageDay = NonNullable<Awaited<ReturnType<PlaybookPageReads["day"]>>>;

/** The playbook as the model reads it: each of its days, numbered from 1, with its stops in order. */
function readoutOf(saved: PageDay): PlaybookReadout {
  return {
    name: saved.name,
    summary: saved.summary,
    cities: saved.cities,
    dayCount: saved.dayCount,
    // Every day the playbook spans, an empty one included: a gap in
    // `dayIndex` is a day with nothing on it (ADR-048 decision 2).
    days: Array.from({ length: saved.dayCount }, (_, dayIndex) => ({
      day: dayIndex + 1,
      stops: saved.stops
        .filter((stop) => stop.dayIndex === dayIndex)
        .map((stop) => ({
          title: stop.title,
          start: stop.timeWindow?.start ?? null,
          end: stop.timeWindow?.end ?? null,
          place: stop.location?.name ?? null,
          city: stop.location?.city ?? null,
          costPerPerson: stop.cost,
          notes: stop.notes,
        })),
    })),
  };
}

/** What a playbook's author typed, fenced: the author is a stranger to the asker. */
function fenced(readout: PlaybookReadout): PlaybookReadout {
  return {
    ...readout,
    name: untrusted(readout.name),
    summary: readout.summary === null ? null : untrusted(readout.summary),
    cities: untrustedAll(readout.cities),
    days: readout.days.map((day) => ({
      ...day,
      stops: day.stops.map((stop) => ({
        ...stop,
        title: untrusted(stop.title),
        place: stop.place === null ? null : untrusted(stop.place),
        city: stop.city === null ? null : untrusted(stop.city),
        notes: stop.notes === null ? null : untrusted(stop.notes),
      })),
    })),
  };
}

export const readPlaybookTool = defineTool({
  name: READ_PLAYBOOK_TOOL_NAME,
  description:
    "The playbook on this page: its name, summary, cities, and each of its days with its stops in order — times (24-hour HH:mm), places, price per person in minor units, and notes. What the page shows, and the only thing to answer from.",
  domain: "playbook",
  effect: "read",
  spend: "none",
  input: z.object({}),
  output: z.union([PlaybookReadoutSchema, z.object({ error: z.string() })]),
  taint: (result) => ("error" in result ? result : fenced(result)),
  needs: ["playbookPage"] as const,
  minimumRole: "viewer",
  run: async (_input, deps) => {
    const saved = await deps.playbookPage.day();
    return saved === null ? { error: "This page has no playbook on it." } : readoutOf(saved);
  },
});

// Either the proposal is drafted, or the model is told what to ask or say.
const ProposeOutput = z.union([
  z.object({ queued: z.literal(true), note: z.string() }),
  z.object({ queued: z.literal(false), refused: z.string() }),
]);
type ProposeOutput = z.infer<typeof ProposeOutput>;

const QUEUED =
  "Drafted. Nothing has changed yet: a card under your answer asks them to approve it. Say what it will do, and that it is waiting for them.";

const AddPlaybookInput = z.object({
  trip: z
    .string()
    .describe("The trip as the person named it, word for word. Never choose one for them; if they named none, ask which trip."),
  day: z
    .number()
    .int()
    .min(1)
    .describe("The day of that trip they named, from 1. The playbook's first day lands on it. If they named no day, ask which."),
});

/** The sentence a card shows: what Approve will do, said before it is true. */
function addSentence(name: string, stopCount: number, tripName: string, day: number, appended: boolean): string {
  const stops = `${stopCount} stop${stopCount === 1 ? "" : "s"}`;
  return appended
    ? `Add “${name}” (${stops}) to ${tripName} as day ${day}`
    : `Add “${name}” (${stops}) to ${tripName} on day ${day}`;
}

export const addPlaybookToTripTool = defineTool({
  name: ADD_PLAYBOOK_TO_TRIP_TOOL_NAME,
  description:
    "Propose adding this page's playbook to one of the person's trips, starting on a day they named: its stops join that day, among the stops already there, and a playbook of several days runs on from it. Use it only when they have named both the trip and the day; otherwise ask them which. Never pick a trip yourself and never look for one with room. Like every change, this only DRAFTS: they approve it on a card.",
  domain: "playbook",
  effect: "propose",
  spend: "none",
  input: AddPlaybookInput,
  output: ProposeOutput,
  needs: ["playbookPage", "trips", "playbookProposal"] as const,
  // Editor on the trip they name, which `run` asks of that trip: the turn has
  // no trip of its own for admission to hold the role against.
  minimumRole: "editor",
  run: async (input, deps): Promise<ProposeOutput> => {
    const saved = await deps.playbookPage.day();
    if (saved === null) return { queued: false, refused: "This page has no playbook on it to add." };
    if (input.trip.trim() === "") {
      return { queued: false, refused: "They named no trip. Ask which of their trips to add it to, and on which day." };
    }
    const matches = tripsCalled(await deps.trips.load(), input.trip);
    if (matches.length !== 1) {
      const which = matches.length === 0 ? "no trip" : `${matches.length} trips`;
      return {
        queued: false,
        refused: `They have ${which} called “${input.trip}”. Ask which trip they mean; do not choose one for them.`,
      };
    }
    const trip = matches[0]!;
    // Invariant 7: the button would refuse a trip they cannot edit, so the
    // assistant does not draft one. The apply route asks again regardless.
    if (!hasAtLeast(deps.trips.userId, trip.members, "editor")) {
      return {
        queued: false,
        refused: `They can open ${trip.name} but not edit it, so nothing can be added to it. Say so, and do not offer another trip.`,
      };
    }
    const count = trip.days.length;
    if (input.day > count + 1) {
      return {
        queued: false,
        refused: `${trip.name} has ${count} day${count === 1 ? "" : "s"}. Ask for a day from 1 to ${count}, or ${count + 1} to add it at the end.`,
      };
    }
    // A day past the last appends, which is what the page's own button does.
    const startingAt = trip.days[input.day - 1]?.dayId;
    const proposal: AssistantProposal = {
      proposalId: randomUUID(),
      changes: [{ type: "AddDay", text: addSentence(saved.name, saved.stops.length, trip.name, input.day, startingAt === undefined) }],
      commands: [],
      inserts: [{ savedDayId: saved.savedDayId, name: saved.name }],
      skipped: [],
      target: { kind: "trip", tripId: trip.tripId, ...(startingAt === undefined ? {} : { startingAt }) },
    };
    deps.playbookProposal.set(proposal);
    return { queued: true, note: QUEUED };
  },
});

export const startTripWithPlaybookTool = defineTool({
  name: START_TRIP_WITH_PLAYBOOK_TOOL_NAME,
  description:
    "Propose starting a new trip with this page's playbook as its first day (or days), named after the playbook — the page's own Start a new trip. Use it when they ask to start, make or create a trip with it. Like every change, this only DRAFTS: they approve it on a card.",
  domain: "playbook",
  effect: "propose",
  spend: "none",
  input: z.object({}),
  output: ProposeOutput,
  needs: ["playbookPage", "playbookProposal"] as const,
  // Editor, as every write is; a new trip is theirs, so they are its owner.
  minimumRole: "editor",
  run: async (_input, deps): Promise<ProposeOutput> => {
    const saved = await deps.playbookPage.day();
    if (saved === null) return { queued: false, refused: "This page has no playbook on it to start a trip with." };
    const days = saved.dayCount === 1 ? "as day 1" : `as days 1–${saved.dayCount}`;
    deps.playbookProposal.set({
      proposalId: randomUUID(),
      changes: [{ type: "AddDay", text: `Start a trip called “${saved.name}” with this playbook ${days}` }],
      commands: [],
      inserts: [{ savedDayId: saved.savedDayId, name: saved.name }],
      skipped: [],
      target: { kind: "new-trip", name: saved.name },
    });
    return { queued: true, note: QUEUED };
  },
});

/** How many of a list page's days the model reads: the page's first page, as it is drawn. */
export const PAGE_LIST_LIMIT = 24;

const PageListReadoutSchema = z.object({
  days: z.array(
    z.object({
      name: z.string(),
      cities: z.array(z.string()),
      dayCount: z.number().int(),
      stopCount: z.number().int(),
      totalCost: Money.nullable(),
      adds: z.number().int(),
      rating: z.number().nullable(),
      description: z.string().nullable(),
    }),
  ),
});
type PageListReadout = z.infer<typeof PageListReadoutSchema>;

export const searchThisPageTool = defineTool({
  name: SEARCH_THIS_PAGE_TOOL_NAME,
  description:
    "The playbooks this page lists, as it ranks them — on a city or tag page only that city's or tag's: each one's name, cities, how many days and stops, its total cost for one person in minor units, how many trips have taken it, its rating and description. What the page shows, and the only thing to answer from.",
  domain: "playbookList",
  effect: "read",
  spend: "none",
  input: z.object({}),
  output: PageListReadoutSchema,
  taint: (readout: PageListReadout) => ({
    days: readout.days.map((day) => ({
      ...day,
      name: untrusted(day.name),
      cities: untrustedAll(day.cities),
      description: day.description === null ? null : untrusted(day.description),
    })),
  }),
  needs: ["playbookPage"] as const,
  minimumRole: "viewer",
  run: async (_input, deps) => ({
    days: (await deps.playbookPage.list()).slice(0, PAGE_LIST_LIMIT).map((day) => ({
      name: day.name,
      cities: day.cities,
      dayCount: day.dayCount,
      stopCount: day.stopCount,
      totalCost: day.totalCost,
      adds: day.adds,
      rating: day.rating,
      description: day.description,
    })),
  }),
});

export const PLAYBOOK_TOOLS = [readPlaybookTool, searchThisPageTool, addPlaybookToTripTool, startTripWithPlaybookTool] as const;
