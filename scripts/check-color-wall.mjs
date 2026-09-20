import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

// THE COLOR WALL (design-system.md "Enforcement"): raw color literals live in
// exactly one file. Files on the pending list are pre-M5 surfaces awaiting
// re-skin; the list only ever shrinks (deleted by the task that re-skins them).
//
// lib/sparklineColor.ts used to be a second, deliberate exception alongside
// globals.css (an 8-hue hashed palette for the home hero's sparkline). It's
// gone: the sparkline now colors by dayAccents' 5 semantic families, same as
// every other city-accented surface, so it needs no raw-hex exception of its
// own anymore (Mitchell, 2026-08-25 — one city, one color, everywhere).
//
// SINCE 2026-09-19 THIS SCRIPT IS TWO WALLS, not one. The value wall below is
// the original: a color that should have been a token. The TOKEN wall further
// down is its mirror image — a token NAME that is not one. See its own header.
const pending = new Set(JSON.parse(readFileSync("scripts/design-wall-pending.json", "utf8")));
// Third-party generated files that are permanently out of scope because they
// are not product UI at all — NOT the same concept as `pending` above. That
// list is legacy debt we are paying down and only ever shrinks; this one is
// scaffolding nobody hand-authors and nobody will ever re-skin, so it never
// shrinks either (KI-51 records the distinction). Keep this list to files
// that are wizard/codegen output, never a convenient place to park a raw
// color someone didn't want to fix.
// The colour-space conversion and its test, where a literal is the SUBJECT
// rather than a design decision. `mapColor.ts` converts `oklch()` into
// `#rrggbb` because MapLibre parses CSS Color 3 only and renders anything else
// black in silence (KI-2026-09-19-f); its test anchors on the three published
// sRGB primaries, which are the only values that make it more than a tautology.
//
// A FOURTH list, kept apart from `pending` (which only shrinks) and
// `generatedNonProduct` (which never does) for the reason KI-51 records: lists
// with different rules that get merged stop meaning anything. This one is
// closed — the wall's point is that no OTHER file gets to decide a colour, and
// a module that exists to produce colour strings is not an exception to that,
// it is the mechanism by which tokens reach a surface that cannot read them.
const colorMath = new Set([
  "apps/web/src/components/lenses/mapColor.ts",
  "apps/web/src/components/lenses/mapColor.test.ts",
  // Asserts that every token in `globals.css` still lands on CSS Color 3 after
  // conversion, which means naming the ACCEPTED SHAPES in a regex — and a
  // character class spelling `#[0-9a-f]{3,8}` reads to this wall exactly like
  // the hex literal it is built to reject.
  "apps/web/src/components/lenses/mapTokens.test.ts",
]);

const generatedNonProduct = new Set([
  // Sentry's `npx @sentry/wizard` scaffold — a throwaway route for verifying
  // error capture, not a page a user ever sees. Its `<style jsx>` block ships
  // Sentry's own brand colors, not ours (landed via 6a5501e, pushed directly
  // to main without a PR review — docs/guidelines/ci-cost-and-capacity.md).
  "apps/web/src/app/sentry-example-page/page.tsx",
]);
// --others --exclude-standard adds untracked-but-not-ignored files to the
// tracked (--cached) list: a brand-new file was invisible to the wall until it
// was staged (KI-51), which is exactly the file most likely to carry a raw
// color. --exclude-standard keeps .gitignore honoured, so node_modules/.next/generated
// output stay out — walking the tree naively would not. Set dedupes the stage
// 1/2/3 duplicates --cached emits for unmerged paths mid-conflict.
const files = [
  ...new Set(
    execSync(
      "git ls-files --cached --others --exclude-standard 'apps/web/src/**/*.ts' 'apps/web/src/**/*.tsx' 'apps/web/src/**/*.css'",
      { encoding: "utf8" },
    )
      .split("\n")
      .filter(Boolean),
  ),
]
  .sort()
  .filter(
    (f) =>
      f !== "apps/web/src/app/globals.css" &&
      !pending.has(f) &&
      !generatedNonProduct.has(f) &&
      !colorMath.has(f),
  );

// A `#` followed by 3-8 hex digits is only unambiguously a color when at least
// one of those digits is a letter (`#0c6b58`, `#FFF`) — that case is always a
// violation, wherever it sits. When every digit is decimal the token is equally
// a CSS grey (`#111`) and a GitHub reference, and from PR #100 onward
// (2026-08-30) every pull-request number this repo mints is also a valid 3-to-8
// digit hex string — so the old single `\b` match flagged code comments citing
// a pull request with no color anywhere near them (KI-20260830). Settle the
// ambiguous case by context instead: a color that actually reaches the UI is
// quoted, bracketed, or follows `:` / `=` / `,` (`color: #111`, `"#111"`,
// `bg-[#111]`, `var(--x, #111)`). Prose ("review on PR #100") has none of those
// in front of it. Accepted residual: an all-decimal hex written bare in a
// prose-like position (`// grey is #222`) is not flagged; anything containing
// a-f still always is, so no real palette value can slip through.
//
// Those anchors all assume the color is the FIRST token of its value, and in a
// CSS shorthand it is not: `border: 1px solid #100` and
// `box-shadow: 0 1px 2px #100` put a space in front of the `#`, so the
// narrowing above let a genuine raw color straight through (CodeRabbit, PR
// #123). The second matcher closes that without giving the PR reference back,
// by looking at the token immediately BEFORE the `#`: a CSS line-style keyword
// or a length is a value, `PR` and `issue` are not. It is deliberately not "any
// preceding word" and not "any preceding bare number" — `M17 #112` and
// `in 2026 #100` are prose this repo actually writes, and both end in a digit.
const CSS_LINE_STYLE = String.raw`\b(?:solid|dashed|dotted|double|groove|ridge|inset|outset)`;
// `0` is the one unitless CSS length (`box-shadow: 0 0 #100`); every other
// number has to carry a unit to count, which is what keeps `M17` out.
const CSS_LENGTH = String.raw`(?:\b0|\d(?:\.\d+)?(?:px|rem|em|ex|ch|vh|vw|vmin|vmax|pt|pc|in|cm|mm|q|%))`;
const hexWithLetter = /#(?=[0-9]*[a-fA-F])[0-9a-fA-F]{3,8}\b/;
const decimalHexInColorContext = /[:=,[`'"]\s*#[0-9]{3,8}\b/;
const decimalHexAfterCssValueToken = new RegExp(
  String.raw`(?:${CSS_LINE_STYLE}|${CSS_LENGTH})\s+#[0-9]{3,8}\b`,
  "i",
);
const functionalColor = /\brgba?\(|\bhsla?\(/;
const isColorLiteral = (line) =>
  hexWithLetter.test(line) ||
  decimalHexInColorContext.test(line) ||
  decimalHexAfterCssValueToken.test(line) ||
  functionalColor.test(line);
const arbitraryValue = /className={?["'`][^"'`]*\[/;

// ---------------------------------------------------------------------------
// THE TOKEN WALL (KI-2026-09-19-g)
//
// The wall above catches a color VALUE that should have been a token. It is
// silent — by construction, not by oversight — about a token NAME that is not
// one. `globals.css` opens with `--color-*: initial`, which wipes Tailwind's
// default palette, so `bg-brand-subtle`, `text-muted` or `bg-amber-50` emit no
// rule at all: the box ships with no background and reads as a rendering bug.
// Nothing else in the repo can see this. ESLint has no opinion on a class
// name; jsdom has no layout and the lint wall refuses `toHaveClass`, so no test
// layer can hold the claim that a box has a background. The only detector was a
// person looking at a preview, and that is how M23 shipped a selected chip with
// a transparent background (docs/STATUS.md; the comment at ui/toggle-chip.tsx
// records the incident at the scene).
//
// So: read the names `@theme` actually defines and fail on a utility in a
// color-carrying namespace that is not among them.
// ---------------------------------------------------------------------------

const globalsCss = readFileSync("apps/web/src/app/globals.css", "utf8");

// Only `@theme` mints a utility. `globals.css` also restates many of the same
// `--color-*` names inside `html[data-look=…]` blocks, and those are look
// overrides of a token that already exists — a name that appeared ONLY there
// would yield no utility, so parsing the whole file would accept a class that
// renders nothing. Braces are matched rather than regexed because `@theme`
// blocks contain nested rules.
const themeTokens = (family) => {
  const names = new Set();
  const blockStart = /@theme[^{]*\{/g;
  let opener;
  while ((opener = blockStart.exec(globalsCss)) !== null) {
    let depth = 1;
    let i = blockStart.lastIndex;
    while (depth > 0 && i < globalsCss.length) {
      if (globalsCss[i] === "{") depth += 1;
      else if (globalsCss[i] === "}") depth -= 1;
      i += 1;
    }
    const body = globalsCss.slice(blockStart.lastIndex, i - 1);
    for (const m of body.matchAll(new RegExp(String.raw`^\s*--${family}-([a-z0-9-]+)\s*:`, "gm"))) {
      names.add(m[1]);
    }
  }
  return names;
};
const colorTokens = themeTokens("color");
// `text-*` is the one namespace that is two families at once: `--color-ink`
// gives `text-ink` and `--text-sm` gives `text-sm`. Tailwind emits the paired
// `--text-sm--line-height` / `--letter-spacing` under the same prefix, and
// those are modifiers of a size rather than sizes, so they are dropped here.
const textSizeTokens = new Set([...themeTokens("text")].filter((n) => !n.includes("--")));
if (colorTokens.size === 0 || textSizeTokens.size === 0) {
  console.error("token wall: parsed no tokens out of globals.css — the @theme parse is broken");
  process.exit(1);
}

// The namespaces checked. `bg`/`text`/`border` are what KI-2026-09-19-g names;
// `ring`/`outline`/`fill`/`stroke`/`divide` are added because they carry color
// too and the tree already uses tokens in all five (`ring-brand`,
// `outline-brand`, `fill-surface`, `stroke-hairline`, `divide-hairline`) — a
// typo there loses a focus ring or a map stroke just as silently.
//
// `from-`/`via-`/`to-` are deliberately NOT here. They are gradient stops, and
// English prose written in this repo collides with them constantly — `to-now`,
// `to-the-line`, `to-json-schema` and `to-create` are all real strings in
// `apps/web/src` today. A wall that cries wolf gets an exception list bolted on
// and then gets ignored, which is the failure mode this one exists to avoid.
// `shadow-` is out for the same reason in miniature: `--shadow-*` tokens live
// alongside Tailwind's own surviving `shadow-sm`/`shadow-inner` scale, and no
// defect has ever been found there.
const KEYWORDS = new Set(["inherit", "current", "transparent", "none"]);
const BORDER_SIDE = /^(t|r|b|l|x|y|s|e)(-|$)/;
const nonColorUtility = {
  bg: (s) =>
    /^(clip|origin|blend|gradient|linear|radial|conic|position|size)-/.test(s) ||
    ["fixed", "local", "scroll", "auto", "cover", "contain", "repeat", "no-repeat", "repeat-x", "repeat-y", "repeat-round", "repeat-space"].includes(s) ||
    /^(top|bottom|left|right|center)(-(top|bottom|left|right))?$/.test(s),
  text: (s) =>
    textSizeTokens.has(s) ||
    ["left", "center", "right", "justify", "start", "end", "ellipsis", "clip", "wrap", "nowrap", "balance", "pretty"].includes(s) ||
    s.startsWith("shadow"),
  border: (s) => ["solid", "dashed", "dotted", "double", "hidden", "collapse", "separate", "box"].includes(s) || /^\d+$/.test(s) || s.startsWith("spacing-"),
  ring: (s) => /^\d+$/.test(s) || s === "inset" || s.startsWith("offset"),
  outline: (s) => /^\d+$/.test(s) || s.startsWith("offset") || ["solid", "dashed", "dotted", "double", "hidden"].includes(s),
  fill: () => false,
  stroke: (s) => /^\d+$/.test(s),
  divide: (s) => ["solid", "dashed", "dotted", "double"].includes(s) || /^\d+$/.test(s),
};
const tokenUtility = new RegExp(
  String.raw`(?<![\w-])(${Object.keys(nonColorUtility).join("|")})-([a-zA-Z0-9][a-zA-Z0-9-]*)`,
  "g",
);

// Vocabulary from outside this app that happens to spell a utility. Keep this
// list to strings that are provably not class names — it is a THIRD list and
// must not be merged into `pending` (which only shrinks) or
// `generatedNonProduct` (which never does): this one grows only when a
// dependency introduces a colliding word. KI-51 records why the lists stay apart.
// CSS property names wear the same shape as a utility. A real declaration is
// caught by the colon rule below, but a property name QUOTED or written into a
// regex is not — `assistant/transcriptLook.test.ts` asserts that no look's
// stylesheet sets `border-radius`, and matches on the bare word. Allowing the
// handful of property names in these namespaces costs nothing: none of them is
// a Tailwind utility, so nothing real hides behind the exemption.
const cssPropertyName = new Set([
  "border-radius", "border-width", "border-style", "border-color", "border-image", "border-spacing",
  "text-align", "text-decoration", "text-transform", "text-indent", "text-overflow", "text-rendering",
  "outline-color", "outline-style", "outline-width",
  "fill-opacity", "fill-rule", "stroke-width", "stroke-opacity", "stroke-dasharray", "stroke-linecap", "stroke-linejoin",
]);

const notAClassName = new Set([
  // The AI SDK's stream-chunk vocabulary, asserted ~15 times in the ask route's
  // integration tests (`type: "text-delta"`). Its siblings `text-start` and
  // `text-end` need no entry — they are real text-align utilities and pass.
  "text-delta",
]);

// A comment is where this repo records the defect it is warning the next reader
// about, so the token wall must not read them: `ui/toggle-chip.tsx` names
// `bg-brand-subtle`/`text-muted` in prose precisely because they were wrong,
// `pages/PageScreen.tsx` names `bg-amber-50` for the same reason, and
// `pages/cityAccents.ts` says in as many words that there is no
// `--color-brand-ink`. Flagging those would delete the institutional memory
// this wall is built on. Comments are blanked rather than removed so line
// numbers in the report still point at the file, and `//` opens nothing at all
// in CSS.
//
// **The scan is string-aware rather than a regex.** It used to be
// `/(^|[^:])\/\/.*$/`, which protected `https://` by refusing a `//` preceded
// by a colon — but that is a guess about one spelling, and it missed every
// other `//` inside a string: a PROTOCOL-RELATIVE url (`"//cdn.example.com"`),
// or any string that simply contains two slashes. On those lines everything
// after the quote was discarded, so a real bad token sitting later on the line
// was never scanned and the wall passed on a defect. CodeRabbit found it on
// PR 196, and found too that the test covering this could not have caught it:
// the token after the url was a VALID one, so the assertion held either way.
const stripLineComment = (line) => {
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote !== null) {
      // A backslash escapes the next character, including a closing quote.
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "/" && line[i + 1] === "/") return line.slice(0, i);
  }
  return line;
};

const stripComments = (source, isCss) => {
  let out = source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  if (!isCss) {
    out = out.split("\n").map(stripLineComment).join("\n");
  }
  return out;
};

const isDefinedToken = (prefix, suffix) => {
  if (notAClassName.has(`${prefix}-${suffix}`) || cssPropertyName.has(`${prefix}-${suffix}`)) return true;
  if (colorTokens.has(suffix) || KEYWORDS.has(suffix)) return true;
  if (nonColorUtility[prefix](suffix)) return true;
  // `border-t-hairline` and `divide-y-2` put a side between the prefix and the
  // value, and a bare `border-b` / `divide-y` is the side on its own.
  if (prefix === "border" || prefix === "divide") {
    const bare = suffix.replace(BORDER_SIDE, "");
    if (bare === "") return true;
    if (colorTokens.has(bare) || KEYWORDS.has(bare) || nonColorUtility[prefix](bare)) return true;
  }
  return false;
};

let failed = false;
for (const file of files) {
  const source = readFileSync(file, "utf8");
  const lines = source.split("\n");
  lines.forEach((line, i) => {
    if (isColorLiteral(line)) {
      console.error(`${file}:${i + 1}: raw color literal (tokens only — design-system.md)`);
      failed = true;
    }
    if (arbitraryValue.test(line)) {
      console.error(`${file}:${i + 1}: arbitrary Tailwind value (tokens only — design-system.md)`);
      failed = true;
    }
  });

  stripComments(source, file.endsWith(".css"))
    .split("\n")
    .forEach((line, i) => {
      for (const m of line.matchAll(tokenUtility)) {
        const [full, prefix, suffix] = m;
        // A CSS property name wears the same shape as a utility
        // (`border-radius:`, `text-align:`), and only a property is followed by
        // a colon — a Tailwind variant puts its colon in FRONT (`hover:bg-x`).
        if (line.slice(m.index + full.length).startsWith(":")) continue;
        if (isDefinedToken(prefix, suffix)) continue;
        console.error(
          `${file}:${i + 1}: \`${prefix}-${suffix}\` — no such token in globals.css @theme (it emits no CSS at all)`,
        );
        failed = true;
      }
      for (const m of line.matchAll(/--color-([a-z0-9-]+)/g)) {
        if (colorTokens.has(m[1])) continue;
        console.error(`${file}:${i + 1}: \`--color-${m[1]}\` — no such token in globals.css @theme`);
        failed = true;
      }
    });
}
if (failed) process.exit(1);
console.log(
  `color wall OK (${files.length} files scanned, ${pending.size} pending re-skin, ${generatedNonProduct.size} generated non-product excluded, ${colorMath.size} color-math excluded)`,
);
console.log(
  `token wall OK (${colorTokens.size} color tokens, ${textSizeTokens.size} text sizes, ${Object.keys(nonColorUtility).length} namespaces checked)`,
);
