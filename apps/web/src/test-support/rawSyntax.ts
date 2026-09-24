import { REPEAT_SCOPE_ORDER, newPageDoc, type MacroNode, type PageDoc, type PageRepeatNode } from "@tc/contracts";
import {
  MACRO_NAMES, PRESETS, REPEAT_WIDGETS, insertPreset, insertRepeat, insertWidget, sentenceFields, type RepeatValue,
} from "@tc/pages";

// The M14 gate box: *"No user-visible macro syntax anywhere, in either mode. A
// test fails if raw syntax reaches the DOM."* SPEC §7: users never see or type
// macro syntax — a widget is a value reading as a word, and its identity lives
// in the stored node, not on the screen. Shared so every surface a widget can
// reach asks the same question (`noRawSyntax.test.tsx`, `PageScreen.test.tsx`).
//
// "Syntax" is read off what the stored and serialised forms could leak, not
// guessed:
//
// - **A stored widget name or preset id** (`cost.rows`, `day.detail`,
//   `still-to-book`) and a stored param VALUE that is a path (`trip.countdown`).
//   These are ADR-037 decision 8's stored identifiers — kept forever, never
//   shown. Only the dotted/hyphenated ones are checked, because `cost`, `city`
//   and `count` are also English, and a page that says "cost" is not leaking.
// - **The params blob.** `MacroNodeExtension` serialises params as JSON into
//   `data-macro-params`, which is not visible; the same JSON as TEXT is.
// - **The syntaxes this app has had or been asked about**: M8's `{{…}}`, wiki
//   `[[…]]`, and `@name(…)`.
// - **A repeat's sentence as the author wrote it** (`{name}`), which belongs in
//   the settings panel's text field and nowhere on the page.
// - **Renderer fallbacks that print the stored name** (`unknown macro: …`,
//   `bad params: …`) and a stringified object.
//
// - **A segment name as a whole attribute.** A chip's `name` (`value`, `city`,
//   `label`) says which part of a widget's output it is, for the renderer. It
//   was the chip's `title`, so hovering "$45.00" showed a tooltip reading
//   "value" (Mitchell, PR #221 preview). Only an attribute that IS the bare
//   name is flagged: "value" and "city" are English, and a sentence using them
//   is not a leak.
//
// What counts as visible: text, plus the attributes a person or a screen reader
// is actually given — `title`, `aria-label`, `placeholder`, `alt`. `data-*` are
// handles, not surface.

/**
 * Every preset as the picker inserts it, and every registered primitive bare —
 * a primitive no preset reaches still renders on a page the assistant wrote.
 */
export function everyWidget(): MacroNode[] {
  return [...WIDGET_PRESETS.map((p) => insertPreset(p.id)), ...MACRO_NAMES.map((name) => insertWidget(name))].map(
    (result) => {
      if (!result.ok) throw new Error(`could not build a widget node: ${JSON.stringify(result.error)}`);
      return result.node as MacroNode;
    },
  );
}

/** Every preset that inserts a widget; the one left inserts an authored repeat (`everyRepeat`). */
export const WIDGET_PRESETS = PRESETS.filter((p) => !p.repeat);

/**
 * A sentence for each day, each stop and each city, every one naming every
 * field its collection publishes — and braces the grammar prints as text, so a
 * page that showed the template rather than the lines would show a token.
 */
export function everyRepeat(): PageRepeatNode[] {
  return REPEAT_SCOPE_ORDER.map((over) => {
    const tokens = sentenceFields(over).map((field) => `{${field.key}}`).join(" · ");
    const result = insertRepeat(REPEAT_WIDGETS[over], { template: `Each {{literal}} ${tokens} }}{{ {` });
    if (!result.ok) throw new Error(`could not build a repeat over ${over}: ${JSON.stringify(result.error)}`);
    return result.node;
  });
}

/** A page holding a sentence for each day, stop and city, each naming every field it can. */
export function everyRepeatPage(): PageDoc {
  return newPageDoc(everyRepeat());
}

/** A page holding every widget, each in a sentence of its own — so a leak is also a leak mid-prose. */
export function everyWidgetPage(): PageDoc {
  return newPageDoc(
    everyWidget().map((node) => ({
      type: "paragraph" as const,
      content: [{ type: "text" as const, text: "Before " }, node, { type: "text" as const, text: " after." }],
    })),
  );
}

const stringsIn = (value: unknown): string[] =>
  typeof value === "string"
    ? [value]
    : Array.isArray(value)
      ? value.flatMap(stringsIn)
      : typeof value === "object" && value !== null
        ? Object.values(value).flatMap(stringsIn)
        : [];

export const STORED_IDENTIFIERS: readonly string[] = [
  ...new Set([...MACRO_NAMES, ...PRESETS.map((p) => p.id), ...PRESETS.flatMap((p) => stringsIn(p.params))]),
].filter((s) => /[.\-_]/.test(s));

// Every key a sentence can name, over any collection.
const SENTENCE_KEYS = [...new Set(REPEAT_SCOPE_ORDER.flatMap((over) => sentenceFields(over).map((field) => field.key)))];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const RAW_SYNTAX: readonly (readonly [string, RegExp])[] = [
  ...STORED_IDENTIFIERS.map(
    (id) => [`stored identifier ${id}`, new RegExp(`(?<![\\w.-])${escape(id)}(?![\\w-]|\\.\\w)`)] as const,
  ),
  ["{{ }} macro syntax", /\{\{|\}\}/],
  // A repeat's sentence as written: a token for a field some collection
  // publishes. The page prints the value; only the settings field holds this.
  ["a sentence token", new RegExp(`\\{(${SENTENCE_KEYS.join("|")})\\}`)],
  ["[[ ]] link syntax", /\[\[|\]\]/],
  ["@name( call syntax", /@[A-Za-z][\w.]*\(/],
  ["a JSON params blob", /\{\s*"|"\s*:/],
  ["a stringified object", /\[object Object\]/],
  ["a renderer fallback naming the widget", /unknown macro|bad params|no renderer/i],
];

// Keyed by the type, so a segment name added to `RepeatValue` fails to compile
// here until the guard knows it. `chip()` takes any string, but every name a
// resolver passes it today is one of these.
const SEGMENT_NAMES: Record<RepeatValue["name"], true> = { label: true, value: true, city: true };

/** The category a bare segment name in a visible attribute is reported under. */
export const SEGMENT_NAME_LEAK = "an internal segment name as an attribute";

const VISIBLE_ATTRIBUTES = ["title", "aria-label", "placeholder", "alt"] as const;

/** Every visible string under `root` (itself included) that carries syntax, and which. */
export function rawSyntaxLeaks(root: Element): string[] {
  const surfaces: [string, string][] = [];
  const segmentLeaks: string[] = [];
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
    surfaces.push([`text in <${n.parentElement?.tagName.toLowerCase()}>`, n.textContent ?? ""]);
  }
  for (const el of [root, ...root.querySelectorAll("*")]) {
    for (const attr of VISIBLE_ATTRIBUTES) {
      const value = el.getAttribute(attr);
      if (value) surfaces.push([`${attr} on <${el.tagName.toLowerCase()}>`, value]);
      if (value && Object.hasOwn(SEGMENT_NAMES, value.trim())) {
        segmentLeaks.push(`${SEGMENT_NAME_LEAK} — ${attr} on <${el.tagName.toLowerCase()}>: ${JSON.stringify(value)}`);
      }
    }
  }
  const found = [
    ...segmentLeaks,
    ...surfaces.flatMap(([where, text]) =>
      RAW_SYNTAX.filter(([, pattern]) => pattern.test(text)).map(
        ([what]) => `${what} — ${where}: ${JSON.stringify(text)}`,
      ),
    ),
  ];
  // The whole text too, for a leak split across two text nodes — reported only
  // when no single node already showed it, or one leak prints the page twice.
  const whole = root.textContent ?? "";
  for (const [what, pattern] of RAW_SYNTAX) {
    if (pattern.test(whole) && !found.some((f) => f.startsWith(`${what} — `))) found.push(`${what} — across text nodes`);
  }
  return found;
}
