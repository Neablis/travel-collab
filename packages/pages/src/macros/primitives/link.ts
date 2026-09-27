import { z } from "zod";
import type { TripDetail, TripGlobals } from "@tc/contracts";
import type { MacroDef, WidgetContext } from "../../registry-types";
import { blockOf, ghost, linkOf } from "../../registry-types";
import { ok, empty, needsTrip, unbound, type MacroResult } from "../../result";
import { readSlot } from "../../external";
import { dayIndexOf } from "../../select";
import { dayLabel, formatShortDate } from "../../format";
import { LinkTarget, type LinkCardPayload, type LinkView } from "../../linkTarget";

// The two link widgets (M30, ADR-056). Mitchell, 2026-09-26: *"we should have a
// Link widget that lets you link to other notebooks, or pages in the website,
// maybe with a simple preview of the website rather than just rendering a html
// link"* — and, asked, two separate widgets: an internal one that is *"more of
// a smart search bar that knows what is available and autocompletes, and has
// simple previews"*, and an external one that is *"just a href shorthand"*.
//
// Both are offered to the assistant since ADR-057, each behind a guard in the
// assistant's `insert_widget` rather than here: an internal link is named by a
// number from this turn's list of notebooks and never by an id, and an external
// one only for an address the user typed in the message being answered.

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------------------
// link.internal
// ---------------------------------------------------------------------------

const InternalLinkParams = z.object({ to: LinkTarget.optional() }).strip();
type InternalLinkParams = z.infer<typeof InternalLinkParams>;

/**
 * What a tab card says, from the trip rather than from a fixed blurb, so the
 * card is a preview of the place and not a caption for it. Each line still
 * reads on a trip with nothing in it — it then says what the tab is for.
 */
function viewCard(view: LinkView, trip: TripDetail, globals: TripGlobals | null): { title: string; summary: string } {
  const stops = trip.days.reduce((n, day) => n + day.activityIds.length, 0);
  switch (view) {
    case "Plan":
      return {
        title: "Plan",
        summary:
          trip.days.length === 0
            ? "Where days are added and stops are moved"
            : `Every day side by side — ${plural(trip.days.length, "day")}, ${plural(stops, "stop")}`,
      };
    case "Calendar": {
      const timed = trip.days.reduce(
        (n, day) => n + day.activityIds.filter((id) => trip.activities[id]?.timeWindow).length,
        0,
      );
      return {
        title: "Calendar",
        summary: timed === 0 ? "Each day hour by hour, once stops have times" : `Each day hour by hour — ${plural(timed, "timed stop")}`,
      };
    }
    case "Map": {
      const placed = globals?.days.filter((day) => day.place !== null).length ?? 0;
      return {
        title: "Map",
        summary: placed === 0 ? "Every stop with a place, on a map" : `Every stop with a place, on a map — ${plural(placed, "day")} placed`,
      };
    }
  }
}

/**
 * `link.internal` — a card for another notebook, a day or a tab of this trip.
 *
 * **What it resolves, in order.** A target first: none is `unbound("target")`,
 * which Editing draws as a ghost and whose settings hold the one control that
 * answers it. A tab or a day needs only the trip. A notebook needs the trip's
 * notebook list (`needs: ["notebooks"]`), so until it lands the card is the
 * same "loading" line the weather's is — the first-paint allowance the seeded
 * Overview relies on (`templates.ts`). A notebook id the list does not have is
 * **deleted**, and says so: `empty` with the reason, never a card pointing at
 * nothing. A day that is gone is `unbound("day")`, the "that day was removed"
 * every day filter already gives.
 */
export const internalLink: MacroDef<InternalLinkParams, LinkCardPayload> = {
  name: "link.internal", title: "Link to a notebook or tab", shape: "block",
  params: InternalLinkParams,
  inputs: [{ name: "to", type: "target", label: "Links to" }],
  needs: ["notebooks"],
  description:
    "A card linking to another notebook in this trip, a day, or the trip's Plan, Calendar or Map, with its name and a line about it. Follows renames; says so if the notebook is deleted.",
  emptyText: "this notebook was deleted",
  // Fixed (ADR-037 decision 5), and generic on purpose: which notebook the
  // reader will point it at is theirs to choose.
  preview: "a card for another notebook, a day or a tab — its name and a line about it",
  resolve: ({ trip, globals, external }: WidgetContext, params): MacroResult<LinkCardPayload> => {
    if (!trip) return needsTrip();
    const to = params.to;
    if (to === undefined) return unbound("target", [ghost("text", "where it goes")]);
    switch (to.kind) {
      case "view":
        return ok({ kind: "link-card", to, eyebrow: "Trip tab", ...viewCard(to.view, trip, globals), openable: true });
      case "day": {
        const index = dayIndexOf(trip, to.day);
        if (index === null) return unbound("day");
        const day = trip.days[index]!;
        const cities = globals?.days[index]?.cities ?? [];
        const date = formatShortDate(day.date);
        return ok({
          kind: "link-card",
          // By id whatever was stored, so the href the card builds survives a
          // reorder between this render and the click.
          to: { kind: "day", day: { kind: "dayId", dayId: day.dayId } },
          eyebrow: date === null ? dayLabel(index) : `${dayLabel(index)} · ${date}`,
          title: cities.length > 0 ? cities.join(" – ") : dayLabel(index),
          summary: day.activityIds.length === 0 ? "Nothing planned yet" : plural(day.activityIds.length, "stop"),
          openable: true,
        });
      }
      case "notebook": {
        const slot = readSlot(external, "notebooks");
        if (slot.status !== "ok") return slot;
        const page = slot.value.pages.find((p) => p.id === to.pageId);
        if (page === undefined) return empty("this notebook was deleted");
        return ok({
          kind: "link-card",
          to,
          eyebrow: "Notebook",
          title: page.title,
          summary:
            page.firstLine ??
            (page.widgetCount > 0 ? `${plural(page.widgetCount, "widget")}, no words yet` : "Nothing in it yet"),
          openable: slot.value.openable,
        });
      }
    }
  },
  render: blockOf,
};

// ---------------------------------------------------------------------------
// link.external
// ---------------------------------------------------------------------------

/**
 * A web address a link may carry: **http or https, and nothing else.**
 *
 * The check is the params schema's, so it holds at every door at once — the
 * settings panel, `insertWidget`, the page write check (`findWidgetError`), and
 * the read: a stored `javascript:` or `data:` address fails to parse and the
 * widget renders "this widget's settings no longer fit it" instead of a link.
 * `new URL` rather than a regex, because the question is how a browser will
 * read the string, and that is what `URL` answers.
 */
export const WebAddress = z
  .string()
  .trim()
  .max(2048)
  .refine((raw) => {
    try {
      const url = new URL(raw);
      return (url.protocol === "https:" || url.protocol === "http:") && url.hostname !== "";
    } catch {
      return false;
    }
  }, "a web address starting http:// or https://");

const ExternalLinkParams = z
  .object({
    href: WebAddress.optional(),
    label: z.string().trim().max(120).optional(),
  })
  .strip();
type ExternalLinkParams = z.infer<typeof ExternalLinkParams>;

/** The link's words when the author gave none: the site's host, without `www.`. */
export function hostOf(href: string): string {
  return new URL(href).hostname.replace(/^www\./, "");
}

/**
 * `link.external` — *"just a href shorthand"*: an address and optional words,
 * drawn as an inline link that opens in a new tab.
 *
 * **No preview and no fetch.** Mitchell's first ask mentioned a preview of the
 * website; when the two were split he scoped this one to a shorthand, and a
 * preview would mean the server fetching an address somebody typed — a request
 * made on the reader's behalf to anywhere, which is a different feature with a
 * different ADR.
 */
export const externalLink: MacroDef<ExternalLinkParams, { href: string; text: string }> = {
  name: "link.external", title: "Link to a website", shape: "single",
  params: ExternalLinkParams,
  inputs: [
    { name: "href", type: "url", label: "Web address" },
    { name: "label", type: "text", label: "Link text", placeholder: "The site's name" },
  ],
  description: "A link to a website, inline in a sentence. Opens in a new tab. Only http and https addresses.",
  emptyText: "add a web address",
  preview: "a link to a website, in your own words",
  resolve: (_ctx: WidgetContext, params) => {
    if (params.href === undefined) return unbound("url", [ghost("text", "web address")]);
    const label = params.label?.trim();
    return ok({ href: params.href, text: label ? label : hostOf(params.href) });
  },
  render: ({ href, text }) => linkOf(href, text),
};
