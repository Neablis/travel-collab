import { describe, expect, it } from "vitest";
import { renderMacro } from "../../registry";
import { insertWidget } from "../../insert";
import type { WidgetContext } from "../../registry-types";
import type { NotebookIndex, Slot } from "../../external";
import { notebookPreviewOf } from "../../linkTarget";
import { selectionTrip } from "../../test-support/selectionTrip";

// The two link widgets (M30, ADR-056). What each says, from what the trip and
// the notebook list hold — the card's words are the resolver's, so they are
// pinned here and `LinkCardBlock` only draws them.

const MONEY = "0f0f0f0f-0000-4000-8000-000000000001";
const GONE = "0f0f0f0f-0000-4000-8000-000000000002";

const list = (openable = true): NotebookIndex => ({
  pages: [{ id: MONEY, title: "Money", firstLine: "What the trip costs, day by day.", widgetCount: 2 }],
  openable,
});

function ctx(notebooks?: Slot<NotebookIndex>): WidgetContext {
  const { trip, globals } = selectionTrip();
  return {
    trip, page: { tripId: trip.tripId }, user: null, globals, today: null,
    external: { weather: { state: "pending" }, ...(notebooks ? { notebooks } : {}) },
  };
}

const card = (c: WidgetContext, params: Record<string, unknown>) => {
  const outcome = renderMacro(c, "link.internal", params);
  if (outcome.status !== "ok" || outcome.rendered.kind !== "block" || outcome.rendered.block.kind !== "link-card") {
    throw new Error(`expected a link card, got ${JSON.stringify(outcome)}`);
  }
  return outcome.rendered.block;
};

describe("link.internal", () => {
  it("lands asking where it goes, as a ghost the settings panel answers", () => {
    expect(renderMacro(ctx(), "link.internal", {})).toMatchObject({ status: "unbound", needs: "target" });
  });

  it("titles a notebook card with the notebook's name and its own first line", () => {
    expect(card(ctx({ state: "ready", value: list() }), { to: { kind: "notebook", pageId: MONEY } })).toEqual({
      kind: "link-card",
      to: { kind: "notebook", pageId: MONEY },
      eyebrow: "Notebook",
      title: "Money",
      summary: "What the trip costs, day by day.",
      openable: true,
    });
  });

  it("counts widgets when a notebook opens on no words", () => {
    const value = { pages: [{ id: MONEY, title: "Money", firstLine: null, widgetCount: 2 }], openable: true };
    expect(card(ctx({ state: "ready", value }), { to: { kind: "notebook", pageId: MONEY } }).summary).toBe("2 widgets, no words yet");
  });

  // ADR-056: "a deleted target renders an honest line". Seen red by answering
  // a card with the stored id as its title instead.
  it("says a notebook the list no longer has was deleted — never a card pointing at nothing", () => {
    expect(renderMacro(ctx({ state: "ready", value: list() }), "link.internal", { to: { kind: "notebook", pageId: GONE } })).toEqual({
      status: "empty",
      because: "this notebook was deleted",
    });
  });

  it("waits for the notebook list like any outside input, and says so when it failed", () => {
    const to = { to: { kind: "notebook", pageId: MONEY } };
    expect(renderMacro(ctx(), "link.internal", to)).toEqual({ status: "unavailable", reason: "pending" });
    expect(renderMacro(ctx({ state: "failed" }), "link.internal", to)).toEqual({ status: "unavailable", reason: "source" });
  });

  // The demo's visitor and an invitee having a look cannot open a notebook
  // route, so the card they get names it without the way in.
  it("carries the reader's openability through to the card", () => {
    expect(card(ctx({ state: "ready", value: list(false) }), { to: { kind: "notebook", pageId: MONEY } }).openable).toBe(false);
  });

  it("previews a day from the trip — its cities and how full it is — and a removed day as removed", () => {
    const c = ctx();
    const dayId = c.trip!.days[1]!.dayId;
    expect(card(c, { to: { kind: "day", day: { kind: "dayId", dayId } } })).toMatchObject({
      eyebrow: "Day 2 · Jun 2",
      title: "Rome – Kyoto",
      summary: "2 stops",
      openable: true,
    });
    expect(renderMacro(c, "link.internal", { to: { kind: "day", day: { kind: "dayId", dayId: GONE } } })).toMatchObject({
      status: "unbound",
      needs: "day",
    });
  });

  it("previews a tab from the trip, and needs no notebook list to do it", () => {
    expect(card(ctx(), { to: { kind: "view", view: "Plan" } })).toMatchObject({
      eyebrow: "Trip tab",
      title: "Plan",
      summary: "Every day side by side — 3 days, 6 stops",
    });
  });
});

describe("link.external", () => {
  const link = (params: Record<string, unknown>) => renderMacro(ctx(), "link.external", params);

  it("lands asking for an address", () => {
    expect(link({})).toMatchObject({ status: "unbound", needs: "url" });
  });

  it("renders the author's words, or the site's host when there are none", () => {
    expect(link({ href: "https://www.japan-rail-pass.com/buy", label: "Rail pass" })).toEqual({
      status: "ok",
      rendered: { kind: "link", href: "https://www.japan-rail-pass.com/buy", text: "Rail pass" },
    });
    expect(link({ href: "https://www.japan-rail-pass.com/buy", label: "  " })).toMatchObject({
      rendered: { text: "japan-rail-pass.com" },
    });
  });

  // The address is checked by the params schema, so it is refused at every
  // door: here at render (a stored one reads "settings no longer fit"), and at
  // insert. Seen red by dropping the protocol check from `WebAddress`.
  it.each(["javascript:alert(1)", "data:text/html,<b>x</b>", "ftp://example.com/file", "example.com", "https://"])(
    "refuses %s at render and at insert",
    (href) => {
      expect(link({ href }).status).toBe("bad-params");
      expect(insertWidget("link.external", { href }).ok).toBe(false);
    },
  );
});

describe("notebookPreviewOf", () => {
  it("takes the first line with words in it, and counts every widget", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "macro", attrs: { name: "dates", params: {} } }] },
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "  Where   you sleep " }] },
        { type: "paragraph", content: [{ type: "text", text: "Later prose." }] },
        { type: "repeat", attrs: { name: "day.rows" }, content: [] },
      ],
    };
    expect(notebookPreviewOf(doc)).toEqual({ firstLine: "Where you sleep", widgetCount: 2 });
  });

  it("shortens a long line, and answers null for a document with no words or no shape", () => {
    const long = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "word ".repeat(60) }] }] };
    expect(notebookPreviewOf(long).firstLine).toMatch(/…$/);
    expect(notebookPreviewOf(long).firstLine!.length).toBeLessThanOrEqual(140);
    expect(notebookPreviewOf({ type: "doc", content: [] })).toEqual({ firstLine: null, widgetCount: 0 });
    expect(notebookPreviewOf("not a document")).toEqual({ firstLine: null, widgetCount: 0 });
  });
});
