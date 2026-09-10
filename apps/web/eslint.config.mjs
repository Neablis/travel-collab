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
// Shared by the gateway block and by the assistant-kernel block below, which
// must RE-ASSERT them: ESLint flat config replaces a rule's options with the
// last matching block's rather than merging, and the assistant block is the
// last block to match `src/server/assistant/**`. Left uncopied, the kernel —
// the most security-sensitive code in the app — would be the one directory
// where the gateway chokepoint is not enforced. That is the same regression a
// review caught on `proxy.ts`/`authConfig.ts`; see the long comment on the
// gateway block.
const gatewayWallPatterns = [
  {
    group: ["@/server/ai/gateway"],
    message:
      "Only src/server/ai/modelSelection.ts may import the gateway — every model call goes through selectAiModel() (ADR-019 amendment, 2026-08-25).",
  },
];

const gatewayWallZones = [
  {
    target: "./src",
    from: "./src/server/ai/gateway.ts",
    message:
      "Only src/server/ai/modelSelection.ts may import the gateway — every model call goes through selectAiModel() (ADR-019 amendment, 2026-08-25). This still applies via a relative import.",
  },
];

// THE ASSISTANT KERNEL ALLOWLIST (ADR-043, corrected 2026-09-10). Everything
// the kernel may import from `@/server`, and nothing else — see the long
// comment on the block that uses it for why this is an allowlist and not a
// longer denylist.
//
// Each entry is a module whose own imports reach nothing but `@tc/*` and
// `@/lib`, so admitting it admits no transitive database, network or session
// access. Adding one is a claim about the module's whole import graph, not just
// its name.

/** The kernel itself: its whole subtree is its own. */
const ASSISTANT_KERNEL_ALLOWED_SUBTREES = ["assistant"];

/** Single modules under `src/server`, each checked to reach nothing but `@tc/*` and `@/lib`. */
const ASSISTANT_KERNEL_ALLOWED_MODULES = [
  // Rank comparison for `minimumRoleFor` — read through the AccessPolicy seam
  // rather than copied, because exactly one place knows a viewer ranks below an
  // editor (AGENTS.md invariant 6c).
  "accessPolicy",
  // `AskScope` and the conflict-ref numbering: pure functions over a TripDetail.
  "ai/context",
  // Caps and id-field manifests: constants and pure transforms.
  "ai/limits",
  "ai/idFields",
  "ai/markdownToPageNodes",
  // `RawToolIntent` and the resolver: `@tc/domain` plus the two above.
  "ai/batchResolver",
];

// **A regex, not a `group` of gitignore patterns, and that is not cosmetic.**
// `no-restricted-imports` matches `group` with the `ignore` package, which
// implements gitignore's rule that *a file cannot be re-included once a parent
// directory is excluded*. `["@/server/**", "!@/server/ai/context"]` therefore
// denies `@/server/ai/context` — the deny-all excludes the `@/server/ai`
// directory, and the exception never fires. Measured, on this ESLint (9.39):
// every allowlisted import was rejected. A negative lookahead has no such rule,
// so the allowlist means what it reads as.
const assistantKernelDenyPattern = `^@/server(?:$|/(?!(?:${ASSISTANT_KERNEL_ALLOWED_SUBTREES.join(
  "|",
)})(?:$|/)|(?:${ASSISTANT_KERNEL_ALLOWED_MODULES.join("|")})$))`;

// The same allowlist as paths relative to `./src/server`, for
// `import/no-restricted-paths` — which resolves an import to a FILE and
// therefore needs real paths rather than alias specifiers.
const ASSISTANT_KERNEL_ALLOWED_PATHS = [
  ...ASSISTANT_KERNEL_ALLOWED_SUBTREES.map((dir) => `./${dir}`),
  ...ASSISTANT_KERNEL_ALLOWED_MODULES.map((mod) => `./${mod}.ts`),
];

const ASSISTANT_WALL_MESSAGE =
  "The assistant kernel imports nothing from @/server outside its allowlist — the database, the page store, the session and the guard all arrive as injected ports (ADR-043 import wall). Widening the allowlist in eslint.config.mjs is the deliberate way to do this.";

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
      "no-restricted-imports": ["error", { patterns: gatewayWallPatterns }],
      "import/no-restricted-paths": ["error", { zones: gatewayWallZones }],
    },
  },
  {
    // THE ASSISTANT KERNEL WALL (ADR-043): `src/server/assistant/**` is a
    // kernel that "could if needed be its own service", and this is what makes
    // that a property of the module graph rather than a claim. Everything it
    // needs from the app's edges — the request (`next/*`), the database, the
    // page store, the session, the page access guard — arrives as an INJECTED
    // PORT (`AssistantDeps`), never as an import.
    //
    // Modelled exactly on the gateway block above, including using BOTH rules
    // for the reason its comment gives at length: `no-restricted-imports` does
    // string matching on the specifier, so it catches only the `@/…` alias
    // spelling and gives a cheap, specific message; `import/no-restricted-paths`
    // RESOLVES the import to a file first, so it also closes the relative
    // spellings (`../db/client`, `../../server/pages`) that a review proved
    // were a clean bypass of the alias rule. `next/*` is closable only by the
    // first, since it resolves into node_modules.
    //
    // **This block RE-ASSERTS the gateway wall** (`gatewayWallPatterns` /
    // `gatewayWallZones`, from the shared constants at the top of this file).
    // ESLint flat config REPLACES a rule's options with the last matching
    // block's value rather than merging them, and this block is the last one to
    // match `src/server/assistant/**` for both rules — so without the two
    // spreads the kernel would be the one directory in the app where
    // `selectAiModel()`'s chokepoint is not enforced. That is the exact
    // regression a review caught against `proxy.ts` and `authConfig.ts`, in
    // this file, and it was invisible because nothing fixtured either path.
    //
    // **DENY BY DEFAULT, with an allowlist — not a denylist of named modules.**
    // This is ADR-043's 2026-09-10 correction, and it was bought with a real
    // breach. The wall first shipped naming five forbidden specifiers
    // (`next/*`, `@/server/db/*`, `@/server/pages`, `@/server/auth`,
    // `@/server/pages-guard`) and claimed everything else arrived as an
    // injected port. It did not: `search_playbooks` imported `discoverDays`
    // from `@/server/playbooks` and `insert_playbook_day` imported
    // `readableSavedDay` from `@/server/savedDays`, and BOTH of those import
    // `./db/client` one hop down (playbooks.ts:17, savedDays.ts:12). ESLint
    // sees only direct imports, so the kernel was inside Postgres and lint said
    // it was clean — a boundary that fails silently is worse than none.
    //
    // A denylist has to enumerate what is bad, so it is wrong every time
    // somebody adds a module, and it is wrong QUIETLY. An allowlist has to
    // enumerate what is permitted, so it is wrong loudly, at the moment of the
    // change, in the diff of the person making it. Every name in `ALLOWED`
    // below is a module with no import outside `@tc/*` and `@/lib` — checked,
    // not assumed — and widening it is the thing a reviewer is being asked to
    // look at.
    //
    // The rest of `src/server` is deliberately NOT covered by a wall of its
    // own: the adapters in `src/server/ai` still call `getPage`, `guard`, the
    // executor and both library reads, which is what makes this a move rather
    // than a rewrite. The wall is on the kernel because the kernel is what has
    // to stay extractable.
    //
    // `packages/assistant` would have got this from the compiler for free and
    // was rejected for one reason (ADR-043, Alternatives): `packages/*` have no
    // ESLint configuration at all (KI-2026-09-02-c), so the move would put the
    // most security-sensitive code in the app somewhere unlinted. The zones
    // below are written so the import graph is already correct on the day that
    // KI closes and the extraction becomes a `git mv`.
    files: ["src/server/assistant/**/*.{ts,tsx}"],
    plugins: {
      import: importPlugin,
    },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...gatewayWallPatterns,
            {
              group: ["next", "next/*"],
              message:
                "The assistant kernel holds no request, response or route type — it takes what it needs as an injected port (ADR-043 import wall).",
            },
            {
              regex: assistantKernelDenyPattern,
              message: ASSISTANT_WALL_MESSAGE,
            },
          ],
        },
      ],
      "import/no-restricted-paths": [
        "error",
        {
          zones: [
            ...gatewayWallZones,
            {
              // The same wall, resolved rather than string-matched, so
              // `../playbooks` and `../../server/savedDays` are closed too.
              // `except` is relative to `from`.
              target: "./src/server/assistant",
              from: "./src/server",
              except: ASSISTANT_KERNEL_ALLOWED_PATHS,
              message: `${ASSISTANT_WALL_MESSAGE} This still applies via a relative import.`,
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
