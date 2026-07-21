import type { PageContent, PageContext, CreatePageInput } from "@tc/contracts";

const heading = (text: string) => ({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text }] });
const para = (...content: unknown[]) => ({ type: "paragraph", content });
const text = (t: string) => ({ type: "text", text: t });
const macro = (name: string, params: Record<string, unknown> = {}) => ({ type: "macro", attrs: { name, params } });

export interface TemplateSeed {
  key: string;
  title: string;
  buildContext(tripId: string): PageContext;
  content: PageContent;
}

const tripOverview: TemplateSeed = {
  key: "trip-overview",
  title: "Trip Overview",
  buildContext: (tripId) => ({ tripId }),
  content: {
    type: "doc",
    content: [
      heading("Overview"),
      para(macro("trip.name"), text(" — "), macro("trip.dates")),
      para(text("Total cost: "), macro("cost.trip")),
      heading("Itinerary"),
      macro("itinerary.trip"),
      heading("Costs"),
      macro("costs.table"),
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
      para(text("Cost for the day: "), macro("cost.day")),
      macro("itinerary.day"),
    ],
  },
};

export const DEFAULT_TEMPLATES: TemplateSeed[] = [tripOverview, daySheet];

export function instantiateDefaults(tripId: string): CreatePageInput[] {
  return DEFAULT_TEMPLATES.map((t) => ({ title: t.title, context: t.buildContext(tripId), content: t.content }));
}
