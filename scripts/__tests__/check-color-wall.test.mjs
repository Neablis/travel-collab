import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// check-color-wall.mjs finds its input with `git ls-files` over `apps/web/src`
// rather than taking a directory argument (unlike check-sleep-wall.mjs). The
// one test that calls `runWall()` bare runs it against the actual tree; every
// fixture test runs it against a throwaway repo via `COLOR_WALL_SCAN_ROOT`
// (see `runWallAgainst`).
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WALL = join(REPO_ROOT, "scripts", "check-color-wall.mjs");
const SENTRY_PAGE = "apps/web/src/app/sentry-example-page/page.tsx";

function runWall(env = process.env) {
  const result = spawnSync(process.execPath, [WALL], { encoding: "utf8", cwd: REPO_ROOT, env });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

// KI-2026-09-23-g: these fixtures used to be planted in this repo's own
// `apps/web/src`, the only place the wall's `git ls-files` pathspec looks — and
// a `tsc --noEmit` or ESLint pass running at the same time in the same checkout
// reported errors in files that were gone by the time anyone looked. Now each
// call builds a throwaway git repo in the OS temp dir, puts the fixture at
// `apps/web/src/fixture/<basename>` inside it, and points the wall there with
// `COLOR_WALL_SCAN_ROOT`. The fixture is still UNTRACKED in that repo, so it
// reaches the wall through the same `--others --exclude-standard` listing a
// brand-new file in the real tree does (KI-51); only `globals.css` and the
// pending list still come from the real checkout.
//
// The directory is MINTED PER CALL by `mkdtempSync`, never fixed, and removed
// in `finally` — by construction one this call made.
function runWallAgainst(basename, contents) {
  const root = mkdtempSync(join(tmpdir(), "tc-color-wall-"));
  // One directory BELOW `src`, not in it: the wall's pathspec
  // `apps/web/src/**/*.ts` needs a `/` after `src/`, so a file directly in
  // `src` is never listed and every fixture here would pass for nothing.
  const relative = `apps/web/src/fixture/${basename}`;
  try {
    const init = spawnSync("git", ["init", "--quiet", root], { encoding: "utf8" });
    assert.equal(init.status, 0, `git init failed: ${init.stderr}`);
    mkdirSync(join(root, "apps", "web", "src", "fixture"), { recursive: true });
    writeFileSync(join(root, relative), contents);
    return { ...runWall({ ...process.env, COLOR_WALL_SCAN_ROOT: root }), relative };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// The regression this guards: the exclusion could be a no-op (wrong path,
// typo, wrong Set) and the wall would still pass today only because the file
// happens to be clean — it isn't. Feed the excluded file's own contents back
// through the wall at a path the exclusion does not cover, so the exclusion is
// proven necessary by the wall itself rather than by a second copy of its
// matcher living here and silently drifting out of sync with it.
test("the generated-non-product exclusion is non-vacuous: the excluded file really does contain raw color literals", () => {
  const contents = readFileSync(join(REPO_ROOT, SENTRY_PAGE), "utf8");
  const { status, stderr, relative } = runWallAgainst("sentry-copy.tsx", contents);
  assert.equal(
    status,
    1,
    "expected the Sentry scaffold to still carry raw color literals — if this fails, the exclusion may no longer be needed",
  );
  assert.match(stderr, new RegExp(`${relative}:\\d+: raw color literal`));
});

test("the wall passes end-to-end and names the generated-non-product exclusion separately from the shrinking pending list", () => {
  const { status, stdout } = runWall();
  assert.equal(status, 0, `expected the wall to pass; got: ${stdout}`);
  // The DEFAULT scan root is the real `apps/web/src`. Every fixture test runs
  // against a temp repo instead (KI-2026-09-23-g), so this is the one place a
  // wall that quietly scanned nothing would show — "0 files scanned" is green.
  // The floor is far below today's count (825 on 2026-09-24) on purpose.
  const scanned = Number(stdout.match(/color wall OK \((\d+) files scanned/)?.[1] ?? 0);
  assert.ok(scanned > 300, `expected the default root to scan the real apps/web/src; got: ${stdout}`);
  assert.match(stdout, /1 generated non-product excluded/);
  // The color-math list is named separately too, and for the same reason the
  // other two are: three lists with three different rules, reported as three
  // numbers. Merging any of them into one count is how a list that should only
  // ever shrink quietly grows — KI-51.
  //
  // This assertion exists because adding the count broke the line above: the
  // new number was spliced INTO the phrase "generated non-product excluded",
  // and the wall's own test caught it in CI (PR 196, 2026-09-20) after a local
  // `pnpm lint` passed — lint runs the wall, it does not check what the wall
  // says about itself.
  assert.match(stdout, /\d+ color-math excluded/);
});

test("the exclusion is scoped to the named file only, not the whole directory", () => {
  const source = readFileSync(WALL, "utf8");
  const match = source.match(/const generatedNonProduct = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(match, "expected a generatedNonProduct Set literal in check-color-wall.mjs");
  const entries = [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(entries, [SENTRY_PAGE]);
});

// KI-20260830: every decimal PR number from #100 to #99999999 is also a valid
// 3-to-8 digit hex string, so `#[0-9a-fA-F]{3,8}\b` flagged code comments that
// cited a pull request and had no color anywhere near them. This repo minted
// PR #100 on 2026-08-30, so the false positive arrives with every PR from here
// on; the workaround was to write "PR 100" without the `#`.
test("a comment citing a pull request by number is not a color literal (KI-20260830)", () => {
  const contents = [
    "// Fixed in review on PR #100 — see the thread.",
    "// Also discussed in pull request #4271 and issue #12345678.",
    // The shapes the CSS-shorthand matcher below could plausibly have re-broken:
    // prose whose word right before the `#` ends in a digit. A rule reading
    // "preceded by any number" would flag both of these.
    "// Landed in M17 #112, and again in 2026 #100.",
    "export const x = 1;",
    "",
  ].join("\n");
  const { status, stdout, stderr } = runWallAgainst("pr-reference.ts", contents);
  assert.equal(status, 0, `expected the wall to pass; got: ${stdout}${stderr}`);
});

// The anti-vacuity half of the pair above: a matcher that stopped flagging PR
// numbers by flagging less would pass that test too. Every line here is a real
// raw color that must still fail the wall — including the two all-decimal
// hexes, which are exactly the shape a PR reference takes and are told apart
// from one only by the color context they sit in.
test("real raw color literals are still caught, including all-decimal hexes in color context", () => {
  const lines = [
    'export const A = () => <div style={{ color: "#0c6b58" }} />;',
    'export const B = () => <div style={{ background: "#111" }} />;',
    'export const C = () => <div className="bg-[#100]" />;',
    'export const D = () => <div style={{ borderColor: "rgba(0, 0, 0, 0.2)" }} />;',
    'export const E = () => <div style={{ outlineColor: "hsl(120 50% 50%)" }} />;',
    'export const F = () => <div style={{ border: "1px solid #553DB8" }} />;',
    'export const G = () => <div style={{ color: "#FFFFFF" }} />;',
    // The hole the narrowing left behind (CodeRabbit, PR #123). In a CSS
    // SHORTHAND the colour is not the first token of the value, so an
    // all-decimal one follows a space rather than the `:`/`=`/`,`/`[`/quote the
    // context matcher anchored on — `#100` here was a real raw colour reaching
    // the UI and the wall walked past it. Lines H and I are the two shapes that
    // matter: a line-style keyword in front, and a length in front.
    'export const H = () => <div style={{ border: "1px solid #100" }} />;',
    'export const I = () => <div style={{ boxShadow: "0 1px 2px #100" }} />;',
  ];
  const { status, stderr, relative } = runWallAgainst("raw-colors.tsx", `${lines.join("\n")}\n`);
  assert.equal(status, 1, "expected the wall to fail on a file full of raw colors");
  for (const [index, line] of lines.entries()) {
    assert.match(
      stderr,
      new RegExp(`${relative}:${index + 1}: raw color literal`),
      `expected line ${index + 1} to be flagged: ${line}`,
    );
  }
});

// ---------------------------------------------------------------------------
// THE TOKEN WALL (KI-2026-09-19-g). The tests above are all about a color
// VALUE. These are its mirror image: a token NAME that does not exist. The
// defect is invisible to every other layer — Tailwind emits nothing for an
// unknown utility, ESLint has no opinion on a class name, and jsdom has no
// layout — so before this wall the only detector was a person on a preview,
// which is how M23 shipped a selected chip with a transparent background.
// ---------------------------------------------------------------------------

// The anti-vacuity test, and the one that proves the wall for its own reason:
// each line is a shape the wall claims to catch, and each must be named.
test("an undefined token name fails the wall, in every namespace form it claims to cover", () => {
  const lines = [
    // A one-letter typo inside a real token family — the M23 defect verbatim.
    'export const A = () => <div className="bg-brand-tnit" />;',
    'export const B = () => <div className="text-warning-nk" />;',
    // Tailwind's own default palette, which `--color-*: initial` deleted.
    'export const C = () => <div className="bg-amber-50" />;',
    // A side sits between the prefix and the value, so a naive suffix lookup
    // misses it: `border-t-<color>` is the color, `border-t` is a width.
    'export const D = () => <div className="border-t-mos" />;',
    // shadcn's default ring color, which this app never defined. Copied in
    // from a snippet, it silently falls back to currentColor.
    'export const E = () => <div className="ring-primary" />;',
    // The custom property spelled straight into an arbitrary value.
    'export const F = () => <div className="text-[var(--color-nosuch)]" />;',
  ];
  const { status, stderr, relative } = runWallAgainst("bad-tokens.tsx", `${lines.join("\n")}\n`);
  assert.equal(status, 1, "expected the wall to fail on a file full of undefined token names");
  for (const [index, line] of lines.entries()) {
    assert.match(
      stderr,
      new RegExp(`${relative}:${index + 1}: \`[^\`]+\` — no such token`),
      `expected line ${index + 1} to be flagged: ${line}`,
    );
  }
});

// The other half of the pair: a wall that caught the lines above by flagging
// everything would pass that test too. Every line here is real, current
// vocabulary from `apps/web/src`, and all of it must stay green.
test("real tokens, non-color utilities and CSS property names all pass the token wall", () => {
  const contents = [
    // Colour tokens across the namespaces the wall checks.
    'export const A = () => <div className="bg-brand-tint text-warning-ink border-hairline" />;',
    'export const B = () => <div className="ring-brand outline-brand fill-surface stroke-hairline divide-hairline" />;',
    // `text-*` is two token families at once: `--color-ink` and `--text-sm`.
    'export const C = () => <div className="text-ink text-sm text-3xs" />;',
    // Non-colour utilities sharing the same prefixes.
    'export const D = () => <div className="bg-cover bg-no-repeat bg-clip-text bg-center" />;',
    'export const E = () => <div className="text-center text-pretty text-nowrap text-ellipsis" />;',
    'export const F = () => <div className="border-2 border-t border-b-0 border-dashed border-collapse" />;',
    'export const G = () => <div className="ring-2 ring-inset outline-2 outline-offset-1 divide-y stroke-2" />;',
    // The CSS keywords every namespace accepts.
    'export const H = () => <div className="bg-transparent text-current border-none fill-none" />;',
    // Variants put their colon in FRONT of the utility; the opacity modifier
    // goes behind it. Neither changes which token is being named.
    'export const I = () => <div className="hover:bg-moss focus-visible:outline-brand bg-ink/70" />;',
    // A CSS property name wears a utility's shape. This one is asserted as a
    // bare word inside a regex in `assistant/transcriptLook.test.ts`, so the
    // colon rule alone does not save it.
    'export const J = /background|border-radius|text-align/;',
    "",
  ].join("\n");
  const { status, stdout, stderr } = runWallAgainst("good-tokens.tsx", contents);
  assert.equal(status, 0, `expected the wall to pass; got: ${stdout}${stderr}`);
});

// Comments are where this repo records the defect it is warning the next reader
// about — `ui/toggle-chip.tsx` names `bg-brand-subtle`/`text-muted` in prose
// precisely because they were wrong, and `pages/cityAccents.ts` says in as many
// words that there is no `--color-brand-ink`. A token wall that read comments
// would force the deletion of the institutional memory it was built on.
test("a comment naming a bad token is not a violation, in either comment syntax", () => {
  const contents = [
    "// This shipped as `bg-brand-subtle` / `text-muted`, and NEITHER is a token.",
    "/* There is no `--color-brand-ink`; brand's darkest tone is `-pressed`. */",
    "/* A block comment",
    "   that names bg-amber-50 across lines. */",
    // A `//` inside a string is not a comment opener, so the class after it on
    // the same line still has to be seen.
    'export const A = () => <a href="https://example.com" className="text-ink" />;',
    "",
  ].join("\n");
  const { status, stdout, stderr } = runWallAgainst("token-comments.tsx", contents);
  assert.equal(status, 0, `expected the wall to pass; got: ${stdout}${stderr}`);
});

// **The witness the test above is missing.** It ends its url line with
// `text-ink`, a VALID token — so if the wall wrongly treated `//` inside the
// string as a comment opener and discarded the rest of the line, that test
// would still pass. It asserts nothing about the path it claims to cover.
//
// A first attempt at this witness put the bad token on the NEXT line, which
// does not discriminate either: truncating line 1 never hid line 2, and it
// passed against the old regex too. It was deleted rather than kept, because a
// test that cannot fail is the thing being fixed here, not a second copy of it.
// The same hazard on ONE line, which is the shape the old regex actually lost:
// everything after the first `//` went, including a token later in the line.
test("a token after a url ON THE SAME LINE is still scanned", () => {
  const contents = [
    'export const A = () => <a href="//cdn.example.com" className="text-nonexistent-token" />;',
    "",
  ].join("\n");
  const { status, stderr, relative } = runWallAgainst("same-line-url.tsx", contents);
  assert.equal(status, 1, "expected the wall to report the undefined token after the url");
  assert.match(stderr, new RegExp(`${relative}:1: \\\`text-nonexistent-token\\\` — no such token`));
});

// The same non-vacuity argument the Sentry exclusion gets above: the
// `notAClassName` entry could be a typo or left behind after the dependency
// stopped using the word, and the wall would still pass because nothing in the
// tree spells it. Prove each entry is still earning its exemption.
test("every notAClassName exemption is still used by the tree it was added for", () => {
  const source = readFileSync(WALL, "utf8");
  const match = source.match(/const notAClassName = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(match, "expected a notAClassName Set literal in check-color-wall.mjs");
  const entries = [...match[1].matchAll(/^\s*"([^"]+)",/gm)].map((m) => m[1]);
  assert.ok(entries.length > 0, "expected at least one exemption to check");
  for (const entry of entries) {
    const hits = spawnSync("git", ["grep", "-l", "--fixed-strings", `"${entry}"`, "--", "apps/web/src"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    assert.equal(
      hits.status,
      0,
      `\`${entry}\` is exempted as foreign vocabulary but nothing in apps/web/src spells it any more — delete the exemption`,
    );
  }
});

// **The same hazard one level up, and it is the reason the scanner no longer
// runs per line.** The stripper used to be mapped across `split("\n")`, which
// reset its quote state at every newline — so a template literal stopped being
// a string after its first line, and a protocol-relative url on a LATER line
// truncated that line exactly as the old regex did.
//
// **The bad token must sit after the url, on a later line of a template that
// OPENED on an earlier one.** A first draft of this put the whole template on
// one line, where the per-line scanner tracks the backtick perfectly well — it
// passed against the very mutation it was written to catch, which is the third
// time in this milestone a witness asserted nothing about its own path.
test("a token after a url on a LATER LINE of a template literal is still scanned", () => {
  const contents = [
    "export const css = `",
    // Line 2 of the template: the old scanner arrived here with no quote state,
    // read `//` as a comment opener, and dropped everything after it.
    "  a { background: url(//cdn.example.com/x.png); } bg-amber-50",
    "`;",
    "",
  ].join("\n");
  const { status, stdout, stderr } = runWallAgainst("token-template.tsx", contents);
  assert.equal(status, 1, `expected the wall to FAIL on bg-amber-50; got: ${stdout}${stderr}`);
  assert.match(`${stdout}${stderr}`, /bg-amber-50/);
});
