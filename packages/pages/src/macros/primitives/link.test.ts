import { describe, expect, it } from "vitest";
import { renderMacro } from "../../registry";
import { insertWidget } from "../../insert";
import type { WidgetContext } from "../../registry-types";
import type { NotebookIndex, Slot } from "../../external";
import { notebookPreviewOf } from "../../linkTarget";
import { selectionTrip } from "../../test-support/selectionTrip";
import { getTemplate } from "../../templates";

// The two link widgets (M30, ADR-056). What each says, from what the trip and
// the notebook list hold — the card's words are the resolver's, so they are
// pinned here and `LinkCardBlock` only draws them.

const MONEY = "0f0f0f0f-0000-4000-8000-000000000001";
const GONE = "0f0f0f0f-0000-4000-8000-000000000002";

const list = (): NotebookIndex => ({
  pages: [{ id: MONEY, seedKey: "money", title: "Money", firstLine: "What the trip costs, day by day.", widgetCount: 2 }],
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
    });
  });

  it("counts widgets when a notebook opens on no words", () => {
    const value = { pages: [{ id: MONEY, seedKey: null, title: "Money", firstLine: null, widgetCount: 2 }] };
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

  // Mitchell, 2026-10-03: *"Links to a default notebook use the default, not
  // the notebook id so they can find them if they get added later."* The card
  // is handed over by id, so the renderer's href is the page's own.
  it("finds a default notebook by its seed key, whatever its id or its name is now", () => {
    const renamed = { pages: [{ id: MONEY, seedKey: "money", title: "Budget", firstLine: null, widgetCount: 0 }] };
    expect(card(ctx({ state: "ready", value: renamed }), { to: { kind: "seed", seedKey: "money" } })).toEqual({
      kind: "link-card",
      to: { kind: "notebook", pageId: MONEY },
      eyebrow: "Notebook",
      title: "Budget",
      summary: "Nothing in it yet",
    });
  });

  it("offers a default notebook the trip does not have, by the template's own name and line", () => {
    const outcome = renderMacro(ctx({ state: "ready", value: { pages: [] } }), "link.internal", { to: { kind: "seed", seedKey: "money" } });
    expect(outcome).toMatchObject({
      status: "ok",
      rendered: { kind: "block", block: { kind: "link-missing", seedKey: "money", title: "Money", description: getTemplate("money")!.description } },
    });
  });

  // A notebook somebody made and happened to call Money is not the trip's
  // Money: only the seed key says so (KI-2026-09-27-e).
  it("does not take a same-named notebook for the default", () => {
    const lookalike = { pages: [{ id: MONEY, seedKey: null, title: "Money", firstLine: null, widgetCount: 0 }] };
    const outcome = renderMacro(ctx({ state: "ready", value: lookalike }), "link.internal", { to: { kind: "seed", seedKey: "money" } });
    expect(outcome).toMatchObject({ rendered: { block: { kind: "link-missing" } } });
  });

  it("says a seed key no default template has was deleted: there is nothing to add back", () => {
    expect(renderMacro(ctx({ state: "ready", value: list() }), "link.internal", { to: { kind: "seed", seedKey: "retired" } })).toEqual({
      status: "empty",
      because: "this notebook was deleted",
    });
  });

  // An Overview reset on a trip without Money, before links were seed keys,
  // stored this placeholder id. It reads as the seed link it stood for, so
  // that trip's Overview finds a Money added later without a second reset.
  it("reads a stored placeholder id as the default it stood for", () => {
    const placeholder = { to: { kind: "notebook", pageId: "00000000-0000-4000-8000-00000000f003" } };
    expect(card(ctx({ state: "ready", value: list() }), placeholder).to).toEqual({ kind: "notebook", pageId: MONEY });
    expect(renderMacro(ctx({ state: "ready", value: { pages: [] } }), "link.internal", placeholder)).toMatchObject({
      rendered: { block: { kind: "link-missing", seedKey: "money" } },
    });
  });

  it("waits for the notebook list like any outside input, and says so when it failed", () => {
    const to = { to: { kind: "notebook", pageId: MONEY } };
    expect(renderMacro(ctx(), "link.internal", to)).toEqual({ status: "unavailable", reason: "pending" });
    expect(renderMacro(ctx({ state: "failed" }), "link.internal", to)).toEqual({ status: "unavailable", reason: "source" });
  });

  it("previews a day from the trip — its cities and how full it is — and a removed day as removed", () => {
    const c = ctx();
    const dayId = c.trip!.days[1]!.dayId;
    expect(card(c, { to: { kind: "day", day: { kind: "dayId", dayId } } })).toMatchObject({
      eyebrow: "Day 2 · Jun 2",
      title: "Rome – Kyoto",
      summary: "2 stops",
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

// M58 decision 1 (ADR-088 §6): for a stranger, a link goes only where a stranger
// can already read. Anything else is its label, and no page id leaves the server.
describe("links for the public reader", () => {
  const TOKEN = "tok_abc-123";
  const publicCtx = (value: NotebookIndex, tokens: Record<string, string> = {}): WidgetContext => ({
    ...ctx({ state: "ready", value }),
    reader: "public",
    publicTokenFor: (pageId) => tokens[pageId] ?? null,
  });
  const MONEY_ONLY = list();

  it("sends a notebook with a live public link to its /n/ token", () => {
    expect(card(publicCtx(MONEY_ONLY, { [MONEY]: TOKEN }), { to: { kind: "notebook", pageId: MONEY } }).to).toEqual({ kind: "public", token: TOKEN });
  });

  it("follows a seed to the page it names, and links it when that page is public", () => {
    expect(card(publicCtx(MONEY_ONLY, { [MONEY]: TOKEN }), { to: { kind: "seed", seedKey: "money" } }).to).toEqual({ kind: "public", token: TOKEN });
  });

  it("draws a private notebook as its title alone: no target, no first line, no page id", () => {
    const block = card(publicCtx(MONEY_ONLY), { to: { kind: "notebook", pageId: MONEY } });
    expect(block).toEqual({ kind: "link-card", to: { kind: "plain" }, eyebrow: "Notebook", title: "Money", summary: "" });
    expect(JSON.stringify(block)).not.toContain(MONEY);
  });

  it("draws a seed that resolves to a private page the same way", () => {
    const block = card(publicCtx(MONEY_ONLY), { to: { kind: "seed", seedKey: "money" } });
    expect(block.to).toEqual({ kind: "plain" });
    expect(JSON.stringify(block)).not.toContain(MONEY);
  });

  it("does not offer a stranger the add button for a default notebook the trip lacks", () => {
    const outcome = renderMacro(publicCtx({ pages: [] }), "link.internal", { to: { kind: "seed", seedKey: "money" } });
    expect(outcome).toMatchObject({ status: "ok", rendered: { block: { kind: "link-card", to: { kind: "plain" }, title: "Money" } } });
  });

  it.each([
    ["a tab", { kind: "view", view: "Plan" }],
    ["a day", { kind: "day", day: { kind: "index", index: 0 } }],
  ])("draws %s as text, with nothing to follow", (_, to) => {
    const block = card(publicCtx(MONEY_ONLY), { to });
    expect(block.to).toEqual({ kind: "plain" });
    expect(block.summary).toBe("");
  });

  it("leaves a member's card exactly as it was", () => {
    expect(card({ ...ctx({ state: "ready", value: MONEY_ONLY }), reader: "member" }, { to: { kind: "notebook", pageId: MONEY } }).to).toEqual({ kind: "notebook", pageId: MONEY });
  });

  it("marks an outbound link nofollow ugc for a stranger only", () => {
    const params = { href: "https://example.com/a", label: "Ex" };
    expect(renderMacro({ ...ctx(), reader: "public" }, "link.external", params)).toMatchObject({ rendered: { rel: "noopener noreferrer nofollow ugc" } });
    expect(renderMacro(ctx(), "link.external", params)).toEqual({ status: "ok", rendered: { kind: "link", href: "https://example.com/a", text: "Ex" } });
  });
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
