import { describe, expect, it } from "vitest";
import type { SavedDay, TripDetail } from "@tc/contracts";
import { tripDetailFactory } from "@tc/factories";
import {
  newAccountTrips,
  newNotebookRefs,
  newPaletteCommandBuffer,
  newPlaybookProposalBuffer,
  type PlaybookPageReads,
} from "@/server/assistant/deps";
import type { AskScope } from "@/server/assistant/context";
import { goToTool, openTripTool, proposeNotebookEditingTool, tripsCalled } from "./navigate";
import { addPlaybookToTripTool } from "./playbook";

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

// Both tools that take a trip by name pass the person's words through
// `tripsCalled`, and the model passes them as said: the live eval at 940df19
// sent "Kyoto trip" for a trip named "Kyoto", and the old contains-only match
// refused it.
describe("tripsCalled", () => {
  const named = (...names: string[]) => names.map((name) => ({ name }));
  const KYOTO = named("Kyoto", "Osaka 2026");

  it.each(["Kyoto", "kyoto", "  KYOTO ", "Kyoto trip", "my Kyoto trip", "the Kyoto trip", "My kyoto trip."])(
    "finds the trip named Kyoto from %j",
    (typed) => {
      expect(tripsCalled(KYOTO, typed)).toEqual([{ name: "Kyoto" }]);
    },
  );

  it("still finds a trip from whole words of its name, and prefers the exact name", () => {
    expect(tripsCalled(named("Kyoto 2026", "Osaka"), "my Kyoto trip")).toEqual([{ name: "Kyoto 2026" }]);
    expect(tripsCalled(named("Kyoto", "Kyoto 2026"), "my Kyoto trip")).toEqual([{ name: "Kyoto" }]);
    // A trip whose name ends in "trip" is still found by its whole name.
    expect(tripsCalled(named("Road trip", "Road"), "Road trip")).toEqual([{ name: "Road trip" }]);
    expect(tripsCalled(named("My trip", "Kyoto"), "my trip")).toEqual([{ name: "My trip" }]);
  });

  // The model passes the name word for word, so the article usually comes with it.
  it.each([
    [["Road trip", "Road"], "my Road trip", "Road trip"],
    [["Japan trip", "Japan"], "my Japan trip", "Japan trip"],
  ])("from %j, prefers the trip named what follows the article in %j", (names, typed, meant) => {
    expect(tripsCalled(named(...names), typed)).toEqual([{ name: meant }]);
  });

  it.each([
    [["Kyoto & Osaka", "Osaka"], "my Kyoto and Osaka trip", "Kyoto & Osaka"],
    [["Rome and Paris", "Paris"], "Rome & Paris", "Rome and Paris"],
  ])("from %j, reads \"&\" and \"and\" in %j as the same word", (names, typed, meant) => {
    expect(tripsCalled(named(...names), typed)).toEqual([{ name: meant }]);
  });

  it("keeps combining marks, so different words in other scripts stay different", () => {
    expect(tripsCalled(named("दिल"), "देला")).toEqual([]);
  });

  it("finds a name typed decomposed, as the same name composed", () => {
    expect(tripsCalled(named("Café"), "Cafe\u0301")).toEqual([{ name: "Café" }]);
  });

  it.each(["Kyoto", "my Kyoto trip"])("returns every candidate %j fits when it fits more than one, so the tool asks", (typed) => {
    expect(tripsCalled(named("Kyoto spring", "Kyoto autumn"), typed)).toHaveLength(2);
  });

  it.each(["Rome", "my trip", "the trip", "", "Kyoto and Nara"])("finds nothing from %j", (typed) => {
    expect(tripsCalled(KYOTO, typed)).toEqual([]);
  });

  // Part of a word is not a name: "India" is not short for "Indiana". Once
  // "my" and "trip" are stripped, a match inside a word would act on a trip
  // the person never named, so it refuses and the assistant asks.
  it.each([
    [["Indiana"], "the India trip"],
    [["Venice"], "my Nice trip"],
    [["Venice"], "Nice"],
    [["Romeo's wedding", "Kyoto"], "my Rome trip"],
    [["Oman"], "the Oma trip"],
    [["Kyoto 2026", "Osaka"], "Kyo"],
  ])("from %j, picks no trip whose name only holds %j inside a word", (names, typed) => {
    expect(tripsCalled(named(...names), typed)).toEqual([]);
  });

  // A trip whose whole name is one word of what was typed is not the one
  // meant: the person was naming a different trip the matcher cannot see.
  it.each([
    [["Tokyo", "Kyoto & Nara"], "Kyoto trip from Tokyo"],
    [["Rome + Paris", "Paris"], "the Rome and Paris trip"],
  ])("from %j, picks no trip because its name is one of the words in %j", (names, typed) => {
    expect(tripsCalled(named(...names), typed)).toEqual([]);
  });

  // A later word of a name is not the name: "York" is not "New York", and a
  // match there acts on a different place. Only the leading words fit, so
  // "Kyoto" still finds "Kyoto 2026", and "Summer in Kyoto" costs a question.
  it.each([
    [["New York"], "my York trip"],
    [["West Virginia"], "the Virginia trip"],
    [["New Jersey"], "my Jersey trip"],
    [["Winston-Salem"], "my Salem trip"],
    [["Papua New Guinea"], "the Guinea trip"],
    [["South Sudan"], "the Sudan trip"],
    [["New South Wales"], "my Wales trip"],
    [["New Orleans"], "the Orleans trip"],
    [["Stratford-upon-Avon"], "the Avon trip"],
    [["Summer in Kyoto"], "Kyoto"],
    [["Dad's 60th in Rome"], "Rome"],
  ])("from %j, picks no trip whose name holds %j only after its first word", (names, typed) => {
    expect(tripsCalled(named(...names), typed)).toEqual([]);
  });

  it.each([
    [["Kyoto 2026", "Summer in Kyoto"], "Kyoto", "Kyoto 2026"],
    [["Kyoto in spring", "Osaka"], "my Kyoto trip", "Kyoto in spring"],
    // "Washington" leads the name, so this is the trip meant, not a refusal.
    [["Washington DC"], "my Washington trip", "Washington DC"],
  ])("from %j, finds the trip whose name starts with %j", (names, typed, meant) => {
    expect(tripsCalled(named(...names), typed)).toEqual([{ name: meant }]);
  });

  // A name's own leading "The" or "My", and its trailing "trip", are read off
  // as the typed words' are, or "Bahamas" would need "The" typed to be found.
  it.each([
    [["The Bahamas", "Kyoto"], "Bahamas", "The Bahamas"],
    [["The Bahamas", "Kyoto"], "the Bahamas trip", "The Bahamas"],
    [["The Hague 2026", "Kyoto"], "the Hague trip", "The Hague 2026"],
    [["My Kyoto trip", "Osaka"], "Kyoto", "My Kyoto trip"],
    [["My Kyoto trip", "Osaka"], "the Kyoto trip", "My Kyoto trip"],
  ])("from %j, finds the trip named with an article from %j", (names, typed, meant) => {
    expect(tripsCalled(named(...names), typed)).toEqual([{ name: meant }]);
  });
});

describe("a trip named by the person's own words", () => {
  const ASKER = "kyoto-asker";
  const kyoto: TripDetail = tripDetailFactory.build(
    { name: "Kyoto", members: [{ userId: ASKER, role: "owner", travelling: true }] },
    { transient: { dayCount: 3, activitiesPerDay: 1 } },
  );
  const trips = () => newAccountTrips(ASKER, async () => [kyoto]);

  it("open_trip opens it from \"Kyoto trip\"", async () => {
    const paletteCommands = newPaletteCommandBuffer();
    const result = await openTripTool.run({ trip: "Kyoto trip", view: "Map" }, { trips: trips(), paletteCommands });
    expect(result).toEqual({ queued: true, note: expect.any(String) });
    expect(paletteCommands.collected().map((ref) => ref.id)).toEqual([`go:trip:${kyoto.tripId}:view:Map`]);
  });

  // They named "Kyoto", which they can open but are not travelling on. It is
  // refused as theirs is, not swapped for the "Kyoto 2026" they are going on.
  it("open_trip refuses a named trip they are not travelling on, rather than open its neighbour", async () => {
    const notGoing = { ...kyoto, members: [{ userId: ASKER, role: "owner" as const, travelling: false }] };
    const kyoto2026: TripDetail = tripDetailFactory.build(
      { name: "Kyoto 2026", members: [{ userId: ASKER, role: "owner", travelling: true }] },
      { transient: { dayCount: 1, activitiesPerDay: 1 } },
    );
    const paletteCommands = newPaletteCommandBuffer();
    const result = await openTripTool.run(
      { trip: "my Kyoto trip" },
      { trips: newAccountTrips(ASKER, async () => [notGoing, kyoto2026]), paletteCommands },
    );
    expect(result).toEqual({ queued: false, refused: "You are travelling on no trip called “my Kyoto trip”." });
    expect(paletteCommands.collected()).toEqual([]);
  });

  // Refused whenever the words fit more than one trip, and the reason given is
  // true: the person is asked which, and their answer must not then be "no trip".
  it.each([
    [false, false, "You are travelling on no trip called “Kyoto”."],
    [false, true, "“Kyoto” fits more than one of your trips, and you are travelling on only one of them."],
    [true, true, "You are travelling on more than one trip called “Kyoto”."],
  ])("open_trip, with two Kyoto trips travelled on %j and %j, refuses: %s", async (springGoing, autumnGoing, refused) => {
    const kyotoTrip = (name: string, travelling: boolean): TripDetail =>
      tripDetailFactory.build({ name, members: [{ userId: ASKER, role: "owner", travelling }] }, { transient: { dayCount: 1, activitiesPerDay: 1 } });
    const paletteCommands = newPaletteCommandBuffer();
    const result = await openTripTool.run(
      { trip: "Kyoto" },
      {
        trips: newAccountTrips(ASKER, async () => [kyotoTrip("Kyoto spring", springGoing), kyotoTrip("Kyoto autumn", autumnGoing)]),
        paletteCommands,
      },
    );
    expect(result).toEqual({ queued: false, refused });
    expect(paletteCommands.collected()).toEqual([]);
  });

  it("add_playbook_to_trip drafts it from \"Kyoto trip\"", async () => {
    const playbookProposal = newPlaybookProposalBuffer();
    const savedDayId = "e2d0f4a1-0000-4000-8000-000000000003";
    const playbookPage = {
      day: async () => ({ savedDayId, name: "Temples", stops: [{}, {}] }) as unknown as SavedDay,
    } as unknown as PlaybookPageReads;
    const result = await addPlaybookToTripTool.run({ trip: "Kyoto trip", day: 2 }, { playbookPage, trips: trips(), playbookProposal });
    expect(result).toEqual({ queued: true, note: expect.any(String) });
    expect(playbookProposal.collected()?.target).toEqual({ kind: "trip", tripId: kyoto.tripId, startingAt: kyoto.days[1]!.dayId });
  });
});
