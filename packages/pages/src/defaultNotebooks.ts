import { SYSTEM_ACTOR_ID } from "@tc/contracts";
import type { PageContext, PageDoc } from "@tc/contracts";
import {
  DEFAULT_TEMPLATES,
  OVERVIEW_TEMPLATE,
  PLACEHOLDER_IDS,
  isOverviewPage,
  type SeededPage,
  type TemplateSeed,
} from "./templates";

// Resetting a trip's default notebooks, and adding the ones it is missing
// (Mitchell, 2026-09-27). Pure, so the server that writes and the screen that
// decides whether to offer the control ask the SAME question — a list action
// the server would answer "nothing to add" for is a button that lies.
//
// **What makes a notebook "a seed of template X", and why it is this.** Nothing
// stores the template key on a page. What the storage already treats as a
// seed's identity is `pages_system_seed_unique`: (trip, title) among rows owned
// by `system`. So a seed is a `system` page whose title is a default template's
// title — except the Overview, which is identified by its `kind` marker, the
// way every other reader of it does (a reader may rename it, and a pre-M30
// trip's Overview predates the current title).
//
// The cost, stated so it is not mistaken for an oversight: a seed the reader
// RENAMED is no longer recognised. It offers no reset, and "add missing" puts
// the template back beside it. Storing the template key on the page would fix
// that and is a contract change to `PageContext`; it was not needed for the
// ask, and the index would still be keyed on the title. KI-2026-09-27-e.

/** The fields a notebook needs for its seed to be recognised — a list entry or a full page both have them. */
export interface SeedCandidate {
  id: string;
  title: string;
  context: PageContext;
  actorId: string;
}

/**
 * The default template this notebook was seeded from, or `undefined` for a
 * notebook a person made (or a seed renamed away from its template's title).
 */
export function seedTemplateOf(page: SeedCandidate): TemplateSeed | undefined {
  if (page.actorId !== SYSTEM_ACTOR_ID) return undefined;
  if (isOverviewPage(page.context)) return OVERVIEW_TEMPLATE;
  return DEFAULT_TEMPLATES.find((t) => t !== OVERVIEW_TEMPLATE && t.title === page.title);
}

/** Each default template's seeded notebook on this trip, by template key — the first one listed wins. */
function seededIds(pages: readonly SeedCandidate[]): Record<string, string> {
  const ids: Record<string, string> = {};
  for (const page of pages) {
    const template = seedTemplateOf(page);
    if (template !== undefined && ids[template.key] === undefined) ids[template.key] = page.id;
  }
  return ids;
}

/** The default templates this trip has no seeded notebook for, in a new trip's order. */
export function missingDefaultTemplates(pages: readonly SeedCandidate[]): TemplateSeed[] {
  const present = seededIds(pages);
  return DEFAULT_TEMPLATES.filter((t) => present[t.key] === undefined);
}

/**
 * The notebooks "Add missing default notebooks" writes: one per missing
 * template, built exactly as `instantiateDefaults` builds a new trip's, and
 * empty when nothing is missing.
 *
 * **A seed the trip once had comes back under the id it had.** `former` is
 * every notebook the trip has had and no longer does, as each was created,
 * oldest first; the latest one of a missing template lends its id. So every
 * link to it, anywhere, resolves again: an existing Overview's card for a
 * re-added Money named the deleted id and said "this notebook was deleted",
 * and re-pointing it would have been an edit to a notebook the owner never
 * asked to change. The page aggregate allows it: a delete removes the id from
 * the fold, so creating it again is an ordinary create.
 *
 * A template the trip never had gets an id minted here, and a missing Overview
 * links to the siblings the trip ALREADY has, by their existing ids (ADR-056).
 * `mintId` is the caller's, as it is for `instantiateDefaults`: this package
 * has no randomness (Invariant 4).
 */
export function instantiateMissingDefaults(
  tripId: string,
  pages: readonly SeedCandidate[],
  mintId: () => string,
  former: readonly SeedCandidate[] = [],
): SeededPage[] {
  const missing = missingDefaultTemplates(pages);
  const ids = { ...seededIds(pages) };
  const live = new Set(pages.map((p) => p.id));
  const previous: Record<string, string> = {};
  for (const page of former) {
    const template = seedTemplateOf(page);
    if (template !== undefined && !live.has(page.id)) previous[template.key] = page.id;
  }
  for (const t of missing) ids[t.key] = previous[t.key] ?? mintId();
  return missing.map((t) => ({
    id: ids[t.key]!,
    title: t.title,
    context: t.buildContext(tripId),
    content: t.buildContent ? t.buildContent(ids) : t.content,
  }));
}

/**
 * What "Reset to default" puts back for `page`: its template's title and
 * document, or `null` for a notebook that is not a recognised seed.
 *
 * The Overview's links are built against the trip's seeded siblings as they
 * are now, so a reset Overview names the notebooks that exist rather than the
 * placeholders. A sibling the trip no longer has keeps its placeholder, whose
 * card says the notebook was deleted — which is true.
 */
export function defaultDocumentFor(
  page: SeedCandidate,
  pages: readonly SeedCandidate[],
): { title: string; content: PageDoc } | null {
  const template = seedTemplateOf(page);
  if (template === undefined) return null;
  if (template.buildContent === undefined) return { title: template.title, content: template.content };
  const ids = { ...PLACEHOLDER_IDS, ...seededIds(pages), [template.key]: page.id };
  return { title: template.title, content: template.buildContent(ids) };
}
