import { newPageDoc, type MacroNode, type PageDoc } from "@tc/contracts";
import { MACRO_NAMES, PRESETS, insertPreset, insertWidget } from "@tc/pages";

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
// - **Renderer fallbacks that print the stored name** (`unknown macro: …`,
//   `bad params: …`) and a stringified object.
//
// What counts as visible: text, plus the attributes a person or a screen reader
// is actually given — `title`, `aria-label`, `placeholder`, `alt`. `data-*` are
// handles, not surface.

/**
 * Every preset as the picker inserts it, and every registered primitive bare —
 * a primitive no preset reaches still renders on a page the assistant wrote.
 */
export function everyWidget(): MacroNode[] {
  return [...PRESETS.map((p) => insertPreset(p.id)), ...MACRO_NAMES.map((name) => insertWidget(name))].map(
    (result) => {
      if (!result.ok) throw new Error(`could not build a widget node: ${JSON.stringify(result.error)}`);
      return result.node;
    },
  );
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

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const RAW_SYNTAX: readonly (readonly [string, RegExp])[] = [
  ...STORED_IDENTIFIERS.map(
    (id) => [`stored identifier ${id}`, new RegExp(`(?<![\\w.-])${escape(id)}(?![\\w-]|\\.\\w)`)] as const,
  ),
  ["{{ }} macro syntax", /\{\{|\}\}/],
  ["[[ ]] link syntax", /\[\[|\]\]/],
  ["@name( call syntax", /@[A-Za-z][\w.]*\(/],
  ["a JSON params blob", /\{\s*"|"\s*:/],
  ["a stringified object", /\[object Object\]/],
  ["a renderer fallback naming the widget", /unknown macro|bad params|no renderer/i],
];

const VISIBLE_ATTRIBUTES = ["title", "aria-label", "placeholder", "alt"] as const;

/** Every visible string under `root` (itself included) that carries syntax, and which. */
export function rawSyntaxLeaks(root: Element): string[] {
  const surfaces: [string, string][] = [];
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
    surfaces.push([`text in <${n.parentElement?.tagName.toLowerCase()}>`, n.textContent ?? ""]);
  }
  for (const el of [root, ...root.querySelectorAll("*")]) {
    for (const attr of VISIBLE_ATTRIBUTES) {
      const value = el.getAttribute(attr);
      if (value) surfaces.push([`${attr} on <${el.tagName.toLowerCase()}>`, value]);
    }
  }
  const found = surfaces.flatMap(([where, text]) =>
    RAW_SYNTAX.filter(([, pattern]) => pattern.test(text)).map(
      ([what]) => `${what} — ${where}: ${JSON.stringify(text)}`,
    ),
  );
  // The whole text too, for a leak split across two text nodes — reported only
  // when no single node already showed it, or one leak prints the page twice.
  const whole = root.textContent ?? "";
  for (const [what, pattern] of RAW_SYNTAX) {
    if (pattern.test(whole) && !found.some((f) => f.startsWith(`${what} — `))) found.push(`${what} — across text nodes`);
  }
  return found;
}
