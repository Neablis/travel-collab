// Prose removed from a source file, for the sweeps that assert an ABSENCE.
//
// Several tests in this repo assert that a name does not appear in code — no
// rank near a plan, no `Money` on the cost ledger, no revenue word on M20's
// console. All of them have to ignore comments, because a comment *explaining*
// the rule names the very thing the rule forbids.
//
// **This takes a real parse, and three implementations were wrong before it.**
// The lesson is the same one three times: a comment is a lexical construct, and
// neither a regex nor a lone scanner can find one reliably.
//
//   1. **Block comments stripped before line comments.** A `//` comment
//      containing `@/server/*` — which this repo has, because it is how the
//      lint wall is written down — opens a `/*` the non-greedy matcher then
//      closes against the next `*/` anywhere in the file. On
//      `app/admin/page.tsx` that swallowed 2,800 characters of real JSX and the
//      sweep over it passed while asserting almost nothing. Found by putting an
//      MRR strip on the console and watching the test that exists to refuse one
//      stay green.
//   2. **Order fixed, hole remains:** `/*` inside a string, template or regular
//      expression literal still opens a comment. Caught by CodeRabbit on
//      PR #174.
//   3. **`ts.createScanner` alone is not enough either**, which is the
//      interesting one. A standalone scanner cannot tokenise a template literal
//      with a substitution or tell a regex literal from division — both need
//      the parser to call `reScanTemplateToken` / `reScanSlashToken`. Pointed
//      at `packages/contracts/src/entitlement.ts` it returned ONE
//      `FirstTemplateToken` 734 characters long, starting at the backtick in
//      `new RegExp(\`…\`)` and swallowing the JSDoc after it — so the price
//      sweep over that file failed on a comment it should have stripped. Found
//      by the fix for (2) failing a test that had been passing.
//
// `ts.createSourceFile` is a real parse, so templates and regex literals are
// the parser's problem rather than this function's. Comment ranges come off
// every token's leading and trailing trivia, and the EOF token carries a
// trailing comment at the end of the file.
//
// Comments are blanked rather than deleted — same length, newlines kept — so
// two identifiers separated only by a comment cannot fuse into one word and
// hide from a `\b`-anchored sweep, and a reported line number still points at
// the line it came from.
import ts from "typescript";

export function stripComments(source: string, fileName = "sweep.tsx"): string {
  const parsed = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const blanks: ts.CommentRange[] = [];

  // **`getChildren()`, not `forEachChild`**, and the difference is the whole
  // correctness of this function: `forEachChild` visits only syntactic nodes
  // and skips TOKENS, which is exactly where trivia hangs. A comment between
  // `const` and the name it declares, or inside an otherwise empty JSX
  // expression container, belongs to a token that `forEachChild` never yields.
  // Both were live failures in this file's own tests before the switch.
  const collect = (node: ts.Node): void => {
    blanks.push(
      ...(ts.getLeadingCommentRanges(source, node.getFullStart()) ?? []),
      ...(ts.getTrailingCommentRanges(source, node.getEnd()) ?? []),
    );
    for (const child of node.getChildren(parsed)) collect(child);
  };
  collect(parsed);

  const out = source.split("");
  for (const range of blanks) {
    for (let i = range.pos; i < range.end && i < out.length; i += 1) {
      if (out[i] !== "\n") out[i] = " ";
    }
  }
  return out.join("");
}
