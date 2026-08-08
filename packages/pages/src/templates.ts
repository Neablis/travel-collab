import type { PageContent, PageContext, CreatePageInput } from "@tc/contracts";

const heading = (text: string) => ({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text }] });
const para = (...content: unknown[]) => ({ type: "paragraph", content });
const text = (t: string) => ({ type: "text", text: t });

export interface TemplateSeed {
  key: string;
  title: string;
  buildContext(tripId: string): PageContext;
  content: PageContent;
}

// Plain-note starters (Task B3): macro *authoring* left the primary editing
// surface in M8, so these seeded templates no longer plant macro nodes a
// reader can't add, edit, or remove themselves — they prompt writing instead.
// Macro *rendering* is untouched; a page that already has a macro node (from
// before this change, or written by the AI compose path) still displays it.
const tripOverview: TemplateSeed = {
  key: "trip-overview",
  title: "Trip Overview",
  buildContext: (tripId) => ({ tripId }),
  content: {
    type: "doc",
    content: [
      heading("Overview"),
      para(text("What's this trip about? Jot down the highlights, the why, who's coming.")),
      heading("Itinerary"),
      para(text("Sketch the shape of the trip here — arrival, key days, departure.")),
      heading("Costs"),
      para(text("Track budget notes, splurges, and who's paying for what.")),
    ],
  },
};

const daySheet: TemplateSeed = {
  key: "day-sheet",
  title: "Day Sheet",
  buildContext: (tripId) => ({ tripId, dayRef: { kind: "index", index: 0 } }),
  content: {
    type: "doc",
    content: [
      heading("Day plan"),
      para(text("What's happening today? Times, reservations, notes for the group.")),
    ],
  },
};

export const DEFAULT_TEMPLATES: TemplateSeed[] = [tripOverview, daySheet];

export function instantiateDefaults(tripId: string): CreatePageInput[] {
  return DEFAULT_TEMPLATES.map((t) => ({ title: t.title, context: t.buildContext(tripId), content: t.content }));
}
