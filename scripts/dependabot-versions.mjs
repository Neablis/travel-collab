// Decides whether a Dependabot PR is safe to merge without a person, from what
// it updates. Used by `.github/workflows/dependabot-automerge.yml`; tested by
// `scripts/__tests__/dependabot-versions.test.mjs`.
//
// **Which packages** come from the commit message's `updated-dependencies:`
// block — Dependabot's structured metadata, one `- dependency-name:` entry per
// update, never truncated. **Which versions** come from the PR text, because
// that block carries only the new version. The text has two shapes:
//
//   - a `| Package | From | To |` table, on grouped PRs: complete, and first;
//   - `Bumps [x](…) from A to B` / ``Updates `x` from A to B`` prose: on every
//     PR, but on a big grouped one GitHub cuts the body at 65,536 characters
//     and the later packages' prose is simply gone. Measured on #108, whose
//     cut-off tail included `drizzle-kit 0.28.1 → 0.31.10`.
//
// So both are read, and the answer FAILS CLOSED: a package named in the
// metadata whose versions cannot be found in the text means "leave it for a
// person", never "assume it is fine". The first version of this check scraped
// only the prose and would have merged #108's drizzle-kit bump.
//
// Breaking = a different major, or a different minor below 1.0.0 (semver's
// rule for 0.x). Security updates are NOT special-cased: a patch or minor
// security fix merges like any other, because the point is to land it fast;
// a major one waits like any other.
//
// CLI: reads PR_COMMIT_MESSAGES and PR_TEXT from the environment, prints a
// one-line reason, and exits 0 for "merge", 1 for "leave for review".

const NAME_LINE = /^\s*-\s*dependency-name:\s*["']?([^"'\s]+)["']?\s*$/gm;
const TABLE_ROW = /^\|\s*(?:\[([^\]]+)\]\([^)]*\)|([^|]+?))\s*\|\s*`?v?([^`|\s]+)`?\s*\|\s*`?v?([^`|\s]+)`?\s*\|\s*$/gm;
const PROSE = /\b(?:Bumps|Updates)\s+(?:`([^`]+)`|\[([^\]]+)\]\([^)]*\)|(\S+))\s+from\s+`?v?(\S+?)`?\s+to\s+`?v?(\S+?)`?(?=\s|$)/g;

/** Every dependency name in the commits' `updated-dependencies:` blocks. */
export function dependencyNames(commitMessages) {
  return [...new Set([...commitMessages.matchAll(NAME_LINE)].map((m) => m[1]))];
}

/** `{ name: [[from, to], …] }` from the PR title and body, table and prose both. */
export function versionPairs(text) {
  const pairs = new Map();
  const add = (name, from, to) => {
    const key = name.trim();
    const pair = [from.replace(/\.$/, ""), to.replace(/\.$/, "")];
    const list = pairs.get(key) ?? [];
    if (!list.some(([a, b]) => a === pair[0] && b === pair[1])) list.push(pair);
    pairs.set(key, list);
  };
  for (const m of text.matchAll(TABLE_ROW)) {
    const name = m[1] ?? m[2];
    if (name === "Package" || /^-+$/.test(name.trim())) continue;
    add(name, m[3], m[4]);
  }
  for (const m of text.matchAll(PROSE)) add(m[1] ?? m[2] ?? m[3], m[4], m[5]);
  return pairs;
}

/** True when `from → to` can break a caller under semver. Unreadable versions count as breaking. */
export function isBreaking(from, to) {
  const parse = (v) => v.split(".").map((part) => Number.parseInt(part, 10));
  const [aMajor, aMinor = 0] = parse(from);
  const [bMajor, bMinor = 0] = parse(to);
  if ([aMajor, aMinor, bMajor, bMinor].some((n) => !Number.isInteger(n))) return true;
  if (aMajor !== bMajor) return true;
  return aMajor === 0 && aMinor !== bMinor;
}

/** `{ merge, reason }` for one PR: merge only when every named update is read and none breaks. */
export function verdict({ commitMessages, text }) {
  const names = dependencyNames(commitMessages);
  if (names.length === 0) return { merge: false, reason: "no updated-dependencies metadata in the commits" };
  const pairs = versionPairs(text);
  const lines = [];
  for (const name of names) {
    const found = pairs.get(name);
    if (found === undefined) return { merge: false, reason: `no from/to versions found for ${name}` };
    for (const [from, to] of found) {
      if (isBreaking(from, to)) return { merge: false, reason: `breaking bump: ${name} ${from} -> ${to}` };
      lines.push(`${name} ${from} -> ${to}`);
    }
  }
  return { merge: true, reason: lines.join("; ") };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = verdict({
    commitMessages: process.env.PR_COMMIT_MESSAGES ?? "",
    text: process.env.PR_TEXT ?? "",
  });
  console.log(result.reason);
  process.exit(result.merge ? 0 : 1);
}
