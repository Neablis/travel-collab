import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
});

export default [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
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
];
