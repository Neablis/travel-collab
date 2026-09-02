import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The `lint` script has to name every place lintable code lives, and for a
 * long time it named only one of them.
 *
 * `"lint": "eslint src"` meant the twelve `*.ts` files at this package's root
 * were outside the lane entirely — not exempted by a rule, just never handed
 * to ESLint. That is not only config: `sentry.shared.ts` is shipped code
 * imported by `sentry.server.config.ts` and `sentry.edge.config.ts`, and
 * `next.config.ts` decides the CSP. An error-level violation in either would
 * have passed `pnpm lint` and shipped green (KI-2026-08-30-b; the same gap
 * `vitest.unit.config.ts` had already met and closed in the test lane, by
 * naming its root-level files explicitly).
 *
 * Widening the script is a one-word fix, and narrowing it again would be just
 * as quiet as the original — nothing would fail, files would simply stop
 * being read. So this test asserts the coverage rather than the string: every
 * `*.ts` file sitting at this package's root must be matched by one of the
 * arguments the `lint` script passes to ESLint.
 *
 * It deliberately does NOT pin the exact script text. `eslint src '*.ts'`,
 * an explicit twelve-file list, and `eslint .` are all correct answers; only
 * a shape that leaves a root file unread is wrong.
 */

const packageRoot = path.dirname(new URL(import.meta.url).pathname);

function lintScriptArgs(): string[] {
  const pkg = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  const script = pkg.scripts.lint;
  expect(script, "apps/web must define a lint script").toBeTypeOf("string");
  const [command, ...args] = script!.split(/\s+/);
  expect(command, "the lint script is expected to invoke eslint directly").toBe("eslint");
  // The script is a shell command line, so patterns are quoted to reach ESLint
  // unexpanded. Strip the quoting to get back the pattern itself.
  return args.map((arg) => arg.replace(/^['"]|['"]$/g, "")).filter((arg) => !arg.startsWith("-"));
}

function rootTsFiles(): string[] {
  return readdirSync(packageRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => entry.name)
    .sort();
}

function isCoveredBy(file: string, arg: string): boolean {
  // A bare `.` (or `./`) hands ESLint the whole package and covers everything.
  if (arg === "." || arg === "./") return true;
  return path.matchesGlob(file, arg);
}

describe("the lint script's file scope", () => {
  it("covers every *.ts file at the package root", () => {
    const args = lintScriptArgs();
    const files = rootTsFiles();

    // Guards the guard: if this ever reads zero files the assertion below is
    // vacuously true, which is exactly the kind of silent pass being tested for.
    expect(files.length).toBeGreaterThan(0);

    const uncovered = files.filter((file) => !args.some((arg) => isCoveredBy(file, arg)));
    expect(uncovered, `not linted by \`eslint ${args.join(" ")}\``).toEqual([]);
  });

  it("still covers src", () => {
    const args = lintScriptArgs();
    expect(args.some((arg) => arg === "." || arg === "./" || arg === "src" || arg.startsWith("src/"))).toBe(true);
  });
});
