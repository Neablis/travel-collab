import { describe, expect, it } from "vitest";
import { tripDetailFactory } from "@tc/factories";
import { newNotebookRefs, newPaletteCommandBuffer } from "@/server/assistant/deps";
import type { AskScope } from "@/server/assistant/context";
import { goToTool, proposeNotebookEditingTool } from "./navigate";

// ADR-072: the assistant moves you around by naming palette commands. What is
// tested here is what only the server can get wrong: which ids it will queue at
// all, and that the model's words (a view, a day number, a title) become the
// ids the page registered, never a URL.

const PAGE_ID = "44444444-4444-4444-8444-444444444444";
const built = tripDetailFactory.build({}, { transient: { dayCount: 2, activitiesPerDay: 1, unscheduledCount: 1 } });
// The factory reuses titles, so the parked stop gets one of its own to be named by.
const PARKED = built.backlog[0]!;
const trip = { ...built, activities: { ...built.activities, [PARKED]: { ...built.activities[PARKED]!, title: "Onsen" } } };
const notebooks = () =>
  newNotebookRefs(async () => [{ id: PAGE_ID, title: "Packing list", firstLine: null }], null);

function goTo(input: Parameters<typeof goToTool.run>[0], scope: AskScope = { kind: "trip" }) {
  const paletteCommands = newPaletteCommandBuffer();
  return Promise.resolve(goToTool.run(input, { trip, scope, notebooks: notebooks(), paletteCommands })).then((result) => ({
    result,
    queued: paletteCommands.collected().map((ref) => ref.id),
  }));
}

// §3: the allowlist is the server's, by whole id. Palette ids are not
// namespaced, so `people` is on it and its siblings in the same menu are not
// (survey risk 4), and nothing shaped like a URL is.
describe("the commands a turn may queue", () => {
  it.each(["people", "notebook-editing", "view:Map", `go:day:${trip.days[0]!.dayId}`, `go:trip:${trip.tripId}:view:Map`])(
    "queues %s",
    (id) => {
      const buffer = newPaletteCommandBuffer();
      expect(buffer.add({ id, needsApproval: false })).toBe(true);
      expect(buffer.collected().map((ref) => ref.id)).toEqual([id]);
    },
  );

  it.each(["settings", "share", "cover", "undo", "new-stop", "go:home", "view:Board", `go:trip:${trip.tripId}:share`, "https://example.com/"])(
    "refuses %s, and queues nothing",
    (id) => {
      const buffer = newPaletteCommandBuffer();
      expect(buffer.add({ id, needsApproval: false })).toBe(false);
      expect(buffer.collected()).toEqual([]);
    },
  );

  it("queues an id once, however often a turn names it", () => {
    const buffer = newPaletteCommandBuffer();
    buffer.add({ id: "view:Map", needsApproval: false });
    buffer.add({ id: "view:Map", needsApproval: false });
    expect(buffer.collected()).toEqual([{ id: "view:Map", needsApproval: false }]);
  });
});

describe("go_to", () => {
  it("names the lens on a trip turn, and the trip on that view from a notebook", async () => {
    expect((await goTo({ view: "Map" })).queued).toEqual(["view:Map"]);
    expect((await goTo({ view: "Map" }, { kind: "page", pageId: PAGE_ID })).queued).toEqual([`go:trip:${trip.tripId}:view:Map`]);
  });

  it("names a day by its number, a stop by its title, a notebook by its title, and People", async () => {
    const [first] = trip.days;
    const stopId = first!.activityIds[0]!;
    const stop = trip.activities[stopId]!;
    expect((await goTo({ view: "Map", day: 1 })).queued).toEqual(["view:Map", `go:day:${first!.dayId}`]);
    expect((await goTo({ stop: stop.title.toUpperCase() })).queued).toEqual([`go:stop:${stopId}`]);
    expect((await goTo({ notebook: "packing" })).queued).toEqual([`go:notebook:${PAGE_ID}`]);
    expect((await goTo({ people: true })).queued).toEqual(["people"]);
  });

  // All or nothing: half a destination is a page the person did not ask for.
  it.each([
    [{ view: "Map" as const, day: 9 }, /day 9/],
    [{ stop: "Nowhere at all" }, /Nowhere at all/],
    [{ notebook: "Budget" }, /Budget/],
    [{}, /where/],
    // The board offers no Go to for a parked stop (`goToStopCommands`).
    [{ stop: "Onsen" }, /on no day/],
  ])("refuses %j, and queues nothing", async (input, said) => {
    const { result, queued } = await goTo(input);
    expect(result).toEqual({ queued: false, refused: expect.stringMatching(said) });
    expect(queued).toEqual([]);
  });

  // A notebook page registers none of the board's day, stop, notebook or
  // People commands, so from there only the trip on a view is somewhere to go.
  it.each([{ day: 1 }, { stop: trip.activities[trip.days[0]!.activityIds[0]!]!.title }, { notebook: "packing" }, { people: true as const }, { view: "Map" as const, day: 1 }])(
    "refuses %j from a notebook, and queues nothing",
    async (input) => {
      const { result, queued } = await goTo(input, { kind: "page", pageId: PAGE_ID });
      expect(result).toEqual({ queued: false, refused: expect.stringMatching(/From a notebook/) });
      expect(queued).toEqual([]);
    },
  );
});

describe("propose_notebook_editing", () => {
  // The toggle has no direction of its own, so the ref carries the one asked
  // for, and a card can say so when the page is already there.
  it.each([true, false])("queues the editing toggle to wait for Approve, turning it on: %s, on a notebook turn only", async (on) => {
    const paletteCommands = newPaletteCommandBuffer();
    const result = await proposeNotebookEditingTool.run({ on }, { scope: { kind: "page", pageId: PAGE_ID }, paletteCommands });
    expect(result.queued).toBe(true);
    expect(paletteCommands.collected()).toEqual([{ id: "notebook-editing", needsApproval: true, on }]);

    const offPage = newPaletteCommandBuffer();
    expect((await proposeNotebookEditingTool.run({ on }, { scope: { kind: "trip" }, paletteCommands: offPage })).queued).toBe(false);
    expect(offPage.collected()).toEqual([]);
  });

  // A change asks (§4): it collects for a person's Approve, so it is never on
  // a viewer's turn, and only the page surface, which grants `pages`, has it.
  it("is a proposal in the pages domain, for an editor", () => {
    expect(proposeNotebookEditingTool.domain).toBe("pages");
    expect(proposeNotebookEditingTool.effect).toBe("propose");
    expect(proposeNotebookEditingTool.minimumRole).toBe("editor");
  });
});
