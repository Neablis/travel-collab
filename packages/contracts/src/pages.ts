import { z } from "zod";

// A day binding: the value shape of a `day` input inside ONE WIDGET's params
// (ADR-035 decision 3 / SPEC §18). "index" = the Nth day (0-based) of the trip;
// resolvers map it to the day at that position in TripDetail.days. (uuid form
// reserved for a later "pin to a specific day" affordance; index is what the
// registry's day macros take now.)
//
// It lives here rather than in the registry because it crosses the boundary
// twice over: it is written into `MacroNode.attrs.params`, which the AI compose
// path and the editor both produce, and read back by a resolver in @tc/pages.
export const DayRef = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("index"), index: z.number().int().nonnegative() }),
  z.object({ kind: z.literal("dayId"), dayId: z.string().uuid() }),
]);
export type DayRef = z.infer<typeof DayRef>;

// A page is trip-bound and nothing else. It is NOT "about" a day: a page holds
// widgets and each widget owns its own inputs, so two widgets on one page can
// read two different days (SPEC §18, ADR-035 decision 1). `dayRef` used to live
// here; it moved onto the widget instance, where the binding it describes
// actually belongs.
export const PageContext = z.object({
  tripId: z.string().uuid(),
});
export type PageContext = z.infer<typeof PageContext>;

// Macro params are an open bag validated per-macro by the registry (Wave 2).
// The contract only guarantees the node shape; the registry owns param schemas.
export const MacroNode = z.object({
  type: z.literal("macro"),
  attrs: z.object({
    name: z.string().min(1),
    params: z.record(z.unknown()).default({}),
  }),
});
export type MacroNode = z.infer<typeof MacroNode>;

// Page content is ProseMirror/TipTap JSON. We keep it permissive (a doc node)
// so the editor owns the schema; macro nodes embed within it (validated on the
// way in by the editor + on compose by the AI path).
export const PageContent = z.object({
  type: z.literal("doc"),
  content: z.array(z.unknown()).default([]),
}).passthrough();
export type PageContent = z.infer<typeof PageContent>;

export const MacroKind = z.enum(["inline", "block"]);
export type MacroKind = z.infer<typeof MacroKind>;

// What a widget renders AS (ADR-037 decision 1's `shape`). It supersedes
// `MacroKind` for widget definitions: `MacroKind` can say "inline" or "block"
// and has nowhere to put a repeater, which link 6 needs. `MacroKind` stays for
// now because `MacroView`'s older callers and the stored vocabulary still speak
// it; the widget registry speaks this.
export const WidgetShape = z.enum(["single", "block", "repeat"]);
export type WidgetShape = z.infer<typeof WidgetShape>;

export const Page = z.object({
  id: z.string().uuid(),
  tripId: z.string().uuid(),
  title: z.string().min(1),
  context: PageContext,
  content: PageContent,
  createdAt: z.string(),
  updatedAt: z.string(),
  actorId: z.string().min(1),
});
export type Page = z.infer<typeof Page>;

// The actor recorded on lazily seeded default pages. It lives here rather than
// in the server module that writes it because the UI now READS it — the
// provenance line below is "is this row's actorId this sentinel?" — and a
// sentinel compared on both sides of the server/UI wall is a contract, not a
// server detail (AGENTS.md invariant 5). Migration 0005's
// `pages_system_seed_unique` partial index is scoped to exactly this value, so
// changing the string means changing that index too.
export const SYSTEM_ACTOR_ID = "system";

// `actorId` rides along because the Notebook index draws a provenance line
// ("Comes with your trip" vs "Yours", SPEC §7) and the only thing that
// distinguishes the two is whether the row was written by the lazy template
// seeder or by a person. `content` stays off: it is the one field that makes a
// list response unbounded, and nothing in a list renders it.
export const PageSummary = Page.pick({ id: true, tripId: true, title: true, context: true, updatedAt: true, actorId: true });
export type PageSummary = z.infer<typeof PageSummary>;

export const CreatePageInput = z.object({
  title: z.string().min(1),
  context: PageContext,
  content: PageContent,
});
export type CreatePageInput = z.infer<typeof CreatePageInput>;

export const UpdatePageInput = z.object({
  title: z.string().min(1).optional(),
  context: PageContext.optional(),
  content: PageContent.optional(),
});
export type UpdatePageInput = z.infer<typeof UpdatePageInput>;
