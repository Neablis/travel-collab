import { test } from "node:test";
import assert from "node:assert/strict";
import { dependencyNames, isBreaking, verdict, versionPairs } from "../dependabot-versions.mjs";

// Shapes copied from real Dependabot PRs on this repo (#271, #108, #51),
// trimmed to the lines the parser reads.
const meta = (...names) =>
  `chore(deps): bump\n\n---\nupdated-dependencies:\n${names
    .map((n) => `- dependency-name: ${n}\n  dependency-version: 9.9.9\n  dependency-type: direct:production\n`)
    .join("")}...\n\nSigned-off-by: dependabot[bot] <support@github.com>`;

// #271: one security update, prose only, version followed by a full stop.
const SINGLE = `chore(deps): Bump fast-uri from 3.1.6 to 3.1.8

Bumps [fast-uri](https://github.com/fastify/fast-uri) from 3.1.6 to 3.1.8.
<details><summary>Release notes</summary></details>`;

// #108: a grouped PR whose body hit GitHub's 65,536-character cap. The table
// lists every package; the per-package prose stops partway, so the drizzle-kit
// bump appears ONLY in the table.
const TRUNCATED_GROUP = `Bumps the development-dependencies group with 3 updates:

| Package | From | To |
| --- | --- | --- |
| [@types/node](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/HEAD/types/node) | \`22.20.0\` | \`22.20.1\` |
| [fast-check](https://github.com/dubzzz/fast-check/tree/HEAD/packages/fast-check) | \`4.8.0\` | \`4.9.0\` |
| [drizzle-kit](https://github.com/drizzle-team/drizzle-orm) | \`0.28.1\` | \`0.31.10\` |

Updates \`@types/node\` from 22.20.0 to 22.20.1
<details>…</details>

Updates \`fast-check\` from 4.8.0 to 4.9.0
<details>…`;

// #51: a grouped security PR with no table, prose only.
const PROSE_GROUP = `
Updates \`postcss\` from 8.4.31 to 8.5.16
<details>…</details>

Updates \`sharp\` from 0.34.5 to 0.34.7
<details>…</details>`;

test("merges a single patch security update (#271's shape)", () => {
  const result = verdict({ commitMessages: meta("fast-uri"), text: SINGLE });
  assert.equal(result.merge, true, result.reason);
  assert.equal(result.reason, "fast-uri 3.1.6 -> 3.1.8");
});

test("stops a 0.x minor bump that only the table shows (#108's truncated body)", () => {
  const result = verdict({ commitMessages: meta("@types/node", "fast-check", "drizzle-kit"), text: TRUNCATED_GROUP });
  assert.deepEqual(result, { merge: false, reason: "breaking bump: drizzle-kit 0.28.1 -> 0.31.10" });
});

test("fails closed when a package in the metadata has no versions anywhere in the text", () => {
  const result = verdict({ commitMessages: meta("@types/node", "left-pad"), text: TRUNCATED_GROUP });
  assert.deepEqual(result, { merge: false, reason: "no from/to versions found for left-pad" });
});

test("fails closed without updated-dependencies metadata", () => {
  assert.equal(verdict({ commitMessages: "chore: something", text: SINGLE }).merge, false);
});

test("merges a prose-only group of non-breaking updates (#51's shape)", () => {
  assert.equal(verdict({ commitMessages: meta("postcss", "sharp"), text: PROSE_GROUP }).merge, true);
});

test("stops a major, including on a two-part action version", () => {
  const text = `Bumps the github-actions group with 1 update: [actions/checkout](https://github.com/actions/checkout).\n\nUpdates \`actions/checkout\` from 6 to 7`;
  assert.deepEqual(verdict({ commitMessages: meta("actions/checkout"), text }), {
    merge: false,
    reason: "breaking bump: actions/checkout 6 -> 7",
  });
});

test("isBreaking: major, 0.x minor, and anything unreadable", () => {
  assert.equal(isBreaking("3.1.6", "3.1.8"), false);
  assert.equal(isBreaking("15.4.1", "15.5.0"), false);
  assert.equal(isBreaking("0.3.1", "0.3.2"), false);
  assert.equal(isBreaking("0.3.1", "0.4.0"), true);
  assert.equal(isBreaking("15.4.1", "16.0.0"), true);
  assert.equal(isBreaking("0977fd9", "ea17c68"), true);
});

test("reads table rows and prose, ignoring the header", () => {
  const pairs = versionPairs(TRUNCATED_GROUP);
  assert.deepEqual([...pairs.keys()], ["@types/node", "fast-check", "drizzle-kit"]);
  assert.deepEqual(pairs.get("@types/node"), [["22.20.0", "22.20.1"]]);
  assert.deepEqual(dependencyNames(meta("a", "a", "b")), ["a", "b"]);
});
