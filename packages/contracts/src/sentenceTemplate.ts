import { z } from "zod";
import type { ManifestObject } from "./manifest.ts";

// The authored repeat's sentence, as the one string an author writes
// (Mitchell's preview comment on PR #221, 2026-09-24): *"Welcome to {name}"*,
// printed once per day, stop or city with each token read off that line's item.
//
// **The grammar**, and all of it:
//
// - `{key}` is a field token: one brace, a key, one brace. A key is a letter
//   followed by letters and digits — the spelling of every manifest field name.
// - `{{` is a literal `{` and `}}` a literal `}`.
// - Anything else — a lone brace, `{ key }`, `{}`, `{a.b}` — is literal text.
//
// So parsing cannot fail. A malformed brace is prose the author typed, and an
// unknown key is prose too; the resolver prints both as written. Neither is an
// error and neither is dropped.
//
// **Why it lives in `packages/contracts` rather than beside the resolver.** It is
// part of the stored format — a field rename has to rewrite the tokens in every
// stored sentence (`FIELD_CHANGES`, `pageDoc.ts`) — and this package may not
// import `@tc/pages`. The same reason `WIDGET_NAME_MIGRATION` lives here. One
// parser, so the migration and the renderer cannot read a sentence differently.

/** The longest sentence the params schema accepts. A sentence, not a document. */
export const SENTENCE_TEMPLATE_MAX = 500;

/** A repeat's `template` param: one line, at most `SENTENCE_TEMPLATE_MAX` characters. */
export const SentenceTemplate = z
  .string()
  .max(SENTENCE_TEMPLATE_MAX)
  .regex(/^[^\r\n]*$/, "a sentence is one line");

/** One piece of a parsed sentence: literal text, or the field a token names. */
export type SentencePart = { text: string } | { field: string };

const KEY = /^[A-Za-z][A-Za-z0-9]*$/;
const TOKEN = /^\{([A-Za-z][A-Za-z0-9]*)\}/;

/**
 * A sentence as text and field parts. Never throws, whatever the string.
 *
 * Adjacent text is merged and empty text is never emitted, so two strings that
 * read the same parse to the same parts — which is what makes
 * `parse(serialize(parse(s)))` equal `parse(s)`.
 */
export function parseSentenceTemplate(template: string): SentencePart[] {
  const parts: SentencePart[] = [];
  let text = "";
  let i = 0;
  while (i < template.length) {
    const ch = template[i]!;
    if (ch === "{" || ch === "}") {
      if (template[i + 1] === ch) {
        text += ch;
        i += 2;
        continue;
      }
      const token = ch === "{" ? TOKEN.exec(template.slice(i)) : null;
      if (token) {
        if (text !== "") parts.push({ text });
        text = "";
        parts.push({ field: token[1]! });
        i += token[0].length;
        continue;
      }
    }
    text += ch;
    i += 1;
  }
  if (text !== "") parts.push({ text });
  return parts;
}

/** Literal text as the template spells it: every brace doubled. */
export function escapeSentenceText(text: string): string {
  return text.replace(/[{}]/g, (brace) => brace + brace);
}

/**
 * The template that parses back to `parts`. A field part whose key is not a
 * key (it did not come from the parser) is written as the literal text it
 * would have been, so the result never holds a token nobody asked for.
 */
export function serializeSentenceTemplate(parts: readonly SentencePart[]): string {
  return parts
    .map((part) =>
      "field" in part
        ? KEY.test(part.field)
          ? `{${part.field}}`
          : escapeSentenceText(`{${part.field}}`)
        : escapeSentenceText(part.text),
    )
    .join("");
}

/**
 * What a repeat iterates, keyed by the word an author picks: the rows primitive
 * whose selection it borrows (`widget`), and where that item's fields sit in the
 * attribute manifest. A token's key is a manifest path with `prefix` taken off —
 * `{name}` in a city sentence is `trip.cities.name` — so the sentence vocabulary
 * is the manifest's, not a second list.
 */
export const REPEAT_SCOPES = {
  day: { widget: "day.rows", object: "trip", prefix: "trip.days." },
  stop: { widget: "stop.rows", object: "stop", prefix: "stop." },
  city: { widget: "city.rows", object: "trip", prefix: "trip.cities." },
} as const satisfies Record<string, { widget: string; object: ManifestObject; prefix: string }>;

export type RepeatScope = keyof typeof REPEAT_SCOPES;

/** The order a picker lists the scopes in. */
export const REPEAT_SCOPE_ORDER: readonly RepeatScope[] = ["day", "stop", "city"];

/** The scope a stored repeat name iterates, or `null` for a name that is not one. */
export function repeatScopeOf(widget: string): RepeatScope | null {
  return REPEAT_SCOPE_ORDER.find((scope) => REPEAT_SCOPES[scope].widget === widget) ?? null;
}
