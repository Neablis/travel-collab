import { describe, expect, it, vi } from "vitest";
import { newPageDoc, type PageNode, type TripDetail } from "@tc/contracts";
import { scenarios } from "@tc/factories";
import { MACRO_REGISTRY, renderMacro, type WidgetContext } from "@tc/pages";
import { toPublicNotebookView, type PublicNotebookInput, type PublicWidgetNode } from "./publicView";

// M58 (ADR-088 §5): three floors hold whatever a widget's setting says,
// because they are on what the resolvers read, not in the widgets. Each test
// below was seen red by removing the one line that holds its floor.

const macro = (name: string, params: Record<string, unknown>, hideWhenPublic?: true): PageNode =>
  ({ type: "macro", attrs: hideWhenPublic ? { name, params, hideWhenPublic } : { name, params } }) as PageNode;

function viewOf(trip: TripDetail, nodes: PageNode[], extra: Partial<PublicNotebookInput> = {}) {
  return toPublicNotebookView({
    trip, globals: null, today: null, now: null, publicTokenFor: () => null,
    page: { title: "Plan", content: newPageDoc([{ type: "paragraph", content: nodes } as PageNode]), context: { tripId: trip.tripId } },
    ...extra,
  });
}

// The outcome of the `index`th widget in the view's one paragraph.
function outcomeAt(view: ReturnType<typeof viewOf>, index: number) {
  const paragraph = view.content[0] as { content: readonly PublicWidgetNode[] };
  return paragraph.content[index]!.attrs.outcome;
}

// A trip whose first stop is a booked, attributed one, with a member who
// carries an id, and a chat attached to the input the way a real read could.
function tripWithPeople() {
  const trip = scenarios.threeDayTrip();
  const id = trip.days[0]!.activityIds[0]!;
  const stop = trip.activities[id]!;
  return {
    ...trip,
    currency: "USD",
    members: [{ userId: "user-sam-secret", role: "owner" as const }, { userId: "user-alex-secret", role: "editor" as const }],
    activities: {
      ...trip.activities,
      [id]: {
        ...stop,
        addedBy: "user-sam-secret",
        bookedBy: "user-alex-secret",
        participants: ["user-alex-secret", "user-sam-secret"],
        cost: { amountMinor: 90_00, currency: "USD" },
        booking: { confirmation: "XK29QP", provider: "Opentable", url: "https://example.com/manage/XK29QP" },
      },
    },
    chat: [{ id: "m1", text: "meet at the airport at six" }],
  };
}

describe("toPublicNotebookView", () => {
  // No widget prints a booking code or an actor id today, so each floor is
  // read where it holds: in what every resolver is handed.
  function readBy(trip: TripDetail) {
    const resolve = vi.spyOn(MACRO_REGISTRY["attribute"]!, "resolve");
    try {
      const view = viewOf(trip, [macro("attribute", { field: "trip.name" })]);
      return { view, ctx: resolve.mock.calls[0]![0] as WidgetContext };
    } finally {
      resolve.mockRestore();
    }
  }

  it("floor 1: a resolver reads a booking's provider and not its code or manage link", () => {
    const trip = tripWithPeople();
    const { ctx } = readBy(trip);
    expect(ctx.trip!.activities[trip.days[0]!.activityIds[0]!]!.booking).toEqual({ provider: "Opentable" });
  });

  it("floor 2: the trip chat is absent for the public reader, who cannot chat", () => {
    const { ctx } = readBy(tripWithPeople());
    expect(ctx).toMatchObject({ reader: "public", canChat: false, chat: null });
    const view = viewOf(tripWithPeople(), [macro("chat.recent", {})]);
    expect(outcomeAt(view, 0)).toEqual({ status: "absent" });
    expect(JSON.stringify(view)).not.toContain("meet at the airport");
  });

  it("floor 3: a resolver reads no one who added a stop, and no member's name", () => {
    const trip = tripWithPeople();
    const { ctx } = readBy(trip);
    expect(ctx.trip!.activities[trip.days[0]!.activityIds[0]!]).toMatchObject({ addedBy: null });
    expect(ctx).toMatchObject({ people: null, personas: null, guests: null });
  });

  // ADR-088 §5 floors `addedBy` only. Who booked and who shares a stop is what
  // the money widgets split by: emptied, a stranger would read false balances.
  it("shows a stranger the same balances and share as a member, names aside", () => {
    const trip = tripWithPeople();
    const nodes = [macro("cost.balances", {}), macro("person.share", { who: "user-alex-secret" })];
    const publicView = viewOf(trip, nodes);
    const memberCtx: WidgetContext = { trip, page: { tripId: trip.tripId }, user: null, globals: null, today: null, people: null, personas: null, guests: null, reader: "member" };
    const member = nodes.map((node) => {
      const { name, params } = (node as { attrs: { name: string; params: Record<string, unknown> } }).attrs;
      return renderMacro(memberCtx, name, params);
    });
    expect([outcomeAt(publicView, 0), outcomeAt(publicView, 1)]).toEqual(member);
  });

  it("names no member in what a stranger is sent, ids included", () => {
    const trip = tripWithPeople();
    const view = viewOf(trip, [macro("cost.balances", {}), macro("person.share", { who: "user-alex-secret" }), macro("trip.people", {})]);
    expect(JSON.stringify(view)).not.toMatch(/secret/);
    // The floor above is vacuous if the widgets said nothing about anyone.
    expect(JSON.stringify(view)).toContain("Traveler 1");
  });

  it("carries the title, the document and the accents, and nothing of the trip", () => {
    const trip = tripWithPeople();
    const view = viewOf(trip, [macro("attribute", { field: "trip.name" })]);
    expect(Object.keys(view).sort()).toEqual(["accents", "content", "title"]);
    expect(view.title).toBe("Plan");
    expect(JSON.stringify(outcomeAt(view, 0))).toContain(trip.name);
  });
});

// M58 decision 5, Mitchell: "a hidden widget's data is not sent to the page".
// So the stranger gets each widget already resolved, and neither the trip nor
// a hidden instance's params.
describe("what a hidden widget leaves out", () => {
  function secretsTrip() {
    const trip = scenarios.threeDayTrip({ budget: { amountMinor: 9876543, currency: "USD" } });
    const id = trip.days[0]!.activityIds[0]!;
    return { ...trip, activities: { ...trip.activities, [id]: { ...trip.activities[id]!, notes: "zebra-lantern-note" } } };
  }
  const nodes = [
    macro("attribute", { field: "trip.name" }),
    macro("cost", {}, true),
    macro("link.external", { href: "https://quokka-hideout.example/x", label: "quokka den" }, true),
  ];
  const repeat = { type: "repeat", attrs: { name: "day.rows", params: { template: "Pack the marmoset umbrella" }, hideWhenPublic: true }, content: [] } as PageNode;

  it("sends no trip, no hidden params and no hidden output", () => {
    const trip = secretsTrip();
    const view = toPublicNotebookView({
      trip, globals: null, today: null, now: null, publicTokenFor: () => null,
      page: { title: "Plan", content: newPageDoc([{ type: "paragraph", content: nodes } as PageNode, repeat]), context: { tripId: trip.tripId } },
    });
    const json = JSON.stringify(view);
    for (const secret of ["9876543", "98,765.43", "zebra-lantern-note", "quokka", "marmoset"]) expect(json).not.toContain(secret);
    expect(Object.keys(view)).not.toContain("activities");
    expect(outcomeAt(view, 1)).toEqual({ status: "not-shared" });
    expect(view.content[1]).toEqual({ type: "repeat", attrs: { name: "day.rows", outcome: { status: "not-shared" } } });
  });

  it("sends no settings of a widget whose settings no longer fit it", () => {
    const view = viewOf(secretsTrip(), [macro("open", { class: ["otter-burrow"] })]);
    expect(outcomeAt(view, 0)).toEqual({ status: "bad-params", message: "" });
  });

  it("writes an unhidden repeat's lines on the server", () => {
    const trip = secretsTrip();
    const shown = { ...repeat, attrs: { name: "day.rows", params: { template: "Pack the marmoset umbrella" } } } as PageNode;
    const view = toPublicNotebookView({
      trip, globals: null, today: null, now: null, publicTokenFor: () => null,
      page: { title: "Plan", content: newPageDoc([shown]), context: { tripId: trip.tripId } },
    });
    expect(view.content[0]).toEqual({
      type: "repeat",
      attrs: { name: "day.rows", outcome: { status: "ok", lines: trip.days.map(() => "Pack the marmoset umbrella") } },
    });
  });

  it("quotes no first line of a notebook that is not public", () => {
    const trip = secretsTrip();
    const pages = [
      { id: "11111111-1111-4111-8111-111111111111", seedKey: null, title: "Kept", firstLine: "the ferret password", widgetCount: 0 },
      { id: "22222222-2222-4222-8222-222222222222", seedKey: null, title: "Open", firstLine: "Come along", widgetCount: 0 },
    ];
    const view = viewOf(trip, pages.map((p) => macro("link.internal", { to: { kind: "notebook", pageId: p.id } })), {
      external: { weather: { state: "pending" }, notebooks: { state: "ready", value: { pages } } },
      publicTokenFor: (id) => (id === pages[1]!.id ? "tok-open" : null),
    });
    const json = JSON.stringify(view);
    expect(json).not.toContain("ferret");
    expect(json).not.toContain(pages[0]!.id);
    expect(outcomeAt(view, 1)).toMatchObject({ status: "ok", rendered: { block: { to: { kind: "public", token: "tok-open" } } } });
  });
});
