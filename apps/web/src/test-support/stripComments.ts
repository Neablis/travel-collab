// Prose removed from a source file, for the sweeps that assert an ABSENCE.
//
// Several tests in this repo assert that a name does not appear in code — no
// rank near a plan, no `Money` on the cost ledger, no revenue word on M20's
// console. All of them have to ignore comments, because a comment *explaining*
// the rule names the very thing the rule forbids.
//
// **The order below is load-bearing and was got wrong first.** Stripping block
// comments before line comments looks equivalent and is not: a `//` comment
// containing `@/server/*` — which several files in this repo have, because it
// is how the lint wall is written down — opens a `/*` that the non-greedy
// matcher then closes against the next `*/` anywhere in the file. On
// `app/admin/page.tsx` that swallowed 2,800 characters of real JSX, and the
// sweep over it passed while asserting almost nothing.
//
// It was found the only way it could be: by putting an MRR strip on the
// console and watching the test that exists to refuse one stay green
// (CLAUDE.md rule 3).
//
// Line comments first, then JSX comments, then block comments. A `//` inside a
// block comment can still truncate, and nothing in this repo has one; if that
// ever stops being true, this wants a real tokenizer rather than a fourth
// regex.
export function stripComments(source: string): string {
  return source
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}
