import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";
import importPlugin from "eslint-plugin-import";
import testingLibrary from "eslint-plugin-testing-library";
import playwright from "eslint-plugin-playwright";

const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
});

// Shared by both lint-wall blocks below so the UI-scoped block (which must
// add one more restriction on top of these) can't drift from the base wall
// by editing only one of the two copies.
const domainAndServerWallPatterns = [
  {
    group: ["@tc/domain", "@tc/domain/*"],
    message: "Only src/server and src/app/api may import the domain package (AGENTS.md lint wall).",
  },
  {
    group: ["@/server/*"],
    message: "UI must call the API, not server internals (AGENTS.md lint wall).",
  },
];

export default [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // A disable directive that no longer suppresses anything is the same
    // species as a comment asserting an invariant nothing tests (AGENTS.md):
    // it reads as a live constraint and is inert. ESLint reports these on its
    // own; the default severity is "warn", which `pnpm lint` does not fail on,
    // so it is raised here. This is also what keeps the pending directives
    // below honest — the day a file stops violating a rule, the directive
    // holding it back becomes an error and has to be deleted, so the backlog
    // can only shrink and can never go stale silently.
    linterOptions: { reportUnusedDisableDirectives: "error" },
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // THE LINT WALL (AGENTS.md): UI code may not touch the domain package or
    // server internals. Route handlers and src/server are the exempt shell.
    // `.well-known` routes join that shell: they are protocol endpoints served
    // to tooling, not UI, and their paths are fixed by the spec that defines
    // them (the Flags Explorer requires exactly .well-known/vercel/flags), so
    // they cannot be moved under src/app/api to inherit its exemption. Scoped
    // to `route.ts` files only (not the whole `.well-known/**` tree) so a
    // future non-route file placed under `.well-known` doesn't inherit the
    // exemption for free.
    // `src/proxy.ts` (named `src/middleware.ts` before the Next 16 rename) is
    // NOT in this list (ADR-024, superseding ADR-023): it builds its own
    // Auth.js instance from `@/lib/authConfig` instead of importing
    // `@/server/auth`, so it needs no exemption from this rule — it's held to
    // the same standard as any other UI file.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/server/**", "src/app/api/**", "src/app/.well-known/**/route.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: domainAndServerWallPatterns,
        },
      ],
    },
  },
  {
    // THE GATEWAY CHOKEPOINT WALL (ADR-019's 2026-08-25 amendment): every AI
    // feature reaches a model by asking `selectAiModel()`, never by
    // constructing one directly. `@/server/ai/gateway` (the only place
    // AI_GATEWAY_API_KEY is used) is importable ONLY from
    // `modelSelection.ts` and its own test. Unlike the walls above, this one
    // is NOT scoped to UI — it covers the whole `src/server` tree too, because
    // the threat this closes is a second SERVER-SIDE entry point (M16's `/ask`
    // endpoint) constructing its own gateway client and bypassing the
    // ai-live flag, not a UI import.
    //
    // `src/proxy.ts` and `src/lib/authConfig.ts` are ALSO in `ignores` here —
    // not because either would ever import the gateway, but because ESLint
    // flat config REPLACES a rule's options for the last matching block
    // rather than merging them (the AUTH-CONFIG WALL block below documents
    // this same mechanic, for the same reason). Both files are ignored by
    // that block, which means IT never re-asserts the domain/server wall for
    // them — block 1 above is what does, and this block sits between block 1
    // and it. Left unignored here, this block would become the last one to
    // match those two files and its gateway-only pattern would silently
    // replace, not add to, block 1's domain/server restriction — exactly
    // the regression a review caught: `proxy.ts` and `authConfig.ts` losing
    // the `@tc/domain`/`@/server/*` wall entirely, invisible because nothing
    // fixtured either path. ADR-024 requires `proxy.ts` held to the same
    // standard as any other UI file; this ignore is what keeps that true
    // once a block sits between the wall that sets it and the block that
    // deliberately skips re-asserting it.
    //
    // `no-restricted-imports` alone only catches the `@/server/ai/gateway`
    // ALIAS spelling — ESLint's own docs warn `patterns` does string
    // matching, not path resolution, so a sibling reaching for the same
    // module via a relative path (`./gateway` from anywhere in
    // `src/server/ai/`, which is exactly the directory `handleAskRequest.ts`
    // and any future second entry point would sit in) was a clean bypass: a
    // review confirmed lint passed on `import { aiModel } from "./gateway"`.
    // `import/no-restricted-paths` (eslint-plugin-import, already pulled in
    // transitively by `eslint-config-next` — pinned here as a direct
    // devDependency so this file can import it) resolves the import to an
    // actual file before comparing, so it closes the relative form too,
    // regardless of how many `../` segments or which extension spelling is
    // used. Kept alongside the alias pattern rather than replacing it: the
    // alias check is cheap, already proven, and gives a more specific error
    // message for the common case.
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/server/ai/modelSelection.ts",
      "src/server/ai/modelSelection.test.ts",
      // gateway.test.ts reaches its own subject with a dynamic `await
      // import("./gateway")` (so it can re-import after `vi.stubEnv` +
      // `vi.resetModules()`). The old `no-restricted-imports` rule never
      // saw this — it only inspects static `import` declarations — so this
      // file didn't need listing here to pass. `import/no-restricted-paths`
      // resolves dynamic imports too, and DOES see it, so closing the
      // relative-import hole surfaced this file needing the same explicit
      // exemption the comment above already claimed it had.
      "src/server/ai/gateway.test.ts",
      "src/proxy.ts",
      "src/lib/authConfig.ts",
    ],
    plugins: {
      import: importPlugin,
    },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/server/ai/gateway"],
              message:
                "Only src/server/ai/modelSelection.ts may import the gateway — every model call goes through selectAiModel() (ADR-019 amendment, 2026-08-25).",
            },
          ],
        },
      ],
      "import/no-restricted-paths": [
        "error",
        {
          zones: [
            {
              target: "./src",
              from: "./src/server/ai/gateway.ts",
              message:
                "Only src/server/ai/modelSelection.ts may import the gateway — every model call goes through selectAiModel() (ADR-019 amendment, 2026-08-25). This still applies via a relative import.",
            },
          ],
        },
      ],
    },
  },
  {
    // THE AUTH-CONFIG WALL (ADR-024): `src/lib/authConfig.ts` holds the
    // edge-safe Auth.js provider/callback config so both `src/server/auth.ts`
    // and `src/proxy.ts` can build their own instance from it (the
    // split-config pattern) without the proxy reaching into server
    // internals. That makes it importable by genuine UI too — closed here.
    // Only `src/server/auth.ts` and `src/proxy.ts` may import it.
    //
    // `src/proxy.ts` is the Next 16 name for what was `src/middleware.ts`;
    // this wall is keyed on the filename, so the rename had to be made here
    // too or the file it exists to permit would be the one it rejected.
    //
    // `files` is `src/**/*.{ts,tsx}` — the whole tree, mirroring the wall
    // above — because a narrower glob (previously just `components/**` and
    // `app/**`) left `src/lib`, `src/mocks` and `src/test-support`
    // uncovered: a module there could import `@/lib/authConfig` and a
    // component could import that module, reaching the client bundle
    // transitively with the rule never firing. `ignores` explicitly exempts
    // the two allowed importers (`src/server/**` covers `auth.ts`;
    // `src/proxy.ts` by name) plus `src/lib/authConfig.ts` itself.
    //
    // This block's `files` glob now fully overlaps the wall above's, and
    // ESLint flat config fully replaces a rule's config with the last
    // matching block's value rather than merging arrays — so this repeats
    // `domainAndServerWallPatterns` (from the shared constant, to avoid the
    // two copies drifting) alongside the new pattern, rather than appending
    // to the previous block's rule. Its `ignores` mirrors the wall above's
    // exempt shell (`src/server/**`, `src/app/api/**`,
    // `src/app/.well-known/**/route.ts`) for the same reason: dropping any
    // of those here would silently re-impose the domain/server-internal
    // restriction on files the wall above deliberately exempts. Because
    // every file this block newly reaches (`lib/`, `mocks/`,
    // `test-support/`) was already covered by the wall above with the
    // identical `domainAndServerWallPatterns`, and `src/proxy.ts` /
    // `src/lib/authConfig.ts` are excluded from *this* block only (so the
    // wall above, which does not ignore them, still applies
    // `domainAndServerWallPatterns` to both — the proxy is held to the same
    // standard as any other UI file per ADR-024, and authConfig.ts gets the
    // same baseline check) — this widening changes only which files get the
    // new `@/lib/authConfig` restriction, not which files
    // `domainAndServerWallPatterns` applies to.
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/server/**",
      "src/proxy.ts",
      "src/lib/authConfig.ts",
      "src/app/api/**",
      "src/app/.well-known/**/route.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...domainAndServerWallPatterns,
            {
              group: ["@/lib/authConfig"],
              message:
                "Only src/server/auth.ts and src/proxy.ts may build an Auth.js instance from authConfig (AGENTS.md lint wall, ADR-024).",
            },
          ],
        },
      ],
    },
  },
  {
    // THE ELEMENT WALL (design-system.md): text, controls, and tables render
    // through components/ui primitives; no inline styles. Enumerated inline-
    // style exceptions (drag opacity, map container, computed timeline/calendar
    // geometry) carry a line-level eslint-disable with a reason.
    files: ["src/**/*.tsx"],
    ignores: [
      "src/components/ui/**",
      "src/server/**",
      "src/app/api/**",
      // Test fixtures render arbitrary DOM to simulate surrounding page
      // context (e.g. a "probe" input standing in for some other field on
      // the page) — this is not shipped UI, so the element wall doesn't apply.
      "src/**/*.test.tsx",
      // Sentry wizard-generated scaffolding (landed on main via 6a5501e,
      // pushed directly without a PR, so `pnpm lint` never ran on it — see
      // docs/guidelines/ci-cost-and-capacity.md for why CI is PR-only). It's
      // a throwaway verification route, not product UI, so the design-system
      // wall doesn't apply. If this file is ever deleted, delete this line
      // with it rather than leaving a dangling exemption.
      "src/app/sentry-example-page/page.tsx",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXOpeningElement[name.name=/^(button|input|textarea|select|label|h1|h2|h3|h4|h5|h6|table)$/]",
          message: "Render through the components/ui primitives (design-system.md).",
        },
        {
          selector: "JSXAttribute[name.name='style']",
          message: "No inline styles — use tokens. Enumerated exceptions need a line disable with a reason (design-system.md).",
        },
      ],
    },
  },
  {
    // THE TEST-QUALITY WALL, part 1: @testing-library's own rules.
    //
    // test-overhaul Task 7.1 asked for these in July and they never landed —
    // the task was marked done on the strength of four unrelated walls in
    // `scripts/`, so five of its six rows shipped as nothing. This is the
    // largest row. The plugin encodes, as automated checks, most of what
    // `AGENTS.md`'s Testing model can only say in prose: assert behaviour
    // rather than DOM structure, await your async queries, don't reach past
    // the query layer into nodes.
    //
    // Scoped to unit/component tests. `*.int.test.ts` files are here too —
    // they render nothing, so almost every rule is inert for them, and
    // excluding them would only create a hole for the day one of them does.
    files: ["src/**/*.test.{ts,tsx}"],
    ...testingLibrary.configs["flat/react"],
    rules: {
      ...testingLibrary.configs["flat/react"].rules,
      // OFF, and this one is not a judgement call: `vitest.setup.ts` registers
      // `afterEach(cleanup)` deliberately, with a comment explaining why. RTL's
      // automatic cleanup only self-registers when it detects `globals: true`
      // framework globals, and this repo does not set `test.globals`. Without
      // the manual call, body state from one test (a Radix Dialog's
      // `pointer-events: none` lock) leaks into the next. The rule assumes an
      // auto-cleanup that is genuinely absent here, and fires 59 times.
      "testing-library/no-manual-cleanup": "off",
      // OFF: pure naming preference (`const view = render(...)` is banned in
      // favour of a small allowed set). It has no failure mode behind it, and
      // 21 call sites would be renamed to satisfy a rule that cannot catch a
      // bug. The rules kept below all name a way a test can lie.
      "testing-library/render-result-naming-convention": "off",
      // Ships at "warn", and a warning does not fail `pnpm lint` — same
      // reasoning as the Playwright block below. A `screen.debug()` left in a
      // merged test is exactly the thing a wall should stop.
      "testing-library/no-debugging-utils": "error",
    },
  },
  {
    // THE TEST-QUALITY WALL, part 2: Playwright's own rules, for the e2e lane.
    //
    // These reach e2e only because `apps/web`'s lint script was widened from
    // `eslint src` to cover `e2e` and the root-level files in the same commit
    // — until then nothing in `e2e/` was linted at all, which is why the sleep
    // wall had to be a standalone script in `scripts/` (KI-2026-08-30-b).
    files: ["e2e/**/*.ts"],
    ...playwright.configs["flat/recommended"],
    // EVERY RULE PROMOTED TO ERROR, on purpose. 22 of the plugin's 37
    // recommended rules ship at "warn", and `eslint` exits 0 on warnings — so
    // `pnpm lint` is green and `pnpm check` is green while the rule reports.
    // A wall that does not fail the build is a suggestion. `no-wait-for-timeout`
    // is in that warn set, which would have made a second, weaker copy of
    // `scripts/check-sleep-wall.mjs` — a wall this repo built precisely because
    // guidance alone did not hold it three times.
    rules: Object.fromEntries(
      Object.entries(playwright.configs["flat/recommended"].rules).map(([rule, setting]) => [
        rule,
        Array.isArray(setting) ? ["error", ...setting.slice(1)] : "error",
      ]),
    ),
  },
  {
    // THE TEST-QUALITY WALL, part 3: never assert presentation.
    //
    // A class name is not a contract. It changes on every re-skin, it says
    // nothing about what a user can do, and a test asserting one goes red for
    // a change that broke nothing — which is how a suite trains its readers to
    // ignore it. Assert roles, labels, values and behaviour instead. The
    // design contract has its own enforcement and it is not this file:
    // `scripts/check-color-wall.mjs` owns tokens, and the element wall above
    // owns which primitives may be rendered.
    //
    // `src/components/ui/**` is exempt DELIBERATELY. A design-system primitive
    // whose entire job is to map `variant="danger"` onto a token class has
    // nothing else to assert — the class IS its observable behaviour, and
    // there is no user-visible role or label standing in for it. That is a
    // real exception, not a backlog: those 25 assertions are correct where
    // they are and should not be migrated.
    files: ["src/**/*.test.{ts,tsx}"],
    ignores: ["src/components/ui/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[property.name='toHaveClass']",
          message: "Assert behaviour, not classes — roles, labels and values. The colour wall owns the design contract (docs/guidelines/testing.md).",
        },
        {
          selector: "CallExpression[callee.name='expect'] > MemberExpression[property.name='className']",
          message: "Assert behaviour, not classes — roles, labels and values. The colour wall owns the design contract (docs/guidelines/testing.md).",
        },
      ],
    },
  },
];
