import { z } from "zod";
import { ActivityTag } from "./activity";
import { PageDoc } from "./pageDoc";

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

/**
 * A tag binding: the value shape of a `tags` input inside ONE WIDGET's params.
 *
 * Here for the same reason `DayRef` is, and ADR-037 decision 9 says so outright
 * — *"they belong in `packages/contracts` because the editor, the AI path and
 * the resolvers all read them"*. It was declared locally inside `stop.line`
 * instead, so those three could have drifted on a value that is persisted in
 * every document carrying that widget. Found by Copilot on PR 139.
 *
 * **Absent is a real answer meaning "every stop", not "not configured."** SPEC
 * §18's table reads *"every stop, or one"*, so a widget with no tag bound is
 * finished rather than waiting — which is why `stop.line` is useful the moment
 * it is pointed at a day.
 *
 * **This is narrower than decision 9's own row**, which reads `"all" |
 * ActivityTag[]`. §18 (2026-09-03) is the later document and asks for one tag or
 * none; a set-valued binding needs a control that can express a set, and nothing
 * in the design shows one. Recorded in the ADR rather than settled here — if the
 * set form is wanted, this is the one place it widens.
 */
export const TagRef = ActivityTag;
export type TagRef = z.infer<typeof TagRef>;

// A page is trip-bound and nothing else. It is NOT "about" a day: a page holds
// widgets and each widget owns its own inputs, so two widgets on one page can
// read two different days (SPEC §18, ADR-035 decision 1). `dayRef` used to live
// here; it moved onto the widget instance, where the binding it describes
// actually belongs.
export const PageContext = z.object({
  tripId: z.string().uuid(),
});
export type PageContext = z.infer<typeof PageContext>;

// Page content ON THE WAY OUT, and it stays permissive ON PURPOSE.
//
// ADR-038's consequences say "`PageContent`'s `passthrough()` and
// `z.unknown()` go". They go from the WRITE path — see `CreatePageInput` and
// `UpdatePageInput` below, which are `PageDoc` now. They cannot go from the
// read path, and the reason is decision 4 itself: a page whose stored document
// this build cannot parse is exactly the page the reader must be shown a
// read-only explanation for. A strict `Page.content` would make `fetchPage`
// throw on that row instead, and the user would get "Something went wrong"
// for a notebook that is, as far as anyone can tell, simply gone.
//
// So the asymmetry is the design, not a leftover: **read what is there, write
// only what we understand.** It is also what makes the guard possible at all —
// you cannot explain a document you refused to deliver.
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

// The write path is `PageDoc`, not `PageContent` (ADR-038 decisions 2 and 4).
// A document this build cannot parse is a document it cannot save losslessly,
// and "a page that cannot be saved losslessly is a page that must not be saved
// at all" is the one rule decision 4 would not trade away. Enforcing it here
// rather than only in the browser means it holds for the AI compose path, the
// template seeder and anything that reaches the route later.
//
// `PageDoc.v` defaults to 1, so a client that sends a bare `getJSON()` document
// still parses — and comes back out of `serializePageDoc` stamped, which is
// decision 2's "written on every save".
export const CreatePageInput = z.object({
  title: z.string().min(1),
  context: PageContext,
  content: PageDoc,
});
export type CreatePageInput = z.infer<typeof CreatePageInput>;

export const UpdatePageInput = z.object({
  title: z.string().min(1).optional(),
  context: PageContext.optional(),
  content: PageDoc.optional(),
});
export type UpdatePageInput = z.infer<typeof UpdatePageInput>;
