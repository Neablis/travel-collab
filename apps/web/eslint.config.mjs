import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
});

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
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/server/**", "src/app/api/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@tc/domain", "@tc/domain/*"],
              message: "Only src/server and src/app/api may import the domain package (AGENTS.md lint wall).",
            },
            {
              group: ["@/server/*"],
              message: "UI must call the API, not server internals (AGENTS.md lint wall).",
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
