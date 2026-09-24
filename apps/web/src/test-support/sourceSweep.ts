// The shared cost of a source sweep: one walk, one read and at most one
// comment-strip per file, and none at all for a file that cannot match.
//
// **Why this exists (KI-20260924-f).** `soleWriter.test.ts` and
// `planVersions.fourthPlan.test.ts` each ran `stripComments` — a full
// TypeScript parse — over every one of the ~400 non-test source files, and
// `soleWriter` did it twice (once per sweep). Idle that was 2.4–4.5s per test;
// with the box loaded (load ~7 on 4 cores) the same tests measured 11–14s and
// hit Vitest's 5000ms timeout. The regexes were never the cost; the parse was.
//
// **Why the pre-filter is sound, not a heuristic.** `stripComments` only ever
// replaces characters inside a comment with spaces (newlines kept). It never
// creates a non-space character. So any run of non-space characters in the
// stripped output is present, at the same offset, in the raw text — and a
// sweep whose pattern requires a literal token (`subscriptions`, `planId`, a
// quoted plan id) cannot match a stripped file whose raw text lacks that token.
// Skipping the parse for such a file changes no verdict; the sweep's own
// pattern is still what decides, on the stripped text, for every file that
// could match.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { stripComments } from "./stripComments";

// Build output and dependencies, never source. Dot-directories are NOT
// skipped: `src/app/.well-known/**/route.ts` is shipped code.
const NEVER_SOURCE = new Set(["node_modules", ".next", "test-results"]);

const walked = new Map<string, readonly string[]>();
const rawText = new Map<string, string>();
const strippedText = new Map<string, string>();

/**
 * Every `.ts`/`.tsx` file under `root` (test files included — callers filter),
 * absolute paths, walked once per module and memoised.
 */
export function sourceFilesUnder(root: string): readonly string[] {
  const cached = walked.get(root);
  if (cached) return cached;
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (NEVER_SOURCE.has(name)) continue;
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(name)) out.push(full);
    }
  };
  walk(root);
  walked.set(root, out);
  return out;
}

/** The file's raw text, read once. */
export function rawSource(file: string): string {
  let text = rawText.get(file);
  if (text === undefined) {
    text = readFileSync(file, "utf8");
    rawText.set(file, text);
  }
  return text;
}

/** The file's text with comments blanked (see `stripComments`), parsed once. */
export function strippedSource(file: string): string {
  let text = strippedText.get(file);
  if (text === undefined) {
    text = stripComments(rawSource(file));
    strippedText.set(file, text);
  }
  return text;
}

/**
 * The comment-stripped text of `file`, or `null` when its raw text does not
 * contain `mustContain` — in which case no pattern requiring that token can
 * match the stripped text either, and the parse is skipped. `mustContain` must
 * be a token every pattern the caller will apply cannot match without.
 */
export function strippedIfMentions(file: string, mustContain: RegExp): string | null {
  return mustContain.test(rawSource(file)) ? strippedSource(file) : null;
}
