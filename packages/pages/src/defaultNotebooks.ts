import type { PageDoc } from "@tc/contracts";
import { DEFAULT_TEMPLATES, PLACEHOLDER_IDS, type SeededPage, type TemplateSeed } from "./templates";

// Resetting a trip's default notebooks, and adding the ones it is missing
// (Mitchell, 2026-09-27). Pure, so the server that writes and the screen that
// decides whether to offer the control ask the SAME question — a list action
// the server would answer "nothing to add" for is a button that lies.
//
// **What makes a notebook "a seed of template X": its `seedKey`, never its
// title** (Mitchell, 2026-09-27: *"You should be allowed to rename a default
// notebook, or delete one."*). Every seed carries its template's key for as
// long as it exists: the seeder writes it, the log carries it (`PageCreated`),
// and the database holds one page per key per trip (`pages_seed_key_unique`).
// So a renamed seed is still that seed: it keeps *Reset to default*, and "add
// missing" does not plant a second copy beside it. Titles are free; two
// notebooks may share one. Until 2026-09-27 a seed was a `system` page with a
// template's title, and renaming one lost it (KI-2026-09-27-e, resolved).

/** The fields a notebook needs for its seed to be recognised — a list entry or a full page both have them. */
export interface SeedCandidate {
  id: string;
  /** Absent or `null` on a notebook that did not come with the trip. */
  seedKey?: string | null | undefined;
}

/**
 * The default template this notebook was seeded from, by its seed key, or
 * `undefined` for a notebook a person made. Whatever it is called now.
 */
export function seedTemplateOf(page: SeedCandidate): TemplateSeed | undefined {
  if (page.seedKey === undefined || page.seedKey === null) return undefined;
  return DEFAULT_TEMPLATES.find((t) => t.key === page.seedKey);
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
    seedKey: t.key,
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
