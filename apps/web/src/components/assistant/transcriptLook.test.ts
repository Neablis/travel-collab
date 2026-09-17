import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// THE TRANSCRIPT'S THEME CONTRACT, measured rather than described.
//
// Design §2a removes the user turn's filled bubble. That is a type change on
// three looks and a LEGIBILITY change on one: `nightdesk` paired near-white
// `--color-ink` with a dark green `--color-brand-tint` fill, so the ink that
// was legible *on the fill* has to stay legible on the panel once the fill is
// gone. The design's own words: "The theme hazard needs a test, not care."
//
// What this file asserts, per look:
//
//   1. Both transcript inks clear WCAG AA (4.5:1) against the panel the rail
//      actually paints — `--color-surface`, not `--color-paper`.
//   2. The 2px user rule clears 3:1 (WCAG non-text) against the same panel. A
//      rule the colour of the background is not a quieter treatment, it is an
//      absent one.
//   3. No look reintroduces a filled message box, asserted against
//      `Transcript.tsx`'s source — because a look CANNOT add one (it only
//      reassigns tokens), so the only way back to a bubble is an edit here.
//
// Why source-text rather than rendered classes: `expect(node.className)` and
// `toHaveClass` are both banned by the test-quality wall, and the two
// grandfathered disables that used to sit in `Transcript.test.tsx` for exactly
// this contract are deleted by this change (KI-2026-09-02-b is two shorter).
// Reading committed source is the pattern `preview-registry.test.ts` already
// uses for design contracts a rendered assertion cannot reach.

const SRC = join(__dirname, "..", "..");
const CSS = readFileSync(join(SRC, "app", "globals.css"), "utf8");
const TRANSCRIPT = readFileSync(join(__dirname, "Transcript.tsx"), "utf8");

/** Comments carry braces (`html[data-look="ledger"] .shadow-raised {` is in
 *  one), so nothing may be brace-matched before they are gone. */
const CSS_BARE = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

function declarationsIn(block: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    const [, name, value] = match;
    if (name === undefined || value === undefined) continue;
    out.set(name, value.trim());
  }
  return out;
}

/** Brace-matched body of an at-rule, by its opening text. Returns "" when the
 *  block is absent, so a caller can assert presence itself. */
function blockAfter(opening: string): string {
  const start = CSS_BARE.indexOf(opening);
  if (start < 0) return "";
  let depth = 0;
  for (let i = CSS_BARE.indexOf("{", start); i < CSS_BARE.length; i += 1) {
    if (CSS_BARE[i] === "{") depth += 1;
    else if (CSS_BARE[i] === "}") {
      depth -= 1;
      if (depth === 0) return CSS_BARE.slice(start, i);
    }
  }
  throw new Error(`unterminated block: ${opening}`);
}

/** Every `html[data-look="x"] <selector> { ... }` RULE — the ones `lookBlocks`
 *  deliberately skips, because they carry a selector rather than tokens. */
function lookScopedRules(): { look: string; selector: string; body: string }[] {
  const out: { look: string; selector: string; body: string }[] = [];
  for (const match of CSS_BARE.matchAll(/html\[data-look="(\w+)"\]\s+([^{}]+?)\s*\{([^}]*)\}/g)) {
    const [, look, selector, body] = match;
    if (look === undefined || selector === undefined || body === undefined) continue;
    out.push({ look, selector: selector.trim(), body });
  }
  return out;
}

/** The `@theme` block IS the `paper` look — it is what you get by overriding
 *  nothing, which is why `paper` has no block of its own in globals.css. */
function themeBlock(): string {
  const start = CSS_BARE.indexOf("@theme {");
  if (start < 0) throw new Error("no @theme block in globals.css");
  let depth = 0;
  for (let i = CSS_BARE.indexOf("{", start); i < CSS_BARE.length; i += 1) {
    if (CSS_BARE[i] === "{") depth += 1;
    else if (CSS_BARE[i] === "}") {
      depth -= 1;
      if (depth === 0) return CSS_BARE.slice(start, i);
    }
  }
  throw new Error("unterminated @theme block");
}

function lookBlocks(): Map<string, string> {
  const out = new Map<string, string>();
  // Only the flat token blocks: `html[data-look="x"] {`. The look-scoped
  // RULES (`html[data-look="ledger"] .shadow-raised {`) have a selector
  // between the attribute and the brace and are deliberately not matched.
  for (const match of CSS_BARE.matchAll(/html\[data-look="(\w+)"\]\s*\{([^}]*)\}/g)) {
    const [, look, body] = match;
    if (look === undefined || body === undefined) continue;
    out.set(look, body);
  }
  return out;
}

const BASE = declarationsIn(themeBlock());

/** One look's fully resolved token table: the theme block, overlaid with the
 *  look's own declarations, with `var(--x)` aliases followed to a literal. */
function tokensFor(look: string): Map<string, string> {
  const resolved = new Map(BASE);
  for (const [name, value] of declarationsIn(lookBlocks().get(look) ?? "")) {
    resolved.set(name, value);
  }
  const deref = (value: string, depth = 0): string => {
    const alias = /^var\((--[\w-]+)\)$/.exec(value);
    const target = alias?.[1];
    if (target === undefined) return value;
    if (depth > 4) throw new Error(`alias cycle at ${value}`);
    return deref(resolved.get(target) ?? "", depth + 1);
  };
  for (const [name, value] of resolved) resolved.set(name, deref(value));
  return resolved;
}

function channel(eight: number): number {
  const c = eight / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const digits = /^#([0-9a-f]{6})$/i.exec(hex.trim())?.[1];
  if (digits === undefined) throw new Error(`not a six-digit hex colour: ${hex}`);
  const n = parseInt(digits, 16);
  return (
    0.2126 * channel((n >> 16) & 0xff) +
    0.7152 * channel((n >> 8) & 0xff) +
    0.0722 * channel(n & 0xff)
  );
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

// `paper` is the base block; the other three have blocks of their own.
const LOOKS = ["paper", "ledger", "nightdesk", "airmail"] as const;

describe("the transcript's theme contract", () => {
  // WITNESS FLOOR. Every assertion below is driven off a parse, and a parse
  // that quietly returned nothing would make all of them vacuous — the exact
  // failure mode `preview-registry.test.ts` and the eval harness both keep a
  // floor for. If globals.css is restructured so these regexes stop matching,
  // this is the test that says so.
  it("finds all four looks, and the tokens the transcript draws from", () => {
    expect(lookBlocks().size).toBe(3); // paper has no block: it IS @theme
    for (const look of LOOKS) {
      const tokens = tokensFor(look);
      for (const name of [
        "--color-surface",
        "--color-a-you-rule",
        "--color-a-you-ink",
        "--color-a-asst-ink",
      ]) {
        expect(tokens.get(name), `${look} is missing ${name}`).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  // The design names `--color-surface` as the ground because that is what
  // `AssistantRail` paints (`bg-surface`). Measuring against `--color-paper`
  // would pass while the real pairing failed.
  it.each(LOOKS)("keeps both voices legible on the panel in %s", (look) => {
    const tokens = tokensFor(look);
    const panel = tokens.get("--color-surface")!;
    expect(contrast(tokens.get("--color-a-you-ink")!, panel)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(tokens.get("--color-a-asst-ink")!, panel)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(LOOKS)("keeps the user rule visible against the panel in %s", (look) => {
    const tokens = tokensFor(look);
    expect(
      contrast(tokens.get("--color-a-you-rule")!, tokens.get("--color-surface")!),
    ).toBeGreaterThanOrEqual(3);
  });

  // The aliases must stay aliases. Freezing one to a literal pins the
  // transcript to `paper`'s colours in every look.
  //
  // **What this catches, measured rather than assumed.** The first version of
  // this comment claimed the contrast assertions above "would still pass", so
  // that this test was the only guard against a frozen alias. Running the
  // mutation disproved it: pinning `--color-a-you-ink` to paper's slate value
  // drops `nightdesk` to 2.79:1, because a light-look slate on a dark panel is
  // illegible, and the contrast test fires on its own.
  //
  // So the real division of labour is: `nightdesk` is caught above, and
  // `ledger` and `airmail` are caught HERE — both are light, both stay over
  // 4.5:1 with paper's slate, and both would go silently wrong. A smaller
  // claim than the one written here first, and the true one.
  it("draws its colours from tokens the looks already tune", () => {
    const theme = declarationsIn(themeBlock());
    expect(theme.get("--color-a-you-rule")).toBe("var(--color-brand)");
    expect(theme.get("--color-a-you-ink")).toBe("var(--color-slate)");
    expect(theme.get("--color-a-asst-ink")).toBe("var(--color-ink)");
  });

  // `@theme inline` would compile the utility down to `var(--color-slate)` and
  // a look overriding `--color-a-you-ink` would do nothing — the first clause
  // of §2a's contract, broken silently. The two forms are one word apart.
  //
  // **Checking only the FIRST occurrence was not enough** (CodeRabbit, PR
  // #188): a second declaration inside `@theme inline` leaves the first one in
  // `@theme` exactly where it was, so the old assertion passed while the
  // override it protects was already dead. The inline block is parsed and each
  // alias asserted absent from it.
  it("declares those aliases in @theme, not @theme inline", () => {
    const inline = blockAfter("@theme inline");
    expect(inline, "no @theme inline block — has globals.css been restructured?").not.toBe("");
    const inlineNames = declarationsIn(inline);
    for (const alias of ["--color-a-you-rule", "--color-a-you-ink", "--color-a-asst-ink"]) {
      expect(inlineNames.has(alias), `${alias} is declared in @theme inline`).toBe(false);
      // And it really is declared in the plain block, so "absent from inline"
      // cannot be satisfied by being absent everywhere.
      expect(declarationsIn(themeBlock()).has(alias)).toBe(true);
    }
  });
});

describe("no look reintroduces a filled message box", () => {
  /** The user turn's JSX, from `<p` through the end of its className. */
  function userTurnMarkup(): string {
    const at = TRANSCRIPT.indexOf('className="border-l-2');
    expect(at, "the user turn's rule class is gone — has §2a been reverted?").toBeGreaterThan(-1);
    return TRANSCRIPT.slice(at, TRANSCRIPT.indexOf('"', at + 'className="'.length) + 1);
  }

  it("gives the user turn a rule and an indent, not a fill", () => {
    const markup = userTurnMarkup();
    expect(markup).toContain("border-l-2");
    expect(markup).toContain("pl-a-indent");
    expect(markup).not.toMatch(/\bbg-/);
    expect(markup).not.toMatch(/\brounded/);
  });

  // **A look cannot add a fill by reassigning a token — but it CAN by scoping a
  // rule** (CodeRabbit, PR #188). `lookBlocks()` parses only the flat token
  // blocks, so `html[data-look="x"] .pl-a-indent { background: … }` was
  // invisible to every assertion in this file, and the rendered tests never
  // read computed style. This reads the scoped rules the other parser skips.
  it("lets no look scope a fill onto the transcript's own classes", () => {
    const rules = lookScopedRules();
    // A witness: the parser must be finding the scoped rules that DO exist,
    // or the loop below is a pass over nothing.
    expect(rules.length, "no look-scoped rules parsed — the scanner is blind").toBeGreaterThan(0);

    const TRANSCRIPT_CLASSES = [
      "a-you-rule",
      "a-you-ink",
      "a-asst-ink",
      "a-indent",
      "a-turn",
      "leading-a-you",
      "leading-a-asst",
    ];
    for (const rule of rules) {
      if (!TRANSCRIPT_CLASSES.some((name) => rule.selector.includes(name))) continue;
      expect(rule.body, `${rule.look} fills the transcript via ${rule.selector}`).not.toMatch(
        /background|border-radius|\bradius\b/,
      );
    }
  });

  // 13px/1.5 and 14px/1.65 are arbitrary Tailwind values unless tokenised, and
  // §2d is explicit that they become tokens rather than four more line-level
  // disables on KI-2026-09-05-v.
  it("spends tokens rather than arbitrary values", () => {
    expect(TRANSCRIPT).toContain("leading-a-you");
    expect(TRANSCRIPT).toContain("leading-a-asst");
    expect(TRANSCRIPT).toContain("gap-a-turn");
    // Tailwind's arbitrary-value syntax, e.g. `pl-[11px]` or `text-[13px]`.
    expect(TRANSCRIPT).not.toMatch(/\b[a-z-]+-\[[^\]]+\]/);
  });
});
