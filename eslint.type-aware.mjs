// TYPE-AWARE LINT RULES, shared by `eslint.config.mjs` (packages) and
// `apps/web/eslint.config.mjs`. Plain data: rule names and settings, no plugin
// import, so it resolves from either config without its own dependencies (the
// pnpm-strict reason the root config gives for not having a config package).
//
// These need the TypeScript program, which is what makes them worth having and
// what they cost: `apps/web` lint went from ~19s to ~85s when the project
// service was turned on (measured 2026-10-01). The set was chosen from a dry
// run of typescript-eslint's whole `recommended-type-checked` set plus two
// stricter rules over the repo, ~1,450 findings in all. Kept: the rules that
// found real defects or found nothing at all (a rule with zero findings costs
// nothing and stops the bug arriving). Left out, on that measurement:
//   - `no-unsafe-*`: ~650 findings, ~640 of them tests reading `res.json()`;
//   - `require-await`: ~390, mostly async methods an interface requires;
//   - `no-unnecessary-condition`: ~130, mostly defensive null checks — the
//     rule's pressure is to delete them;
//   - `no-unnecessary-type-assertion`: ~210, cosmetic and autofixable — a
//     one-off `--fix` pass, not a wall;
//   - `unbound-method`, `no-redundant-type-constituents`: test mocks, noise.

/**
 * Off ONLY for `scripts/check-lint-wall.mjs`, which sets it on its own eslint
 * runs. The wall lints fixtures from stdin under paths that do not exist, and
 * the project service cannot place a file no tsconfig includes, so every
 * fixture would die as a parse error instead of drawing the rule it tests. It
 * also runs eslint ~90 times, and a TypeScript program per run took `pnpm
 * lint` from ~80s to ~250s. The wall tests the import/test/fetch walls, none
 * of which need types.
 */
export const typeAwareSkipped = process.env.TC_LINT_SKIP_TYPE_AWARE === "1";

/** Async and correctness rules, on for every TypeScript file, tests included. */
export const typeAwareRules = {
  // A promise nobody awaits loses its rejection: the failure happens and
  // nothing hears it. The one production hit when this landed was a dynamic
  // `import()` of the map library with no `.catch`.
  "@typescript-eslint/no-floating-promises": "error",
  // `attributes: false` lets an async function be a JSX event handler, which
  // is idiomatic React; passing one where a callback's return value is read
  // (`array.filter(async …)`, which is always truthy) stays an error.
  "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { attributes: false } }],
  "@typescript-eslint/await-thenable": "error",
  "@typescript-eslint/no-for-in-array": "error",
  "@typescript-eslint/no-array-delete": "error",
  "@typescript-eslint/no-unsafe-unary-minus": "error",
  "@typescript-eslint/no-unsafe-enum-comparison": "error",
  "@typescript-eslint/restrict-plus-operands": "error",
  // The typed versions replace the core rules, which must be off beside them.
  "no-throw-literal": "off",
  "@typescript-eslint/only-throw-error": "error",
  "no-implied-eval": "off",
  "@typescript-eslint/no-implied-eval": "error",
  "prefer-promise-reject-errors": "off",
  "@typescript-eslint/prefer-promise-reject-errors": "error",
};

/**
 * Stringification rules, on for source but not tests: a value that prints as
 * `[object Object]` inside an error message a user or the model reads is a
 * defect; inside a test's failure message it is not worth a wall.
 */
export const typeAwareSourceRules = {
  "@typescript-eslint/no-base-to-string": "error",
  "@typescript-eslint/restrict-template-expressions": "error",
};
