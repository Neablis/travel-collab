import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSecrets } from "../build-secrets.mjs";

// docker/build-push-action rejects `NAME=` (an empty secret), and an unset
// Actions variable renders as exactly that, so an unset one must be left out.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("an unset or empty variable is omitted, a set one is passed", () => {
  const lines = buildSecrets(
    { PREVIEW_NEXT_PUBLIC_UMAMI_SRC: "https://u.example/s.js", PREVIEW_NEXT_PUBLIC_SENTRY_DSN: "" },
    "PREVIEW_",
    ["APP_ENV=preview"],
  );
  assert.deepEqual(lines, ["APP_ENV=preview", "NEXT_PUBLIC_UMAMI_SRC=https://u.example/s.js"]);
});

test("a fixed line wins over a variable of the same name", () => {
  const lines = buildSecrets({ PREVIEW_PUBLIC_ORIGIN: "https://other" }, "PREVIEW_", ["PUBLIC_ORIGIN=https://preview.caesura.today"]);
  assert.deepEqual(lines, ["PUBLIC_ORIGIN=https://preview.caesura.today"]);
});

test("a value that ends in `=` is passed whole", () => {
  assert.deepEqual(buildSecrets({ P_NEXT_PUBLIC_SENTRY_DSN: "abc==" }, "P_"), ["NEXT_PUBLIC_SENTRY_DSN=abc=="]);
});

for (const file of ["deploy-production.yml", "coolify-preview.yml"]) {
  test(`${file} passes the filtered list, not Actions variables, as the build secrets`, () => {
    const text = readFileSync(join(ROOT, ".github", "workflows", file), "utf8");
    const value = /^\s*secrets:[ \t]*(.*)$/m.exec(text)?.[1];
    assert.equal(value, "${{ steps.secrets.outputs.secrets }}", "an unset variable would render as `NAME=` and fail the build");
    assert.doesNotMatch(text, /^\s*secrets: \|\n(?:.*\n){0,12}?.*\bvars\./m);
  });
}
