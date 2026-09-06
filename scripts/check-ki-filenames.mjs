import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// THE KI FILENAME WALL: an entry's filename and its heading id must agree.
//
// `docs/known-issues/README.md` states the convention, and the convention is
// deliberately two shapes for one id:
//
//   filename   KI-20260905-c-widget-editor-is-inline-with-its-value.md
//   heading    ### KI-2026-09-05-c — a widget's filter controls render inline…
//
// The filename is dashless so `ls docs/known-issues/open/` sorts by date — and
// that `ls` **is** the index, deliberately, because a committed index file is
// the exact hot-insertion-point defect KI-95 measured. The heading is dashed
// because that is the id people write in prose and cite from source comments.
//
// WHY THIS IS A WALL AND NOT A NOTE IN THE README. The README already says it.
// On 2026-09-04 two entries were filed in the dashed form within an hour of
// that README being read, by an agent that had read it — and they sorted away
// from their neighbours, degrading the one index the register has. Six older
// entries drifted the other way (below). A convention with two shapes needs a
// check, because "which one goes where" is exactly the kind of thing a careful
// reader still gets backwards.
//
// WHAT IT CANNOT CATCH: whether the date is the day the thing was found. That
// is a judgement, and no wall gets it.

// Numeric ids are zero-padded in the filename and unpadded in the heading
// (`KI-095-…md` → `### KI-95`); the README freezes those numbers because they
// are cited from source comments and dozens of docs.
//
// THE DISCRIMINATOR IS ONE LETTER ON A NUMERIC ID AND ONE OR TWO ON A DATE ID,
// and the asymmetry is forced rather than tidy. A date id gets a discriminator
// per entry filed that day, and on 2026-09-05 the register filed **all of
// a–z** and then needed three more — the first time the convention hit its own
// 26-a-day ceiling. Two letters is the smallest fix.
//
// It cannot be extended to numeric ids, and that is measured, not assumed:
// seventeen existing entries have slugs whose first word is exactly two letters
// (`KI-009-ai-model-outputs-…`, `KI-035-no-true-area-field-…`,
// `KI-044-tc-page-editor-…`, `KI-068-db-reset-mjs-…`), and a two-letter
// discriminator on that form reads `ai`, `no`, `tc`, `db` as the discriminator
// and every one of them breaches. Date-form entries have no such collision
// today. The remaining exposure is a FUTURE date entry whose slug opens with a
// one- or two-letter word and carries no discriminator; that fails loudly here
// with a heading/filename mismatch rather than silently, and the fix is to
// reword the slug.
const FILENAME =
  /^(?<prefix>KI|D)-(?:(?<num>\d{3})(?:-(?<numDisc>[a-z]))?|(?<date>\d{8})(?:-(?<dateDisc>[a-z]{1,2}))?)-(?<slug>.+)\.md$/;
const HEADING = /^### (KI|D)-(\S+?) —/;

// Six entries whose HEADING drifted before this wall existed, in both
// directions: a discriminator present in the heading but absent from the
// filename, or the dashless filename form reused as the heading id. Their
// filenames are all correct, so the index still sorts.
//
// They are grandfathered rather than fixed because a heading id is the string
// other files cite — `grep -rn KI-20260830` finds prose, ADRs and source
// comments — so correcting one is a cross-repo edit and its own job, not a
// drive-by inside an unrelated branch. Do not add to this list: a new entry has
// no citations yet, so there is nothing to weigh against getting it right.
const GRANDFATHERED = new Set([
  "KI-20260902-node-26-breaks-the-local-unit-lane-while-ci-stays-green.md",
  "KI-20260830-color-wall-reads-pr-numbers-as-hex.md",
  "KI-20260830-eslint-src-misses-app-root-files.md",
  "KI-20260831-e2e-debris-slows-the-local-lane-to-a-timeout.md",
  "KI-20260831-shared-day-tells-you-about-your-own-publish.md",
  "KI-20260903-notebook-provenance-says-yours-for-a-collaborator.md",
]);

/** The heading id a filename implies, per the README's two shapes. */
export function expectedHeadingId(digits, discriminator) {
  const base =
    digits.length === 8
      ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`
      : String(Number(digits));
  return discriminator ? `${base}-${discriminator}` : base;
}

function scan(dir, file) {
  const name = FILENAME.exec(file);
  if (!name) {
    // Name the dashed-date case explicitly: it is the one that actually
    // happens, and "does not match a regex" is not an instruction.
    const dashed = /^(KI|D)-(\d{4})-(\d{2})-(\d{2})-/.exec(file);
    return dashed
      ? `filename uses the HEADING's dashed date. Rename to ` +
          `${dashed[1]}-${dashed[2]}${dashed[3]}${dashed[4]}-<slug>.md — the ` +
          `dashes belong in the heading, not the filename.`
      : `filename does not match <KI|D>-<NNN|YYYYMMDD>[-<letter>]-<slug>.md`;
  }
  if (GRANDFATHERED.has(file)) return null;

  const { prefix, num, numDisc, date, dateDisc } = name.groups;
  const digits = num ?? date;
  const discriminator = numDisc ?? dateDisc;
  const first = readFileSync(join(dir, file), "utf8").split("\n", 1)[0] ?? "";
  const heading = HEADING.exec(first);
  if (!heading) {
    return `first line is not \`### ${prefix}-<id> — <symptom>\` (found: ${first.slice(0, 60)})`;
  }
  const want = `${prefix}-${expectedHeadingId(digits, discriminator)}`;
  const got = `${heading[1]}-${heading[2]}`;
  return got === want ? null : `heading says ${got}, filename implies ${want}`;
}

const ROOT = process.argv[2] ?? "docs/known-issues";
const violations = [];
let scanned = 0;

for (const sub of ["open", "resolved", "dormant"]) {
  const dir = join(ROOT, sub);
  let entries;
  try {
    entries = readdirSync(dir).sort();
  } catch {
    continue; // A fixture tree need not carry all three.
  }
  for (const file of entries) {
    if (!file.endsWith(".md") || file === "README.md") continue;
    scanned += 1;
    const problem = scan(dir, file);
    if (problem) violations.push(`${join(sub, file)}: ${problem}`);
  }
}

if (violations.length > 0) {
  for (const line of violations) console.error(line);
  console.error(
    `\nKI FILENAME WALL BREACHED: ${violations.length} entr(y|ies) whose name and heading disagree.\n` +
      "The convention is two shapes for one id, and each has a job:\n" +
      "  filename  KI-20260905-c-<slug>.md   dashless, so `ls open/` sorts by date\n" +
      "                                       (a date id may take two letters,\n" +
      "                                        -aa onward, once a-z are used)\n" +
      "  heading   ### KI-2026-09-05-c — …   dashed, because that is what prose cites\n" +
      "docs/known-issues/README.md has the rest.",
  );
  process.exit(1);
}

console.log(`ki filename wall OK (${scanned} entries scanned, ${GRANDFATHERED.size} grandfathered)`);
