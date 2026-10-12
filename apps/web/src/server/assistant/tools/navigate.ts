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
import type { AskScope } from "@/server/assistant/context";
import type { NotebookRefs } from "@/server/assistant/deps";
import { defineTool } from "@/server/assistant/defineTool";

export const GO_TO_TOOL_NAME = "go_to";
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

/** A stop by its title, as `batchResolver` reads an `activityRef`: whole, ignoring case. */
function stopId(trip: TripDetail, title: string): Resolved {
  const key = title.trim().toLowerCase();
  const matches = Object.entries(trip.activities).filter(([, activity]) => activity.title.trim().toLowerCase() === key);
  if (matches.length === 1) return { id: `go:stop:${matches[0]![0]}` };
  if (matches.length === 0) return { refused: `No stop is called “${title}”. Use its exact title as read_day shows it.` };
  return { refused: `“${title}” names ${matches.length} stops. Go to its day instead.` };
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
  const found: Resolved[] = [];
  // A notebook page has no lenses of its own, so a view from there is the
  // trip on that view: one unlisted command, not a chain (§6).
  if (input.view !== undefined) {
    found.push({ id: scope.kind === "page" ? `go:trip:${trip.tripId}:view:${input.view}` : `view:${input.view}` });
  }
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
 * the only one, and the account surface (part 4) is where another is named.
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
  input: z.object({}),
  output: NavigateOutput,
  needs: ["scope", "paletteCommands"] as const,
  minimumRole: "editor",
  run: (_input, deps): NavigateOutput => {
    if (deps.scope.kind !== "page") return { queued: false, refused: "Only a notebook has editing to turn on." };
    deps.paletteCommands.add({ id: "notebook-editing", needsApproval: true });
    return { queued: true, note: "A card asks them to approve it. Say that it is waiting for them." };
  },
});

export const NAVIGATION_TOOLS = [goToTool, proposeNotebookEditingTool] as const;
