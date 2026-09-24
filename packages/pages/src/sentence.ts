import { REPEAT_SCOPES, parseSentenceTemplate, type SentencePart } from "@tc/contracts";
import type { ItemScope, WidgetContext } from "./registry-types";
import { fieldAt, fieldChoices, formatStopField, type FieldChoice } from "./fields";
import { formatKind, formatKindList, type KindContext } from "./kinds";
import type { RepeatOver } from "./repeat";

// What a repeat's sentence prints on one line: every `{key}` token read off
// that line's day, stop or city, through the manifest and the value-kind
// formatters every other field goes through.
//
// **The security model is the shape of the output.** A line is a plain string
// built from the parsed template's text and each field's FORMATTED value, and
// it reaches the page as a React text node, which escapes it. Nothing here
// builds markup, and nothing reads a resolved value a second time: the template
// is parsed once, before any value exists, so a stop named `{name}` or
// `<img onerror=…>` prints exactly those characters.

/** A field a sentence over one collection can print: its token key, and the manifest choice behind it. */
export interface SentenceField extends FieldChoice {
  /** What the template stores between the braces: the manifest path, less the collection's prefix. */
  key: string;
}

/**
 * Every field a sentence over `over` can name, in manifest order — what the
 * settings panel offers as insertable details, by `label`.
 *
 * The manifest's own list for the item, so a field hidden from pickers
 * (`HIDDEN_STOP_FIELDS`) is hidden here too, and a newly annotated one arrives
 * without a line of code.
 */
export function sentenceFields(over: RepeatOver): SentenceField[] {
  const { object, prefix } = REPEAT_SCOPES[over];
  return fieldChoices(object)
    .filter((choice) => choice.path.startsWith(prefix))
    .map((choice) => ({ ...choice, key: choice.path.slice(prefix.length) }));
}

/** The published field a token names in a sentence over `over`, or `undefined` — read through `fieldAt`, the typed gate. */
export function sentenceFieldAt(over: RepeatOver, key: string): FieldChoice | undefined {
  const { object, prefix } = REPEAT_SCOPES[over];
  return fieldAt(object, prefix + key);
}

/**
 * What a line prints where an item has no value for a field: a day with no
 * date, a stop with no cost. A dash, so the sentence visibly has a gap rather
 * than silently closing up around it.
 */
export const SENTENCE_NO_VALUE = "—";

// One collection member's value, formatted by its kind; `null` for no value.
function formatMember(choice: FieldChoice, raw: unknown, ctx: KindContext): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (Array.isArray(raw)) return raw.length === 0 ? null : formatKindList(choice.valueKind, raw as never[], ctx);
  // The cast is the manifest's promise: `valueKind` was read off the schema the value was parsed with.
  return formatKind(choice.valueKind, raw as never, ctx);
}

function itemValue(ctx: WidgetContext, item: ItemScope, choice: FieldChoice): string | null {
  const kindCtx: KindContext = { currency: ctx.trip?.currency ?? "USD" };
  const field = choice.path.slice(choice.path.lastIndexOf(".") + 1);
  switch (item.kind) {
    case "day": {
      const day = ctx.globals?.days.find((d) => d.index === item.index);
      return day ? formatMember(choice, (day as Record<string, unknown>)[field], kindCtx) : null;
    }
    case "city": {
      const city = ctx.globals?.cities.find((c) => c.name === item.name);
      return city ? formatMember(choice, (city as Record<string, unknown>)[field], kindCtx) : null;
    }
    case "stop": {
      const activity = ctx.trip?.activities[item.activityId];
      return activity ? formatStopField(choice, [activity], kindCtx) : null;
    }
  }
}

// A token's field, resolved once per sentence rather than once per line:
// `fieldAt` rebuilds the manifest by reflection on every call, so a stop
// sentence with four tokens on an 80-stop trip built it 320 times a render.
type ResolvedPart = { text: string } | { field: string; choice: FieldChoice | undefined };

function resolveParts(over: RepeatOver, parts: readonly SentencePart[]): ResolvedPart[] {
  return parts.map((part) => ("text" in part ? part : { field: part.field, choice: sentenceFieldAt(over, part.field) }));
}

function printLine(ctx: WidgetContext, item: ItemScope, parts: readonly ResolvedPart[]): string {
  return parts
    .map((part) => {
      if ("text" in part) return part.text;
      if (!part.choice) return `{${part.field}}`;
      return itemValue(ctx, item, part.choice) ?? SENTENCE_NO_VALUE;
    })
    .join("");
}

/**
 * One line of a sentence over `over`, for `item`. Text parts print as they are,
 * a token prints its field's value (or `SENTENCE_NO_VALUE`), and a token whose
 * key this collection does not publish prints as the author wrote it.
 */
export function sentenceLine(
  ctx: WidgetContext,
  over: RepeatOver,
  item: ItemScope,
  parts: readonly SentencePart[],
): string {
  return printLine(ctx, item, resolveParts(over, parts));
}

/** Every line of a sentence: its template parsed and its fields resolved once, then printed per item. */
export function sentenceLines(
  ctx: WidgetContext,
  over: RepeatOver,
  items: readonly ItemScope[],
  template: string,
): string[] {
  const parts = resolveParts(over, parseSentenceTemplate(template));
  return items.map((item) => printLine(ctx, item, parts));
}
