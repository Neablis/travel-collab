import { newPageDoc } from "@tc/contracts";
import type {
  CreatePageInput,
  PageContext,
  PageDoc,
  PageHeadingNode,
  PageInlineNode,
  PageParagraphNode,
  PageTextNode,
} from "@tc/contracts";

// Typed against the AST rather than returning bare object literals (ADR-038).
// These are the oldest producers of stored page content in the repo, and until
// the write path became `PageDoc` nothing checked that what they seed is
// something the editor can open. Now a template that drifts out of the
// vocabulary fails to compile, which is where that should fail.
const heading = (text: string): PageHeadingNode => ({
  type: "heading",
  attrs: { level: 2 },
  content: [{ type: "text", text }],
});
const para = (...content: PageInlineNode[]): PageParagraphNode => ({ type: "paragraph", content });
const text = (t: string): PageTextNode => ({ type: "text", text: t });

export interface TemplateSeed {
  key: string;
  title: string;
  buildContext(tripId: string): PageContext;
  content: PageDoc;
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
  content: newPageDoc([
    heading("Overview"),
    para(text("What's this trip about? Jot down the highlights, the why, who's coming.")),
    heading("Itinerary"),
    para(text("Sketch the shape of the trip here — arrival, key days, departure.")),
    heading("Costs"),
    para(text("Track budget notes, splurges, and who's paying for what.")),
  ]),
};

const daySheet: TemplateSeed = {
  key: "day-sheet",
  title: "Day Sheet",
  buildContext: (tripId) => ({ tripId }),
  content: newPageDoc([
    heading("Day plan"),
    para(text("What's happening today? Times, reservations, notes for the group.")),
  ]),
};

export const DEFAULT_TEMPLATES: TemplateSeed[] = [tripOverview, daySheet];

export function instantiateDefaults(tripId: string): CreatePageInput[] {
  return DEFAULT_TEMPLATES.map((t) => ({ title: t.title, context: t.buildContext(tripId), content: t.content }));
}
