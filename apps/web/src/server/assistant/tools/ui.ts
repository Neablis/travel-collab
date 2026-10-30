// **How a turn ends when prose alone would strand the person** (M56, ADR-084
// §2-§3): a closed question, cards to choose from, or a hand-off to where the
// task is done. The `ui` domain, granted on every surface with an assistant.
//
// None of the three changes anything. Each records the one widget the turn
// ends in (`UiOutcomeBuffer`), which rides out on the final chunk, and tells
// the model what is now on screen so its last sentence matches it. A second
// widget in the same turn is refused: a turn ends one way.
import { z } from "zod";
import { AskOption, AskOther, CarriedAsks, HandOffTo, MAX_OPTION_CARDS, NewTripPrefill, type AssistantOptionCard } from "@tc/contracts";
import { currentCallId } from "@/server/assistant/callScope";
import { defineTool } from "@/server/assistant/defineTool";
import { searchPlacesTool } from "@/server/assistant/tools/places";
import { searchPlaybooksTool } from "@/server/assistant/tools/read";

export const ASK_USER_TOOL_NAME = "ask_user";
export const SHOW_OPTIONS_TOOL_NAME = "show_options";
export const HAND_OFF_TOOL_NAME = "hand_off";

const UiOutput = z.union([
  z.object({ shown: z.literal(true), note: z.string() }),
  z.object({ shown: z.literal(false), refused: z.string() }),
]);
type UiOutput = z.infer<typeof UiOutput>;

const ALREADY = "This turn already ends in a question, cards or a hand-off. Say your last sentence instead.";
// A drafted change is the turn's outcome (`withUiOutcome`), so a widget after
// it would never render: refused here, so the last sentence does not point at it.
const DRAFTED = "This turn already drafts a change, on a card under your answer. Say your last sentence about that instead.";

// Where the id comes from when a call has none: a test calling `run` outside
// a tool call. A real turn always has one.
const callId = () => currentCallId() ?? "ask";

export const askUserTool = defineTool({
  name: ASK_USER_TOOL_NAME,
  description:
    "Ask the person a closed question when a few answers would settle what they want — instead of guessing, and instead of asking in prose. 2 to 6 options, each id a short lowercase word. `other` adds one constrained answer beside them: a place, a number between min and max, a date, or activity tags. Their answer arrives as their next message.",
  domain: "ui",
  effect: "steer",
  spend: "none",
  input: z.object({
    question: z.string().min(1).max(200),
    options: z.array(AskOption).min(2).max(6),
    multi: z.boolean().optional().describe("True when more than one option may be picked."),
    allowNone: z.boolean().optional(),
    other: AskOther.optional(),
  }),
  output: UiOutput,
  needs: ["uiOutcome"] as const,
  minimumRole: "viewer",
  run: (input, deps): UiOutput => {
    if (deps.uiOutcome.drafting()) return { shown: false, refused: DRAFTED };
    const ask = { id: callId(), question: input.question, options: input.options, multi: input.multi ?? false, allowNone: input.allowNone ?? false, ...(input.other && { other: input.other }) };
    if (!deps.uiOutcome.set({ ask })) return { shown: false, refused: ALREADY };
    return { shown: true, note: "The question and its choices are under your answer. Do not repeat them; say nothing more than a short lead-in, and wait for their answer." };
  },
});

export const showOptionsTool = defineTool({
  name: SHOW_OPTIONS_TOOL_NAME,
  description:
    `Show the person cards to choose from: places by the \`ref\` numbers search_places gave them, or published days by the savedDayIds search_playbooks returned, in the order you would suggest, at most ${MAX_OPTION_CARDS}: your best, not every match. One card is shown as a yes or no about it, so make \`prompt\` that question ("Add Cochon?"). The server fills each card's name and details from those results; anything no tool returned this turn is dropped.`,
  domain: "ui",
  effect: "steer",
  spend: "none",
  input: z
    .object({
      prompt: z.string().min(1).max(200).describe("The line above the cards."),
      // Over the limit is cut to the first few by `repairToolInput`, not
      // refused: the model's order is its suggestion, so those are its best.
      places: z.array(z.number().int().positive()).min(1).max(MAX_OPTION_CARDS).optional(),
      days: z.array(z.string().min(1)).min(1).max(MAX_OPTION_CARDS).optional(),
    })
    .refine((input) => (input.places === undefined) !== (input.days === undefined), "Pass places or days, not both."),
  output: UiOutput,
  needs: ["uiOutcome", "placeCache"] as const,
  minimumRole: "viewer",
  fedBy: [searchPlacesTool.name, searchPlaybooksTool.name],
  run: (input, deps): UiOutput => {
    if (deps.uiOutcome.drafting()) return { shown: false, refused: DRAFTED };
    const cards: AssistantOptionCard[] = [];
    const dropped: string[] = [];
    for (const ref of input.places ?? []) {
      const place = deps.placeCache.get(ref);
      if (place === null) dropped.push(`place ${ref}`);
      // A city or district is named by itself; the line under it repeating that says nothing.
      else cards.push({ kind: "place", id: `place-${ref}`, name: place.name, ...(place.area && place.area !== place.name && { area: place.area }), ...(place.city && place.city !== place.name && { city: place.city }) });
    }
    for (const savedDayId of input.days ?? []) {
      const day = deps.uiOutcome.day(savedDayId);
      if (day === null) dropped.push(`day ${savedDayId}`);
      else cards.push({ kind: "day", id: day.savedDayId, name: day.name, cities: day.cities, stopCount: day.stopCount });
    }
    if (cards.length === 0) return { shown: false, refused: "No tool returned any of those this turn. Search first, then show what it found." };
    // One card is drawn as a yes or no, so a prompt written for several
    // ("Pick a day") would ask nothing once the others were dropped. A name too
    // long for the contract's 200 keeps the model's prompt.
    const asked = `How about ${cards[0]!.name}?`;
    const prompt = cards.length === 1 && dropped.length > 0 && asked.length <= 200 ? asked : input.prompt;
    if (!deps.uiOutcome.set({ options: { id: callId(), prompt, cards } })) return { shown: false, refused: ALREADY };
    // Named, since a fifth was cut before this ran (`repairToolInput`): the
    // last sentence must not point at a card that is not there.
    const notes = [`The cards are under your answer. Do not list them again; say one short sentence about why these. Shown: ${cards.map((card) => card.name).join(", ")}.`];
    if (dropped.length > 0) notes.push(`Left out, since no tool returned them: ${dropped.join(", ")}.`);
    if (prompt !== input.prompt) notes.push(`With one left, it is asked as "${prompt}" with Yes and No.`);
    return { shown: true, note: notes.join(" ") };
  },
});

export const handOffTool = defineTool({
  name: HAND_OFF_TOOL_NAME,
  description:
    "The only way to decline a task you understood: say where it is done, and a button there is shown under your answer. `to` is one of the targets your instructions name for this page. `task` is what they asked, in a few plain words. `trip` names one of their trips, as they said it, for plan_page from a page that is about no trip. For new_trip: `prefill` is what they said of the place (their words; they pick the result), length and tags, and `asks` each part only the trip can do, in their words, left there for them to press.",
  domain: "ui",
  effect: "steer",
  spend: "none",
  input: z.object({
    task: z.string().min(1).max(200),
    to: HandOffTo,
    trip: z.string().min(1).max(200).optional(),
    prefill: NewTripPrefill.optional(),
    asks: CarriedAsks.optional(),
  }),
  output: UiOutput,
  needs: ["uiOutcome"] as const,
  minimumRole: "viewer",
  run: async (input, deps): Promise<UiOutput> => {
    if (deps.uiOutcome.drafting()) return { shown: false, refused: DRAFTED };
    if (!deps.uiOutcome.targets.includes(input.to)) {
      return { shown: false, refused: `From here, hand off only to ${deps.uiOutcome.targets.join(", ")}.` };
    }
    let command: string | undefined;
    if (input.to === "plan_page") {
      const found = await deps.uiOutcome.planPage(input.trip);
      if ("refused" in found) return { shown: false, refused: found.refused };
      command = found.command;
    }
    // Only New trip has a picker to fill and a trip to carry asks into.
    const carried = input.to === "new_trip" ? { ...(input.prefill && { prefill: input.prefill }), ...(input.asks && { asks: input.asks }) } : {};
    if (!deps.uiOutcome.set({ handOff: { task: input.task, to: input.to, ...(command !== undefined && { command }), ...carried } })) {
      return { shown: false, refused: ALREADY };
    }
    return {
      shown: true,
      note:
        input.to === "nowhere"
          ? "Say in one short sentence that this is not something this app can do."
          : "The button is under your answer. Say in one short sentence why it is done there.",
    };
  },
});

export const UI_TOOLS = [askUserTool, showOptionsTool, handOffTool] as const;
