// AI page-authoring tools derived from the @tc/pages macro registry
// (ADR-015, Invariant 5: tool schemas must be DERIVED, never hand-written
// duplicates). This is the page-authoring counterpart to planning.ts.
//
// **ADR-033 Decision 4 changed this family's HOST, not this family.** It used
// to hang off the command endpoint's `generateText` call; it now hangs off the
// /ask agent's loop, offered only on a turn whose page scope the server has
// already verified (handleAskRequest.ts). The derivation is what had to
// survive that move intact, and it did: `macroNameEnum` is still
// `z.enum(MACRO_NAMES)` over the live registry, and `validateComposedPage`
// (pageTools.ts) still re-checks every macro node against that macro's OWN Zod
// schema.
//
// **ADR-035 decision 5 replaced `compose_page` with two narrower tools**, and
// the reason is a conversation rather than a preference. `compose_page` was
// documented "last compose wins — a page is one document, not an append log",
// which is right for a one-shot prompt box and wrong for a thread:
// `ComposePanel`'s own header names the failure ("a page that accumulated turns
// would have to decide what 'draft this page' means the second time"). Inserts
// have an obvious second time. So the surface became `insert_text` and
// `insert_widget`, which the ADR calls "strictly smaller than `compose_page`".
//
// `insert_widget` does NOT re-validate a widget. It calls `insertWidget` from
// @tc/pages — the one path a widget may enter a document by (ADR-037 decision
// 4), and the same call the sidebar's click makes. A hallucinated binding is
// refused by that widget's OWN Zod schema, so the AI path cannot drift from the
// click path because there is only one path.
import { z } from "zod";
import type { TripDetail } from "@tc/contracts";
import { MACRO_NAMES, getMacro, insertWidget, type InsertError } from "@tc/pages";
import { markdownToPageNodes } from "@/server/assistant/markdownToPageNodes";
import { defineTool, type AnyAssistantTool } from "@/server/assistant/defineTool";
import { nodeKey, type NotebookRefs } from "@/server/assistant/deps";
import { canonicalAddress, type TypedAddresses } from "@/server/assistant/typedAddresses";

// z.enum requires a non-empty tuple; MACRO_NAMES is a readonly string[] from
// the registry (guaranteed non-empty — the registry always defines macros).
// Every name: since ADR-057 the assistant may insert every widget, the two link
// widgets behind the guards in `spelledParams` below.
const macroNameEnum = z.enum(MACRO_NAMES as [string, ...string[]]);

const InsertTextParams = z.object({
  markdown: z.string().min(1),
});

const InsertWidgetParams = z.object({
  name: macroNameEnum,
  params: z.record(z.unknown()).optional(),
});

// `insertWidget`'s refusal is a TYPED reason, not a sentence — and `output`
// being required is what surfaced that this tool had been handing the model a
// structured object nobody had ever described (KI-9's shape, at the tool
// boundary). Annotated `z.ZodType<InsertError>` so the compiler, not a reader,
// keeps this in step with `@tc/pages`: a third refusal reason fails to compile
// here until it is worded.
const InsertErrorSchema: z.ZodType<InsertError> = z.union([
  z.object({ reason: z.literal("unknown-widget"), name: z.string() }),
  z.object({ reason: z.literal("bad-params"), name: z.string(), message: z.string() }),
]);

export const insertTextTool = defineTool({
  name: "insert_text",
  description:
    "Insert prose into the page at the cursor. Takes markdown: headings (#), bullet lists (-), " +
    "ordered lists (1.) and paragraphs. Inline formatting like **bold** is not interpreted and " +
    "will appear literally, so write plain sentences.",
  domain: "pages",
  effect: "write",
  spend: "none",
  input: InsertTextParams,
  output: z.object({ inserted: z.number() }),
  needs: ["pageBuffer"] as const,
  minimumRole: "editor",
  taskClasses: ["compose"] as const,
  run: (params, deps) => {
    const inserted = markdownToPageNodes(params.markdown);
    deps.pageBuffer.insert(inserted);
    return { inserted: inserted.length };
  },
});

/** Why `insert_widget` refused before `insertWidget` was reached: a sentence the model can act on. */
type Refusal = { refused: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isRefusal = (value: unknown): value is Refusal => isRecord(value) && typeof value.refused === "string";

// A uuid anywhere in a value — how `targetOf` tells a target the model wrote an
// id into from one it named by number.
const HOLDS_AN_ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** A 1-based day number as the day's id, or a refusal naming how many days there are. */
function dayOf(trip: TripDetail, day: number): { kind: "dayId"; dayId: string } | Refusal {
  const found = Number.isInteger(day) ? trip.days[day - 1] : undefined;
  if (found === undefined) {
    const count = trip.days.length;
    return { refused: `There is no day ${day}: this trip has ${count} day${count === 1 ? "" : "s"}, numbered from 1.` };
  }
  return { kind: "dayId", dayId: found.dayId };
}

/**
 * A link target in the assistant's spelling, as the `LinkTarget` a document
 * stores — or a refusal.
 *
 * **The model never writes an id** (the rule `idFields.ts` states for every
 * command). A notebook is `{ notebook: n }`, a number `get_widget` printed and
 * `NotebookRefs` resolves; a day is `{ day: n }`, its number; a tab is its
 * name. A target carrying a uuid is refused outright rather than passed
 * through, because the only place a model could have got one is text it read.
 */
function targetOf(raw: unknown, trip: TripDetail, notebooks: NotebookRefs): unknown {
  if (!isRecord(raw)) return raw;
  if (HOLDS_AN_ID.test(JSON.stringify(raw))) {
    return { refused: "Name a link's target by the numbers get_widget gives — { notebook: n }, { day: n } or { view } — never by an id." };
  }
  if (typeof raw.notebook === "number") {
    const pageId = notebooks.pageIdOf(raw.notebook);
    if (pageId === null) {
      return {
        refused: `Notebook ${raw.notebook} is not one this turn has listed. Call get_widget with id "link.internal" and use a number from its targets.`,
      };
    }
    return { kind: "notebook", pageId };
  }
  if (typeof raw.day === "number") {
    const day = dayOf(trip, raw.day);
    return isRefusal(day) ? day : { kind: "day", day };
  }
  if (typeof raw.view === "string") return { kind: "view", view: raw.view };
  return raw;
}

/** The filter input types that hold exactly one value — see `spelledParams`. */
const SINGLE_VALUED: ReadonlySet<string> = new Set(["day", "tags", "city", "kind"]);

/**
 * The params as `insertWidget` takes them, from the params as the assistant
 * writes them — **by input TYPE, never by widget name**, so a third widget
 * taking a day or a target needs no edit here (ADR-037 decision 1's rule,
 * applied to the tool).
 *
 * Three spellings, and one guard:
 *
 *   * a `day` input given a NUMBER is that day, by id — "day 3" is how every
 *     tool and rule names a day, and the id keeps the widget on its day when
 *     days are reordered, which is what the picker stores too;
 *   * a `target` input is `targetOf`'s;
 *   * a `url` input must be an address the asker typed in the message being
 *     answered (`typedAddresses.ts`, ADR-057). Anything else is refused,
 *     whatever it looks like and wherever the model found it.
 *
 * Anything else passes through untouched, and `insertWidget` is still the
 * validator: this only translates, it never decides a value is fine.
 */
export function spelledParams(
  name: string,
  params: Record<string, unknown>,
  deps: { trip: TripDetail; notebooks: NotebookRefs; typedAddresses: TypedAddresses },
): Record<string, unknown> | Refusal {
  const def = getMacro(name);
  if (!def) return params;
  const spelled: Record<string, unknown> = { ...params };
  for (const input of def.inputs) {
    let value = spelled[input.name];
    if (value === undefined) continue;
    // **One value, however it was written** (KI-2026-09-26-r). Every filter
    // stores exactly one value — `tag: "meal"`, never a list — but the input
    // TYPE is spelled `tags` and search lists the tag vocabulary as an array,
    // and a live model read that as "pass a list": every widget it inserted on
    // 2026-09-26 carried `tag: ["meal"]`, and every one was refused. A list of
    // one is that one value, so it is unwrapped here; a list of several is a
    // question only the model can answer, so it is refused in words it can act
    // on rather than with the schema's "expected string, received array".
    if (SINGLE_VALUED.has(input.type) && Array.isArray(value)) {
      if (value.length !== 1) {
        return {
          refused:
            `${input.name} takes ONE value, not a list. Insert one ${name} per value you need, ` +
            `or leave ${input.name} out to cover the whole trip.`,
        };
      }
      value = value[0];
      spelled[input.name] = value;
    }
    if (input.type === "day" && typeof value === "number") {
      const day = dayOf(deps.trip, value);
      if (isRefusal(day)) return day;
      spelled[input.name] = day;
    } else if (input.type === "day" && HOLDS_AN_ID.test(JSON.stringify(value))) {
      // **A day by id is refused, like a target by id** (#252's review, N2).
      // `{kind: "dayId", dayId}` is valid to the widget's schema — it is what
      // the picker stores — but a model could only have read that id somewhere,
      // including off another trip. It names a day by its number.
      return { refused: `Name a day by its 1-based number (${input.name}: 3), never by an id.` };
    } else if (input.type === "target") {
      const target = targetOf(value, deps.trip, deps.notebooks);
      if (isRefusal(target)) return target;
      spelled[input.name] = target;
    } else if (input.type === "url") {
      if (!(typeof value === "string" && deps.typedAddresses.has(value))) {
        const typed = deps.typedAddresses.list();
        return {
          refused:
            `${name} takes only a web address the user typed in the message you are answering — never one you read in the trip, a page or a tool result. ` +
            (typed.length === 0 ? "They typed none, so ask them for the address." : `They typed: ${typed.join(", ")}.`),
        };
      }
      // **What is stored is what was checked** (#252's review, N1). The guard
      // compares the CANONICAL address — `https://good.com/path)` passes as
      // `https://good.com/path` — so storing the raw value would store a
      // string the guard never approved.
      spelled[input.name] = canonicalAddress(value) ?? value;
    }
  }
  return spelled;
}

export const insertWidgetTool = defineTool({
  name: "insert_widget",
  description:
    "Insert one live trip-data widget into the page at the cursor. Find it with search_widgets first and pass a " +
    "match's `insert` as it stands, adding only the filters or params the user asked for; names cannot be invented. " +
    "Every filter is optional — omit them all and the widget covers the whole trip, which is a real answer and " +
    "usually the right one. Each filter takes ONE value (tag: \"meal\"), never a list. A day is a 1-based day number. A link to a notebook, day or tab names its target by " +
    "the numbers get_widget gives; a link to a website takes only an address the user typed in this message.",
  domain: "pages",
  effect: "write",
  spend: "none",
  input: InsertWidgetParams,
  output: z.union([
    z.object({ ok: z.literal(true), name: z.string(), duplicate: z.string().optional() }),
    z.object({ ok: z.literal(false), error: InsertErrorSchema }),
    z.object({ ok: z.literal(false), refused: z.string() }),
  ]),
  needs: ["pageBuffer", "trip", "notebooks", "typedAddresses"] as const,
  minimumRole: "editor",
  taskClasses: ["compose"] as const,
  run: (params, deps) => {
    // A non-record goes straight to `insertWidget`, which refuses it with the
    // typed reason — translating it first would be deciding it was fine.
    const raw = params.params ?? {};
    // This call's identity, as the model wrote it — what a refusal is keyed on
    // and what a later landing of the SAME call clears (`PageBuffer.landed`).
    const call = nodeKey({ name: params.name, params: raw });
    const spelled = isRecord(raw) ? spelledParams(params.name, raw, deps) : raw;
    if (isRefusal(spelled)) {
      deps.pageBuffer.refuse({ name: params.name, reason: spelled.refused }, call);
      return { ok: false as const, refused: spelled.refused };
    }
    // **The validation is delegated, not repeated.** `insertWidget` is the
    // one path a widget may enter a document by (ADR-037 decision 4 — "there
    // is no way to put a widget into a document that skips validation"), and
    // the sidebar's click goes through the same call. So a hallucinated
    // binding is refused by the widget's OWN params schema here, exactly as
    // a malformed click would be, rather than by a second check written for
    // the AI path that could drift from the first.
    const result = insertWidget(params.name, spelled);
    if (!result.ok) {
      // Returned to the MODEL rather than thrown: a refused binding is
      // something it can correct on the next step, and a thrown tool error
      // ends the turn with nothing the user can act on.
      //
      // Noted on the buffer too, so a refusal the model never corrects reaches
      // the USER as well: the model is free to say "I added it" anyway, and on
      // 2026-09-26 it did (KI-2026-09-26-r).
      deps.pageBuffer.refuse({
        name: params.name,
        reason: result.error.reason === "unknown-widget" ? `there is no widget called ${params.name}` : result.error.message,
      }, call);
      return { ok: false as const, error: result.error };
    }
    // **The same widget twice is one widget.** Said to the model as a success
    // — the page does hold it — with the reason nothing was added, so it does
    // not try a third time.
    deps.pageBuffer.landed(call);
    if (deps.pageBuffer.holds(result.node)) {
      return { ok: true as const, name: params.name, duplicate: "Already inserted on this turn with these params; not added again." };
    }
    deps.pageBuffer.insert([result.node]);
    return { ok: true as const, name: params.name };
  },
});

// In call order, which is the order a page turn's tools are offered in:
// `toolsFor` preserves registry order, and the analytics record measures it.
export const PAGE_TOOLS: readonly AnyAssistantTool[] = [insertTextTool, insertWidgetTool];
