import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

// RED-FIRST, as one command instead of six steps.
//
// `docs/guidelines/testing.md` §3 is the rule: a test is not done until you
// have seen it fail *for your reason*. Break the code it protects, watch it go
// red, restore it, watch it go green. That drill is the default proof in this
// repo and it is entirely manual — `pnpm mutate` is the other instrument
// (Stryker, exhaustive, per-file), for when "break the code" has too many
// meanings to pick one. This is for when it has exactly one.
//
// WHY IT IS WORTH A SCRIPT. On PR #141 the drill ran 55 times, and every
// repetition was the same six steps by hand: copy the file somewhere, patch it,
// run one test, read the output, copy it back, hope. Three failure modes, all
// of which happened or nearly did:
//
//   1. NOT RESTORING. A crash, a timeout, or a forgotten step between the
//      patch and the copy-back leaves a mutated working tree that looks clean
//      in `git status` only if you remember to look. Here the restore is a
//      `finally` plus signal handlers.
//   2. NO BASELINE. If the test was already red, watching it be red proves
//      nothing at all. This runs the command green-first and refuses to
//      continue if it is not passing.
//   3. A MUTATION THAT DID NOT APPLY. A hand-patched string that silently
//      matched nothing means the test "went green under mutation" — a false
//      SURVIVED, which reads as a weak test and is not one. This counts the
//      occurrences and refuses anything but exactly one.
//
// USAGE
//
//   pnpm redfirst --file packages/pages/src/select.ts \
//     --replace 'filters.day === undefined' --with 'false' \
//     --test 'pnpm --filter @tc/pages exec vitest run src/select.test.ts'
//
// Exit 0 means the test went red: it bites, and the failure text is printed for
// the PR template's "the real failure text" line. Exit 1 means it stayed green
// — the finding. Before concluding the test is weak, re-aim: a green mutation
// is more often pointed at the wrong constant (PR #141, three times out of
// four) than at a test that does not care.

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const file = arg("file");
const replace = arg("replace");
const wth = arg("with");
const test = arg("test");
const allowMany = process.argv.includes("--all");

if (!file || replace === undefined || wth === undefined || !test) {
  console.error(
    "usage: pnpm redfirst --file <path> --replace <old> --with <new> --test <command>\n" +
      "       --all   allow the replacement to match more than once\n\n" +
      "Runs <command> green, applies the edit, runs it again, and restores the\n" +
      "file whatever happens. Exit 0 = the test went red (it bites).",
  );
  process.exit(2);
}

const run = (label) => {
  console.log(`\n── ${label}: ${test}`);
  const r = spawnSync(test, { shell: true, encoding: "utf8" });
  return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
};

const original = readFileSync(file, "utf8");
let restored = false;
const restore = () => {
  if (restored) return;
  writeFileSync(file, original);
  restored = true;
};
// A killed process is the case that leaves a mutated tree behind, so the
// handlers matter more than the `finally` does.
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    restore();
    console.error(`\nrestored ${file} after ${sig}`);
    process.exit(130);
  });
}

try {
  const before = run("baseline (must pass)");
  if (!before.ok) {
    console.error(
      `\nBASELINE IS RED. \`${test}\` fails before any mutation, so watching it\n` +
        "fail afterwards would prove nothing. Fix that first.",
    );
    console.error(before.out.trimEnd().split("\n").slice(-20).join("\n"));
    process.exit(2);
  }

  const hits = original.split(replace).length - 1;
  if (hits === 0) {
    console.error(`\nNOTHING TO MUTATE: ${file} does not contain the --replace string.`);
    process.exit(2);
  }
  if (hits > 1 && !allowMany) {
    console.error(
      `\nAMBIGUOUS: --replace matches ${hits} times in ${file}. Narrow it, or pass --all\n` +
        "if changing every occurrence is genuinely the one mutation you mean.",
    );
    process.exit(2);
  }
  writeFileSync(file, allowMany ? original.split(replace).join(wth) : original.replace(replace, wth));
  console.log(`\nmutated ${file}: ${hits} occurrence(s)\n  - ${replace}\n  + ${wth}`);

  const after = run("mutated (must fail)");
  restore();

  if (after.ok) {
    console.error(
      `\nSURVIVED. The mutation applied and every test still passed.\n` +
        "Either the assertion does not cover this line, or — more often — the\n" +
        "mutation is aimed at the wrong constant. Re-aim before concluding the\n" +
        "test is weak. (testing.md §3, and working-a-review.md's last section.)",
    );
    process.exit(1);
  }

  console.log("\n── the failure, for the PR body ──");
  // The tail is where the assertion lives; the head is usually the runner's
  // banner. Twenty-five lines has covered every runner in this repo.
  console.log(after.out.trimEnd().split("\n").slice(-25).join("\n"));
  console.log(`\nRED-FIRST OK: ${file} restored, and the test failed for the mutation above.`);
} finally {
  restore();
}
