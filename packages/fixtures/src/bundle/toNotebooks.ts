// A bundle notebook becomes a `CreatePageInput` — one notebook, bound to one
// trip.
//
// A template is trip-agnostic and a page is not: `PageContext` is `{ tripId }`
// and nothing else, so instantiating is exactly "say which trip". That is the
// whole conversion, and it is a function rather than an inlined spread so the
// importer, the seeder and `@tc/pages`' own template library all instantiate
// the same way.

import type { CreatePageInput } from "@tc/contracts";
import type { BundleNotebook } from "./schema.ts";

export function instantiateBundleNotebook(notebook: BundleNotebook, tripId: string): CreatePageInput {
  return { title: notebook.title, context: { tripId }, content: notebook.content };
}
