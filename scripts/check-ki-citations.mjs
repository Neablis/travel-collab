import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

// THE KI CITATION WALL: a status file that cites a known-issue entry may not
// name a variable that entry is not about.
//
// WHAT IT COST TO LEARN THIS. On 2026-09-19 three status documents — `TODO.md`,
// `docs/milestones/README.md` and `docs/STATUS.md` — all said M22's open gate
// box was blocked on `API_TOKEN_PEPPER`, each citing `KI-2026-09-16-d`. That
// entry has never mentioned that variable: it is about `ADMIN_USER_IDS`, which
// is injected at build time so `POST /api/admin/grants` answers 404 on a
// preview. The wrong name survived for three days and was then copied into two
// MORE places by a session that read all three and never opened the entry they
// cited — because three documents agreeing looks exactly like corroboration.
//
// `API_TOKEN_PEPPER` was in fact set on all three Vercel targets the whole
// time. The milestone box was never blocked on it, so every plan made against
// those three files was planning around a blocker that did not exist.
//
// THE RULE, and why it is checkable at all. A status file's job is to POINT at
// the register, not to restate it. So: take any SENTENCE in a watched file that
// both cites an entry and names a `CONSTANT_CASE` identifier, and require that
// identifier to appear in the cited entry's **Area:** field. That field is the
// register's own statement of what an entry is about, and it is where a real
// subject lives.
//
// WHY **Area:** AND NOT THE WHOLE ENTRY. Because the whole entry is defeated by
// the correction itself. Fixing the incident above meant writing "three status
// files said this was about `API_TOKEN_PEPPER`; it is not" INTO
// `KI-2026-09-16-d` — after which a body-text match finds the string and passes
// the exact association the entry exists to deny. Measured, not predicted: the
// first draft of this wall did precisely that and reported the bug as clean.
//
// WHAT IT CANNOT CATCH, stated so nobody reads more into a green line than is
// there:
//   - A wrong claim that names no CONSTANT_CASE identifier. "Blocked on a
//     missing secret" cites nothing checkable.
//   - A wrong claim in a file that is not watched. The list below is the
//     incident's own three files; widening it is cheap and deliberate.
//   - Whether the ENTRY is right. This wall keeps the copies honest to the
//     source; it has no opinion about the source. `KI-2026-09-16-d`'s own fix
//     sketch turned out to be wrong on the same day, and nothing mechanical
//     could have told anyone.

const WATCHED = ["TODO.md", "docs/STATUS.md", "docs/milestones/README.md"];
const REGISTER = "docs/known-issues";
const SUBDIRS = ["open", "resolved", "dormant"];

// `API_TOKEN_PEPPER`, `ADMIN_USER_IDS` — two or more SCREAMING_SNAKE segments.
// One segment (`CI`, `M22`, `ADR`) is far too common in prose to be a signal.
const IDENTIFIER = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g;

// Both spellings the register uses: `KI-20260916-d` (filename) and
// `KI-2026-09-16-d` (heading, and what prose cites), plus numeric `KI-095`.
const CITATION = /\b(?:KI|D)-\d{3,4}(?:-?\d{2}-?\d{2})?-?[a-z]{0,2}\b/g;

const FILENAME_ID = /^(KI|D)-(\d{8}|\d{3})(?:-([a-z]{1,2}))?-/;

/** One id shape both spellings collapse to, so a citation can find its file. */
function normalise(citation) {
  const dated = /^(KI|D)-(\d{4})-?(\d{2})-?(\d{2})-([a-z]{1,2})$/.exec(citation);
  if (dated) return `${dated[1]}|${dated[2]}${dated[3]}${dated[4]}|${dated[5]}`;
  const numeric = /^(KI|D)-(\d{1,3})(?:-([a-z]))?$/.exec(citation);
  if (numeric) return `${numeric[1]}|${numeric[2].padStart(3, "0")}|${numeric[3] ?? ""}`;
  return null;
}

/**
 * The entry's `- **Area:** …` field, up to the next field.
 *
 * Multi-line on purpose: the field routinely wraps across three or four lines
 * and names several files, and reading only the first would make the wall fire
 * on entries that are perfectly correct.
 */
function areaOf(source) {
  const match = /^- \*\*Area:\*\*([\s\S]*?)(?=\n- \*\*)/m.exec(source);
  return match === null ? null : match[1];
}

const root = process.argv[2] ?? ".";

const entries = new Map();
for (const sub of SUBDIRS) {
  let names;
  try {
    names = readdirSync(join(root, REGISTER, sub));
  } catch {
    continue; // A fixture tree need not carry all three.
  }
  for (const name of names) {
    if (!name.endsWith(".md") || name === "README.md") continue;
    const id = FILENAME_ID.exec(name);
    if (id === null) continue; // The FILENAME wall owns that complaint.
    const key = `${id[1]}|${id[2]}|${id[3] ?? ""}`;
    entries.set(key, join(root, REGISTER, sub, name));
  }
}

const violations = [];
let pairs = 0;
let skippedNoArea = 0;

for (const file of WATCHED) {
  let source;
  try {
    source = readFileSync(join(root, file), "utf8");
  } catch {
    continue; // A fixture tree need not carry every watched file.
  }
  // Sentence-ish: a run ending in terminal punctuation, or a blank line. A
  // whole paragraph would be too wide — these files routinely discuss two
  // unrelated things in adjacent sentences, and every one of those would fire.
  for (const sentence of source.split(/(?<=[.!?])\s+|\n\n/)) {
    const cited = sentence.match(CITATION);
    if (cited === null) continue;
    const named = new Set(sentence.match(IDENTIFIER) ?? []);
    if (named.size === 0) continue;
    for (const citation of cited) {
      const key = normalise(citation.replace(/-$/, ""));
      if (key === null) continue;
      const path = entries.get(key);
      if (path === undefined) continue; // Unknown id: not this wall's complaint.
      const area = areaOf(readFileSync(path, "utf8"));
      if (area === null) {
        skippedNoArea += 1;
        continue;
      }
      for (const identifier of named) {
        pairs += 1;
        if (!area.includes(identifier)) {
          violations.push(
            `${file}: cites ${citation} while naming \`${identifier}\`, which is absent from ` +
              `${basename(path)}'s Area field.\n    ${sentence.trim().slice(0, 160)}`,
          );
        }
      }
    }
  }
}

if (violations.length > 0) {
  for (const line of violations) console.error(line);
  console.error(
    `\nKI CITATION WALL BREACHED: ${violations.length} claim(s) whose cited entry is about something else.\n` +
      "A status file points at the register; it does not restate it. Either:\n" +
      "  - the status file has the wrong variable (the usual case — fix the status file), or\n" +
      "  - the entry's Area field is out of date (fix the entry, in the same commit).\n" +
      "Read the entry before choosing. On 2026-09-19 three files agreed with each\n" +
      "other and all three were wrong, because nobody opened the one document\n" +
      "written by somebody looking at the actual failure.",
  );
  process.exit(1);
}

// A wall that checks nothing passes silently, which is the failure mode this
// repo has already paid for twice. The register is the floor worth asserting:
// prose comes and goes, but an empty index means the glob or the id regex broke.
if (entries.size < 50) {
  console.error(
    `KI CITATION WALL: only ${entries.size} entries indexed under ${REGISTER}/. ` +
      "That is too few to have worked — the register moved, or the filename regex did.",
  );
  process.exit(1);
}

console.log(
  `ki citation wall OK (${pairs} identifier/citation pair(s) checked against ${entries.size} entries` +
    `${skippedNoArea > 0 ? `, ${skippedNoArea} skipped for having no Area field` : ""})`,
);
