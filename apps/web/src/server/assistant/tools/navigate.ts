// **The assistant takes you places by naming palette commands** (M45 D4, D5;
// ADR-072).
//
// Two tools, and neither does anything itself. Each turns what the model said
// (a view, a day's number, a stop's or a notebook's title) into the id of a
// command the page registers for ⌘K, and queues it for the turn's final chunk.
// The page looks the id up among its own commands and runs that command's
// `run` (`components/assistant/runPaletteCommands.ts`), so what the assistant
// does is what a person does from ⌘K, and never a URL (§1).
//
// `go_to` is navigation, which runs when the reply arrives; turning a
// notebook's editing on is a change, which waits for Approve (§4).
import { z } from "zod";
import { TRIP_VIEWS, type TripDetail } from "@tc/contracts";
import { travelledTrips } from "@tc/domain";
import type { AskScope } from "@/server/assistant/context";
import type { NotebookRefs } from "@/server/assistant/deps";
import { defineTool } from "@/server/assistant/defineTool";

export const GO_TO_TOOL_NAME = "go_to";
export const OPEN_TRIP_TOOL_NAME = "open_trip";
export const PROPOSE_NOTEBOOK_EDITING_TOOL_NAME = "propose_notebook_editing";

const GoToInput = z.object({
  view: z.enum(TRIP_VIEWS).optional(),
  day: z.number().int().optional().describe("1-based."),
  stop: z.string().min(1).optional().describe("Its exact title."),
  notebook: z.string().min(1).optional().describe("Its title."),
  people: z.literal(true).optional(),
});

const NavigateOutput = z.union([
  z.object({ queued: z.literal(true), note: z.string() }),
  z.object({ queued: z.literal(false), refused: z.string() }),
]);
type NavigateOutput = z.infer<typeof NavigateOutput>;

type Resolved = { id: string } | { refused: string };

/**
 * A stop by its title, as `batchResolver` reads an `activityRef`: whole,
 * ignoring case. Only a stop on a day: the board offers no Go to for a parked
 * one (`goToStopCommands`), so naming it would end on "couldn't from this page".
 */
function stopId(trip: TripDetail, title: string): Resolved {
  const key = title.trim().toLowerCase();
  const matches = Object.entries(trip.activities).filter(([, activity]) => activity.title.trim().toLowerCase() === key);
  if (matches.length > 1) return { refused: `“${title}” names ${matches.length} stops. Go to its day instead.` };
  const [activityId] = matches[0] ?? [];
  if (activityId === undefined) return { refused: `No stop is called “${title}”. Use its exact title as read_day shows it.` };
  if (!trip.days.some((day) => day.activityIds.includes(activityId))) return { refused: `“${title}” is on no day, so there is nowhere on the board to go to it.` };
  return { id: `go:stop:${activityId}` };
}

/**
 * A notebook by its title: the one whose title it is, or else the only one
 * whose title holds it. Never says the titles back: they are a person's text,
 * and the model has no use for a list to guess from.
 */
async function notebookId(notebooks: NotebookRefs, title: string): Promise<Resolved> {
  const key = title.trim().toLowerCase();
  const listed = await notebooks.list();
  const exact = listed.filter((entry) => entry.title.trim().toLowerCase() === key);
  const matches = exact.length > 0 ? exact : listed.filter((entry) => entry.title.toLowerCase().includes(key));
  const pageId = matches.length === 1 ? notebooks.pageIdOf(matches[0]!.notebook) : null;
  if (pageId !== null) return { id: `go:notebook:${pageId}` };
  return { refused: `This trip has ${matches.length === 0 ? "no notebook" : "more than one notebook"} called “${title}”.` };
}

/** Every destination the input names, in the order the page should go: the view first. */
async function destinations(
  input: z.infer<typeof GoToInput>,
  trip: TripDetail,
  scope: AskScope,
  notebooks: NotebookRefs,
): Promise<Resolved[]> {
  // A notebook page has no lenses of its own, so a view from there is the
  // trip on that view: one unlisted command, not a chain (§6). It registers
  // none of the board's day, stop, notebook or People commands either, so
  // those are refused here rather than queued to fail on arrival.
  if (scope.kind === "page") {
    const offBoard = input.day !== undefined || input.stop !== undefined || input.notebook !== undefined || input.people === true;
    if (offBoard) return [{ refused: `From a notebook I can only open the trip on a view (${TRIP_VIEWS.join(", ")}).` }];
    return input.view === undefined ? [] : [{ id: `go:trip:${trip.tripId}:view:${input.view}` }];
  }
  const found: Resolved[] = [];
  if (input.view !== undefined) found.push({ id: `view:${input.view}` });
  if (input.day !== undefined) {
    const day = trip.days[input.day - 1];
    found.push(day === undefined ? { refused: `There is no day ${input.day}: this trip has ${trip.days.length}.` } : { id: `go:day:${day.dayId}` });
  }
  if (input.stop !== undefined) found.push(stopId(trip, input.stop));
  if (input.notebook !== undefined) found.push(await notebookId(notebooks, input.notebook));
  if (input.people === true) found.push({ id: "people" });
  return found;
}

const QUEUED_NOTE =
  "The page goes there when your answer arrives, if it offers that destination. Say where you are taking them in one short sentence.";

/**
 * **`itinerary` and `read`: offered wherever the trip is read**, and only to
 * someone who may edit it. A viewer's turn holds `read_trip` and `read_day`
 * alone (ADR-058 decision 9), and this does not reopen that; they still have
 * ⌘K. Availability is the page's either way (§5): the page runs only what it
 * registered for this person. No trip is chosen here: the turn's own trip is
 * the only one, and `open_trip` is where the account surface names another.
 */
export const goToTool = defineTool({
  name: GO_TO_TOOL_NAME,
  description:
    "Take the person to a view, day, stop, notebook or People in this trip, when they ask to see, show, open or go to it.",
  domain: "itinerary",
  effect: "read",
  spend: "none",
  input: GoToInput,
  output: NavigateOutput,
  needs: ["trip", "scope", "notebooks", "paletteCommands"] as const,
  minimumRole: "viewer",
  onReadOnlyTurns: false,
  // Our sentences, and the model's own words quoted back: no person's text.
  run: async (input, deps): Promise<NavigateOutput> => {
    const found = await destinations(input, deps.trip, deps.scope, deps.notebooks);
    if (found.length === 0) return { queued: false, refused: "Say where to go: a view, a day, a stop, a notebook or People." };
    // All or nothing: half a destination is a page they did not ask for.
    const refused = found.flatMap((entry) => ("refused" in entry ? [entry.refused] : []));
    if (refused.length > 0) return { queued: false, refused: refused.join(" ") };
    for (const entry of found) {
      if ("id" in entry && !deps.paletteCommands.add({ id: entry.id, needsApproval: false })) {
        return { queued: false, refused: "That is not somewhere I can take them." };
      }
    }
    return { queued: true, note: QUEUED_NOTE };
  },
});

/**
 * **A change, so it asks** (§4): the card's Approve runs the notebook's own
 * *Edit › Notebook* toggle, and nothing changes before it. `pages`/`propose`,
 * so it is on a notebook turn only (the one surface that grants `pages`) and
 * never on a viewer's, and the page withholds the toggle from anyone who may
 * not edit (§5) as its toolbar does.
 */
export const proposeNotebookEditingTool = defineTool({
  name: PROPOSE_NOTEBOOK_EDITING_TOOL_NAME,
  description:
    "Ask to turn this notebook's editing on or off. The person sees a card and approves it; nothing changes until they do, so never say it is done.",
  domain: "pages",
  effect: "propose",
  spend: "none",
  // The page's toggle has no direction, and only the page knows whether it
  // is editing, so the direction asked for rides on the ref and the card
  // says so when the page is already there (ADR-072 §4).
  input: z.object({ on: z.boolean().describe("true to turn editing on, false to turn it off.") }),
  output: NavigateOutput,
  needs: ["scope", "paletteCommands"] as const,
  minimumRole: "editor",
  run: (input, deps): NavigateOutput => {
    if (deps.scope.kind !== "page") return { queued: false, refused: "Only a notebook has editing to turn on." };
    deps.paletteCommands.add({ id: "notebook-editing", needsApproval: true, on: input.on });
    return { queued: true, note: "A card asks them to approve it. Say that it is waiting for them." };
  },
});

const OpenTripInput = z.object({
  trip: z.string().min(1).describe("Its name, or the part of it they said."),
  view: z.enum(TRIP_VIEWS).optional(),
});

/**
 * Lower case, "&" read as "and", and every run of punctuation and spaces one
 * space: "Kyoto & Osaka, 2026!" is "kyoto and osaka 2026". Combining marks
 * are kept, composed (NFC), because in many scripts they are what tells two
 * words apart.
 */
function wordsOf(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .trim();
}

/**
 * The trips a person meant by `name`, as they said it: "Kyoto", "my Kyoto
 * trip" and "the Kyoto trip." all find a trip named "Kyoto". Shared by every
 * tool that takes a trip by the name a person gave (`open_trip`, and the
 * playbook pages' `add_playbook_to_trip`), whose descriptions tell the model
 * to pass those words as said, so both read them the same way.
 *
 * Case, punctuation, spacing and "&" for "and" never count. First the trips
 * called exactly what was typed, then what follows a leading "my" or "the"
 * ("my Road trip" is "Road trip", not "Road"), then that without a trailing
 * "trip", then every trip whose name holds what is left. A trip is never
 * found because its name is one of the words typed: "Kyoto trip from Tokyo"
 * names some other trip, not "Tokyo". More than one is for the caller to ask
 * about, never to choose between.
 */
export function tripsCalled<T extends { name: string }>(trips: readonly T[], name: string): T[] {
  const typed = wordsOf(name);
  if (typed === "") return [];
  const bare = typed.replace(/^(?:my|the) /, "");
  const key = bare.replace(/(?:^| )trip$/, "").trim();
  const named = trips.map((trip) => ({ trip, words: wordsOf(trip.name) }));
  // "my trip" leaves no key, and every name holds the empty string.
  const tiers = [
    (words: string) => words === typed,
    (words: string) => words === bare,
    (words: string) => key !== "" && words === key,
    (words: string) => key !== "" && words.includes(key),
  ];
  for (const fits of tiers) {
    const found = named.filter(({ words }) => fits(words));
    if (found.length > 0) return found.map(({ trip }) => trip);
  }
  return [];
}

/**
 * **`go_to` for the account surface** (M45 D6, ADR-072 §6): from Home there is
 * no one trip, so the person names one. Only a trip they are travelling on,
 * the same set every account tool reads (`travelledTrips`, D2): a trip they can
 * open but are not going on is refused like one they cannot open, so the
 * assistant never takes anyone further than its answers reach (AGENTS.md
 * invariant 7). The id it queues is Home's own ⌘K command for that trip
 * (`placeCommands`), which Home registers only for trips it lists.
 *
 * Matched by `tripsCalled`, as `add_playbook_to_trip` matches: the trip whose
 * name it is, or else the only one the words fit. Never says the names back:
 * they are typed by people, often not by the asker.
 */
export const openTripTool = defineTool({
  name: OPEN_TRIP_TOOL_NAME,
  description:
    "Open one of the user's trips, on a view if they name one, when they ask to see, show, open or go to it. Name the trip as they did.",
  domain: "account",
  effect: "read",
  spend: "none",
  input: OpenTripInput,
  output: NavigateOutput,
  needs: ["trips", "paletteCommands"] as const,
  minimumRole: "viewer",
  // No `onReadOnlyTurns: false`: every account turn is read-only (it is about
  // no trip a role could be held on), so the tag would take it off the one
  // surface it is for. It changes nothing and spends nothing.
  run: async (input, deps): Promise<NavigateOutput> => {
    const matches = tripsCalled(travelledTrips(await deps.trips.load(), deps.trips.userId), input.trip);
    if (matches.length !== 1) {
      const which = matches.length === 0 ? "no trip" : "more than one trip";
      return { queued: false, refused: `You are travelling on ${which} called “${input.trip}”.` };
    }
    const { tripId } = matches[0]!;
    const id = input.view === undefined ? `go:trip:${tripId}` : `go:trip:${tripId}:view:${input.view}`;
    if (!deps.paletteCommands.add({ id, needsApproval: false })) return { queued: false, refused: "That is not somewhere I can take them." };
    return { queued: true, note: QUEUED_NOTE };
  },
});

export const NAVIGATION_TOOLS = [goToTool, proposeNotebookEditingTool, openTripTool] as const;
