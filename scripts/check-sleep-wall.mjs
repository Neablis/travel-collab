import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// THE SLEEP WALL: no `waitForTimeout` in an e2e spec without a written reason.
//
// This repo has paid for the lesson three times. KI-13 traced a whole class of
// "flaky" e2e failures to wall-clock budgets starving on a loaded machine;
// KI-21 traced another to a hand-rolled polling wait around drag auto-scroll;
// and then m10-map-rail.spec.ts regrew nine of them (~24s a run) coupled to
// `scrollThrottleMs`'s trailing edge, so turning a tuning knob flaked a spec
// that had not changed. Guidance alone did not hold — every one of those was
// written after the principle was already documented.
//
// A sleep is a *guess* about how long something takes, and the guess gets
// re-evaluated by the machine, not by the author. The alternatives are all
// cheap: a retrying web-first assertion (`toHaveText`, `toHaveAttribute`),
// `expect.poll`, `waitForResponse`, or waiting a frame with
// `requestAnimationFrame` — an event rather than a duration.
//
// Not a total ban: some waits genuinely have no event to hang off (proving a
// thing *stays* absent, for one). Those are allowed, in writing:
//
//   // e2e-sleep-allowed: nothing to await — this proves the toast does NOT
//   // reappear, so the only signal is the passage of time.
//   await page.waitForTimeout(500);
//
// The marker must carry a reason, and must sit on the sleep's own line or in
// the comment block immediately above it — so it is written *at* the sleep, by
// whoever adds it, and shows up in the diff that adds it. Anything further
// away (a comment about the previous statement, a file header) does not count.
const MARKER = /e2e-sleep-allowed:\s*\S/;
const SLEEP = /\bwaitForTimeout\s*\(/;
const COMMENT = /^\s*(\/\/|\*|\/\*)/;

function scan(source) {
  const lines = source.split("\n");
  const unjustified = [];
  let justified = 0;
  lines.forEach((line, i) => {
    if (!SLEEP.test(line)) return;
    let ok = MARKER.test(line);
    // The reason usually needs more than one line, so walk the whole
    // contiguous comment block above rather than only the adjacent line.
    for (let j = i - 1; !ok && j >= 0 && COMMENT.test(lines[j]); j -= 1) ok = MARKER.test(lines[j]);
    if (ok) justified += 1;
    else unjustified.push({ line: i + 1, text: line.trim() });
  });
  return { unjustified, justified };
}

function tsFilesUnder(dir) {
  const out = [];
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...tsFilesUnder(path));
    else if (entry.endsWith(".ts")) out.push(path);
  }
  return out;
}

// A plain directory walk rather than `git ls-files`: an untracked, brand-new
// spec is exactly the file most likely to carry a fresh sleep (KI-51 is the
// same lesson on the color wall), and e2e/ holds no generated output a naive
// walk would wrongly pick up. The directory is an argument so the wall can be
// pointed at a fixture — that is how its own test exercises it.
const dir = process.argv[2] ?? "apps/web/e2e";
const files = tsFilesUnder(dir);

let violations = 0;
let justified = 0;
for (const file of files) {
  const result = scan(readFileSync(file, "utf8"));
  justified += result.justified;
  for (const hit of result.unjustified) {
    console.error(`${file}:${hit.line}: unjustified sleep — ${hit.text}`);
    violations += 1;
  }
}

if (violations > 0) {
  console.error(
    `\nSLEEP WALL BREACHED: ${violations} unjustified waitForTimeout call(s) in ${dir}.\n` +
      "Wait for an event, not a duration — a retrying assertion (toHaveText /\n" +
      "toHaveAttribute), expect.poll, waitForResponse, or a requestAnimationFrame\n" +
      "tick. If the wait genuinely has no event to hang off, say so on the line\n" +
      "above it:  // e2e-sleep-allowed: <why no event exists here>",
  );
  process.exit(1);
}

console.log(`sleep wall OK (${files.length} files scanned, ${justified} justified)`);
