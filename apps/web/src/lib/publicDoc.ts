import type { PageMark } from "@tc/contracts";
import type { RenderOutcome, UnboundNeeds } from "@tc/pages";
import type { AccentFamily } from "./dayAccent";

// The shapes of a public notebook's resolved document, kept in `lib` so that
// `pagesClient` (the publish preview) and the components that draw them both
// reach them without `lib` importing a component folder.

/**
 * Where each city and day on a public page wears its accent, as data: the
 * server resolves a stranger's widgets (M58, Mitchell on decision 5: *"a
 * hidden widget's data is not sent to the page"*), so there is no trip here to
 * derive `CityAccents` from. Only names and ids the page already shows.
 */
export interface AccentTable {
  cities: Readonly<Record<string, AccentFamily>>;
  days: Readonly<Record<string, AccentFamily>>;
}

/**
 * A widget as `/n/<token>`'s server answered it: its name and what it resolved
 * to for a stranger. These types restate the server's `PublicNotebookView`
 * (`server/access/publicView.ts`) because UI cannot import `@/server`; the
 * page file, which can, hands the real one to `PublicNotebookScreen`, so a
 * shape that drifts fails to compile there.
 */
export interface PublicWidgetNode {
  type: "macro";
  attrs: { name: string; outcome: RenderOutcome };
}

export type PublicRepeatOutcome =
  | { status: "ok"; lines: readonly string[] }
  | { status: "empty"; emptyText: string }
  | { status: "unbound"; needs: UnboundNeeds }
  | { status: "invalid" }
  | { status: "not-shared" };

export interface PublicRepeatNode {
  type: "repeat";
  attrs: { name: string; outcome: PublicRepeatOutcome };
}

export type PublicDocNode =
  | PublicWidgetNode
  | PublicRepeatNode
  | { type: "unknown" }
  | { type: string; attrs?: Readonly<Record<string, unknown>>; text?: string; marks?: readonly PageMark[]; content?: readonly PublicDocNode[] };

/** The document of a public notebook with its widgets already resolved, and the accents they wear. */
export interface PublicDoc {
  content: readonly PublicDocNode[];
  accents: AccentTable;
}
