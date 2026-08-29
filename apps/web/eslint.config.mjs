import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

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
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/server/ai/modelSelection.ts",
      "src/server/ai/modelSelection.test.ts",
      "src/proxy.ts",
      "src/lib/authConfig.ts",
    ],
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
];
