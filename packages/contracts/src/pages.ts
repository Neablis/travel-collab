import { z } from "zod";

// A day binding. "index" = the Nth day (0-based) of the trip; resolvers map it
// to the day at that position in TripDetail.days. (uuid form reserved for a
// later "pin to a specific day" affordance; index is what templates use now.)
export const DayRef = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("index"), index: z.number().int().nonnegative() }),
  z.object({ kind: z.literal("dayId"), dayId: z.string().uuid() }),
]);
export type DayRef = z.infer<typeof DayRef>;

// A page's binding context. Trip-bound always; optionally day-bound.
export const PageContext = z.object({
  tripId: z.string().uuid(),
  dayRef: DayRef.optional(),
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

export const PageSummary = Page.pick({ id: true, tripId: true, title: true, context: true, updatedAt: true });
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
