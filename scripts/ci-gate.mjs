// The two decisions `.github/workflows/ci.yml` makes about a pull request as a
// whole. Tested by `scripts/__tests__/ci-gate.test.mjs`.
//
// 1. `changes` — does this PR touch anything but prose? `ci.yml` used to answer
//    with `paths-ignore`, which keeps the workflow from starting at all. A
//    workflow that never starts never reports, and `ci-ok` is a REQUIRED check
//    on `main`: a required check that never reports blocks the merge forever
//    (`docs/guidelines/ci-cost-and-capacity.md`). So the workflow always
//    starts, and the real jobs read this answer in their `if:` and skip.
//
// 2. `verdict` — `ci-ok`, the one required check. It is one name so that
//    splitting or renaming a job never needs a ruleset edit, and it reads the
//    jobs' results rather than trusting the run's colour, because a skipped
//    job leaves a run green. It FAILS CLOSED: when code changed, a job that
//    was skipped is as bad as one that failed.
//
// CLI: `node scripts/ci-gate.mjs changes` reads changed paths on stdin and
// prints `code=true|false`; `node scripts/ci-gate.mjs verdict` reads
// `toJSON(needs)` from NEEDS, prints one line per job, and exits 1 on a no.

// The same set `ci.yml`'s `paths-ignore` listed. `*.md` there was root-level
// only, and stays so: `.design-sync/**` is a build input even where it is
// markdown. `vercel-preview.yml` and AGENTS.md's Tier 1 use the same set.
const PROSE = [/^docs\//, /^\.agents\//, /^\.claude\//, /^[^/]+\.md$/, /^\.github\/.*\.md$/];

/** True when `path` is prose that no `ci.yml` job reads. */
export function isProse(path) {
  return PROSE.some((pattern) => pattern.test(path));
}

/** True when any changed path is not prose, i.e. the real jobs must run. */
export function touchesCode(paths) {
  return paths.some((path) => !isProse(path));
}

/** `{ ok, reason }` for a run, from `toJSON(needs)`: every job passed, or prose-only and every job skipped. */
export function verdict(needs) {
  const { changes, ...jobs } = needs;
  if (changes?.result !== "success") return { ok: false, reason: `changes did not succeed (${changes?.result ?? "missing"})` };
  const code = changes.outputs?.code;
  if (code !== "true" && code !== "false") return { ok: false, reason: `changes reported no answer (code=${JSON.stringify(code)})` };
  const names = Object.keys(jobs);
  if (names.length === 0) return { ok: false, reason: "no jobs to judge" };
  const allowed = code === "true" ? ["success"] : ["success", "skipped"];
  const bad = names.filter((name) => !allowed.includes(jobs[name].result));
  if (bad.length > 0) return { ok: false, reason: `not passed: ${bad.map((name) => `${name}=${jobs[name].result}`).join(", ")}` };
  return { ok: true, reason: code === "true" ? `all ${names.length} jobs passed` : "prose only, nothing to run" };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const mode = process.argv[2];
  if (mode === "changes") {
    const { readFileSync } = await import("node:fs");
    const paths = readFileSync(0, "utf8").split("\n").filter(Boolean);
    console.log(`code=${touchesCode(paths)}`);
  } else if (mode === "verdict") {
    const needs = JSON.parse(process.env.NEEDS ?? "{}");
    for (const [name, job] of Object.entries(needs)) console.log(`${name}: ${job.result}`);
    const result = verdict(needs);
    console.log(result.reason);
    process.exit(result.ok ? 0 : 1);
  } else {
    console.error("usage: ci-gate.mjs changes|verdict");
    process.exit(2);
  }
}
