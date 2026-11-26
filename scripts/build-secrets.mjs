import { appendFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

// `docker/build-push-action` throws "<kv> is not a valid secret" on `NAME=`
// (actions-toolkit `parseSecretKvp`), and an unset Actions variable renders as
// exactly that. So the workflows build the `secrets:` list here and leave out
// every variable that is unset or empty; the Dockerfile treats a missing
// secret as unset. Tested by `scripts/__tests__/build-secrets.test.mjs`.
//
// Usage: `node scripts/build-secrets.mjs <PREFIX_> [NAME=value ...]`, with the
// Actions variables as JSON in `VARS` (`${{ toJSON(vars) }}`). The list goes to
// `$GITHUB_OUTPUT` as `secrets`.

/** The public build variables the Dockerfile reads, each an Actions variable `<prefix><NAME>`. */
export const NAMES = [
  "PUBLIC_ORIGIN",
  "NEXT_PUBLIC_UMAMI_WEBSITE_ID",
  "NEXT_PUBLIC_UMAMI_SRC",
  "NEXT_PUBLIC_SENTRY_DSN",
  "NEXT_PUBLIC_SENTRY_PROFILE_SESSION_SAMPLE_RATE",
  "NEXT_PUBLIC_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE",
  "NEXT_PUBLIC_SENTRY_REPLAYS_SESSION_SAMPLE_RATE",
  "NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE",
];

/**
 * @param {Record<string, string | undefined>} vars Actions variables.
 * @param {string} prefix e.g. `PRODUCTION_`.
 * @param {string[]} fixed `NAME=value` lines that win over a variable of the same name.
 * @returns {string[]} `NAME=value` lines, none with an empty value.
 */
export function buildSecrets(vars, prefix, fixed = []) {
  const fixedNames = new Set(fixed.map((l) => l.split("=")[0]));
  const fromVars = NAMES.filter((n) => !fixedNames.has(n))
    .map((n) => `${n}=${vars[`${prefix}${n}`] ?? ""}`);
  return [...fixed, ...fromVars].filter((l) => !l.endsWith("="));
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const [prefix, ...fixed] = process.argv.slice(2);
  const lines = buildSecrets(JSON.parse(process.env.VARS ?? "{}"), prefix, fixed);
  const delimiter = `EOF_${randomUUID()}`;
  appendFileSync(process.env.GITHUB_OUTPUT, `secrets<<${delimiter}\n${lines.join("\n")}\n${delimiter}\n`);
  console.log(`build-secrets: passing ${lines.length} secrets (${lines.map((l) => l.split("=")[0]).join(", ")})`);
}
