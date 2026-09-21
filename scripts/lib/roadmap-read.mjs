// One parser for the roadmap files, shared by every command that reads them.
//
// WHY THIS IS A LIB AND NOT A SECOND SCRIPT
//
// `scripts/state-digest.mjs` grew these readers first. The moment a second
// command needed "which milestone is current" — `pnpm milestones`,
// `pnpm candidates`, `pnpm milestone close` — the choice was one shared parse
// or several. Several is the "two chances to disagree" failure
// `apps/web/src/server/public-api/openapi.ts` names explicitly, and it is the
// worst possible failure for THIS set of files, whose entire problem is that
// four places record the same fact and drift apart. A tool built to report
// drift must not be able to drift from itself.
//
// THE ANCHOR CONTRACT, AND WHY IT IS EXPLICIT
//
// Every reader here locates content by a prose anchor — a heading, a marker, a
// line prefix — in a file people edit by hand. When somebody reformats a
// heading, a regex that no longer matches does not crash: it returns nothing,
// and nothing reads exactly like "there is no work here".
//
// That is not hypothetical. Extracting this lib on 2026-09-21 found it live:
// the old `readMilestoneGate` matched `/^##\s+Exit gate/i`, and the CURRENT
// milestone's file (`M26-design-parity.md`) heads its gates `## Wave 1 exit
// gate` and `## Wave 2 exit gate`. So the digest had been printing no gate
// tally for M26 at every session start, and `findDrift`'s "every box is ticked
// but TODO still has it unchecked" check could never fire for any
// wave-structured milestone. Nobody noticed, because the absence was silent.
//
// So: every reader reports `anchorMissing: true` rather than an empty result,
// and the CALLER decides what that means. The split is deliberate:
//
//   - A read-only, advisory caller (the SessionStart digest) prints a warning
//     and carries on. A digest that can fail a session start is worth less
//     than the session.
//   - A WRITING caller (`milestone close`) throws. Editing four files off a
//     parse that silently found nothing is how you corrupt all four.
//
// `assertAnchors()` at the bottom is the writing caller's gate.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// --- shared helpers ---------------------------------------------------------

export function readLines(path) {
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, "utf8").split("\n");
  } catch {
    return null;
  }
}

/** Strips the markdown a heading or list item carries so a title reads as text. */
export function plain(text) {
  return String(text ?? "")
    .replace(/`/g, "")
    .replace(/\*\*/g, "")
    .replace(/~~/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function truncate(text, max) {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Milestone ids are M<n> with an optional letter suffix: M9, M17, M11a, M18b. */
export function milestoneId(text) {
  const match = /\bM(\d+[a-z]?)\b/.exec(text ?? "");
  return match ? `M${match[1]}` : null;
}

/**
 * Every exit-gate heading shape that exists in docs/milestones/, surveyed
 * 2026-09-21 rather than guessed:
 *
 *   23  ## Exit gate
 *    5  ## Exit gate — all must be true
 *    2  ## Wave 2 exit gate
 *    1  ## Wave 1 exit gate
 *    1  ### Wave 2 exit gate — all must be true
 *    1  ## Exit gate — all must be true (drafted …)
 *
 * Two things this must get right and the old regex did not: `###` as well as
 * `##`, and an optional `Wave N` before "exit gate". A milestone may have more
 * than one gate heading, and its gate is the UNION of them — M26 is not done
 * when Wave 1 is done.
 */
const EXIT_GATE_HEADING = /^#{2,3}\s+(?:wave\s+\d+\s+)?exit gate\b/i;

/** A checkbox line, with the struck-out (descoped) case called out. */
const CHECKBOX = /^\s*[-*]\s+\[( |x|X)\]\s*(.*)$/;

// --- readers ----------------------------------------------------------------

/**
 * The "Current milestone" line at the bottom of docs/milestones/README.md.
 * AGENTS.md designates that line the single source of truth for the number,
 * and the gate-close checklist's step 4 is what bumps it.
 */
export function readCurrentMilestone(root) {
  const rel = "docs/milestones/README.md";
  const lines = readLines(join(root, rel));
  if (!lines) return { rel, missing: true, anchorMissing: true };
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const match = /^Current milestone:\s*(.+?)\s*$/.exec(lines[i]);
    if (!match) continue;
    const label = plain(match[1]);
    return { rel, line: i + 1, label, id: milestoneId(label) };
  }
  return { rel, missing: true, anchorMissing: true };
}

/** The file for a milestone id, or null. */
export function milestoneFile(root, id) {
  if (!id) return null;
  try {
    const name = readdirSync(join(root, "docs/milestones")).find(
      (f) => f.startsWith(`${id}-`) && f.endsWith(".md"),
    );
    return name ? `docs/milestones/${name}` : null;
  } catch {
    return null;
  }
}

/**
 * How much of a milestone's exit gate is ticked, summed across every gate
 * heading in the file (see EXIT_GATE_HEADING on why there can be several).
 *
 * `anchorMissing` distinguishes "this milestone has no gate section" from
 * "this milestone's gate has zero boxes", which are very different facts and
 * which the previous implementation rendered identically.
 */
export function readMilestoneGate(root, id) {
  if (!id) return null;
  const rel = milestoneFile(root, id);
  if (!rel) return null;
  const lines = readLines(join(root, rel));
  if (!lines) return { rel, anchorMissing: true };

  const gates = [];
  let ticked = 0;
  let open = 0;
  let descoped = 0;

  for (let i = 0; i < lines.length; i += 1) {
    if (!EXIT_GATE_HEADING.test(lines[i])) continue;
    const heading = plain(lines[i].replace(/^#{2,3}\s+/, ""));
    const gate = { heading, line: i + 1, ticked: 0, open: 0, descoped: 0 };
    // The depth of THIS heading decides where its section ends: a `### Wave 2
    // exit gate` is closed by the next `###` or `##`, but a `## Exit gate` is
    // not closed by a `###` nested under it.
    const depth = /^###/.test(lines[i]) ? 3 : 2;
    const closer = depth === 3 ? /^#{2,3}\s/ : /^#{2}\s/;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (closer.test(lines[j])) break;
      const box = CHECKBOX.exec(lines[j]);
      if (!box) continue;
      // A `- [ ] ~~…~~` box is scope struck out of the gate, not work
      // outstanding. The raw line is tested because plain() strips `~~`.
      if (/^~~/.test(box[2])) gate.descoped += 1;
      else if (box[1] === " ") gate.open += 1;
      else gate.ticked += 1;
    }
    ticked += gate.ticked;
    open += gate.open;
    descoped += gate.descoped;
    gates.push(gate);
  }

  if (gates.length === 0) return { rel, anchorMissing: true, ticked: 0, open: 0, descoped: 0, gates };
  return { rel, line: gates[0].line, ticked, open, descoped, gates };
}

/**
 * TODO.md carries two claims about the current work and they are allowed to
 * disagree: the first unchecked item (the file's own stated rule) and the
 * explicit `← current milestone` marker (which the file says records a
 * Mitchell decision that overrides position). Read both; report both.
 */
export function readTodo(root) {
  const rel = "TODO.md";
  const lines = readLines(join(root, rel));
  if (!lines) return { rel, missing: true, anchorMissing: true };
  let first = null;
  let marker = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!/^\s*[-*]\s+\[/.test(line)) continue;
    if (!first && /^\s*[-*]\s+\[ \]/.test(line)) {
      // Cut at the `←` marker: what follows it is commentary on the decision,
      // and the marker itself is reported on its own line below.
      const text = plain(line.replace(/^\s*[-*]\s+\[ \]\s*/, "")).split("←")[0];
      first = { line: i + 1, text: truncate(text.trim(), 72) };
      first.id = milestoneId(first.text);
    }
    if (!marker && /←\s*\**current milestone/i.test(line)) {
      marker = { line: i + 1, id: milestoneId(plain(line)) };
    }
  }
  // No unchecked item at all means the roadmap is finished or the file moved;
  // either way a caller that writes must not proceed on the assumption.
  return { rel, first, marker, anchorMissing: !first && !marker };
}

/**
 * STATUS.md's leading "where the work is" block only — the first few lines of
 * it, not the section. The file is large and this is the part that answers
 * "what is in flight"; everything else it says is a pointer to somewhere else.
 */
export function readStatus(root, { lineCount = 3, lineMax = 96 } = {}) {
  const rel = "docs/STATUS.md";
  const lines = readLines(join(root, rel));
  if (!lines) return { rel, missing: true, anchorMissing: true };
  const start = lines.findIndex((l) => /^##\s+Where the work is/i.test(l));
  if (start === -1) return { rel, missing: true, anchorMissing: true };
  const said = [];
  let end = lines.length;
  for (let i = start + 1; i < lines.length && said.length < lineCount; i += 1) {
    if (/^##\s/.test(lines[i])) {
      end = i;
      break;
    }
    const text = plain(lines[i]);
    // Tables and rules carry no sentence; a line ending in a colon is a
    // lead-in to content this digest is not going to print, and a lead-in with
    // nothing under it is worse than not printing it at all.
    if (!text || text.startsWith("|") || /^-{3,}$/.test(text) || text.endsWith(":")) continue;
    said.push(truncate(text, lineMax));
  }
  // `end` is only advanced by the `##` break above; when the loop stops
  // because it filled `said`, the block still runs to the next heading and
  // `mentions` must cover all of it or the STATUS drift check reads a
  // truncated body and reports a milestone missing that is present.
  if (end === lines.length) {
    for (let i = start + 1; i < lines.length; i += 1) {
      if (/^##\s/.test(lines[i])) {
        end = i;
        break;
      }
    }
  }
  const body = lines.slice(start, end).join(" ");
  return { rel, line: start + 1, said, mentions: body };
}

// --- drift ------------------------------------------------------------------

/**
 * Mismatches between the four places a milestone's state is recorded. These
 * are FACTS, not verdicts: the marker overriding position is a legitimate
 * state this repo uses deliberately, so the wording says what disagrees and
 * leaves the judgement to a person (or to /roadmap).
 */
export function findDrift({ milestone, todo, gate, status }) {
  const drift = [];
  const current = milestone.id;

  if (current && todo.marker?.id && todo.marker.id !== current) {
    drift.push(
      `TODO.md's "← current milestone" marker says ${todo.marker.id}, ` +
        `milestones/README.md says ${current}  [${todo.rel}:${todo.marker.line} vs ${milestone.rel}:${milestone.line}]`,
    );
  }
  if (current && todo.first?.id && todo.first.id !== current) {
    drift.push(
      `TODO.md's first unchecked item is ${todo.first.id}, not ${current} ` +
        `(fine if the marker names a decision — check it)  [${todo.rel}:${todo.first.line}]`,
    );
  }
  if (current && status.mentions && !new RegExp(`\\b${current}\\b`).test(status.mentions)) {
    drift.push(
      `STATUS.md's "Where the work is right now" never mentions ${current} — ` +
        `gate-close step 5  [${status.rel}:${status.line}]`,
    );
  }
  if (gate && gate.open === 0 && gate.ticked > 0 && todo.first?.id === current) {
    drift.push(
      `every ${current} exit-gate box is ticked but TODO.md still has it unchecked ` +
        `[${gate.rel}:${gate.line} vs ${todo.rel}:${todo.first.line}]`,
    );
  }
  return drift;
}

// --- the writing caller's gate ----------------------------------------------

export class AnchorError extends Error {
  constructor(missing) {
    super(
      `roadmap-read: ${missing.length} anchor(s) not found — refusing to continue.\n` +
        missing.map((m) => `  - ${m}`).join("\n") +
        `\n\nA reader located content by a heading or marker that is no longer there.\n` +
        `Nothing was written. Fix the anchor, or the file it points into, and re-run.`,
    );
    this.name = "AnchorError";
    this.missing = missing;
  }
}

/**
 * Throws unless every reader passed here found its anchor. Call this from any
 * command that WRITES. Read-only callers should check `anchorMissing`
 * themselves and degrade with a warning instead.
 */
export function assertAnchors(readers) {
  const missing = [];
  for (const [what, result] of Object.entries(readers)) {
    if (!result) {
      missing.push(`${what}: reader returned nothing`);
    } else if (result.anchorMissing) {
      missing.push(`${what}: anchor not found in ${result.rel ?? "(unknown file)"}`);
    }
  }
  if (missing.length > 0) throw new AnchorError(missing);
}
