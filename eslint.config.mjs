// THE PACKAGES' LINT CONFIG (KI-2026-09-02-c). One flat config, at the root,
// for all six `packages/*` — each package's `lint` script runs `eslint .` from
// its own directory, and ESLint 9 finds this file by searching upward from
// there. `apps/web` is NOT linted by this file: it has its own
// `apps/web/eslint.config.mjs`, which is nearer to every file under it, and its
// `lint` script runs from `apps/web`.
//
// Why one root file and not a config per package, or a shared config package:
// under pnpm's strict layout a config's plugins must resolve from where the
// config lives, so six per-package configs would mean the same four
// devDependencies six times; a `@tc/eslint-config` workspace package buys a
// seventh package to say what this file says. The four are root
// devDependencies, pinned to the versions `apps/web` already resolves, so the
// lockfile gained no new package.
//
// What it carries is the part of `apps/web`'s config that is about CODE and
// TESTS, not about the web UI:
//   - `@typescript-eslint`'s recommended set, which is what `next/typescript`
//     extends, with the same two local settings `apps/web` makes;
//   - `reportUnusedDisableDirectives: "error"`, for the same reason as there —
//     a directive that suppresses nothing reads as a live constraint;
//   - the test-quality wall: `@testing-library`'s DOM rules and the
//     no-presentation-assertion rule.
// It deliberately does NOT carry the element, colour, fetch or import walls —
// those are about `apps/web`'s UI and server boundaries. Package boundaries are
// `pnpm arch`'s job (`.dependency-cruiser.cjs`), not this file's.
//
// `scripts/check-lint-wall.mjs` lints a package test file through this config
// and requires the presentation rule to fire, so this file being deleted, or its
// `files` globs drifting off `packages/`, fails `pnpm lint`.
import tsPlugin from "@typescript-eslint/eslint-plugin";
import testingLibrary from "eslint-plugin-testing-library";

const PACKAGE_SOURCES = ["packages/*/**/*.{ts,tsx,mts,cts}"];
const PACKAGE_TESTS = ["packages/*/**/*.test.{ts,tsx}"];

const presentationMessage =
  "Assert behaviour, not classes — roles, labels and values. The colour wall owns the design contract (docs/guidelines/testing.md).";

export default [
  { ignores: ["**/node_modules/**", "**/dist/**", "**/coverage/**", "**/.stryker-tmp/**"] },
  {
    linterOptions: { reportUnusedDisableDirectives: "error" },
  },
  // `flat/recommended` is three blocks (parser + plugin, the core rules TS
  // makes redundant, the recommended rules). None of them sets `files`, so each
  // is scoped here — otherwise they would apply to every file ESLint is ever
  // pointed at from the root.
  ...tsPlugin.configs["flat/recommended"].map((block) => ({ ...block, files: PACKAGE_SOURCES })),
  {
    files: PACKAGE_SOURCES,
    rules: {
      // The same two settings `apps/web` makes (there, `no-unused-expressions`
      // is a warning under `--max-warnings 0`, which is an error by another
      // name; here it is spelled as one).
      //
      // Plus ONE difference, `ignoreRestSiblings`. The first pass over the
      // packages found 10 findings, 9 of them this rule on the omit-a-key idiom
      // `const { dayId: _dayId, ...rest } = x` in contract tests — the binding
      // exists only so `rest` lacks the key, and JavaScript has no other way to
      // write that. `apps/web` reaches the same idiom only through arrow
      // parameters, which `argsIgnorePattern` already covers. This is narrower
      // than a `varsIgnorePattern: "^_"`, which would excuse any unused `_x`.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", ignoreRestSiblings: true }],
      "@typescript-eslint/no-unused-expressions": "error",
    },
  },
  {
    // THE TEST-QUALITY WALL, part 1, for packages. `flat/dom`, not
    // `flat/react`: no package renders React. Today every package test runs in
    // vitest's `node` environment and imports no testing-library at all, so
    // most of these are inert — they are here for the day a DOM-shaped test
    // lands in `packages/pages`, which is the exposure the KI named.
    files: PACKAGE_TESTS,
    ...testingLibrary.configs["flat/dom"],
    rules: {
      ...testingLibrary.configs["flat/dom"].rules,
      // Ships at "warn"; a `screen.debug()` left in a merged test is exactly
      // what a wall should stop. Same promotion as `apps/web`.
      "testing-library/no-debugging-utils": "error",
    },
  },
  {
    // THE TEST-QUALITY WALL, part 3 (part 2 is Playwright, and no package has
    // an e2e lane): never assert presentation. The selectors are `apps/web`'s.
    // No `src/components/ui/**`-style exemption: no package holds a design
    // primitive whose class IS its behaviour.
    files: PACKAGE_TESTS,
    rules: {
      "no-restricted-syntax": [
        "error",
        { selector: "MemberExpression[property.name='toHaveClass']", message: presentationMessage },
        {
          selector: "CallExpression[callee.name='expect'] > MemberExpression[property.name='className']",
          message: presentationMessage,
        },
      ],
    },
  },
];
