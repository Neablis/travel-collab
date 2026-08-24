import { execSync } from "node:child_process";

// KI-33 GUARD: no two tracked paths may differ only in case.
//
// `UnscheduledRack.tsx` and `unscheduledRack.ts` coexisted happily on CI's
// ext4 and were invisible there, while on macOS APFS and Windows NTFS the
// specifier `@/components/trip/UnscheduledRack` could resolve to whichever
// landed in the module graph first. That cost 25 failing unit tests, a TS1149,
// and — the expensive part — `next build` failing outright on every developer
// machine, which took `test:e2e:ci-like` with it and left CI as the only
// trustworthy signal for four days.
//
// CI is precisely where that bug class is invisible, so this check has to be
// explicit rather than emergent: nothing else in the pipeline can see it.
const files = execSync("git ls-files", { encoding: "utf8" }).split("\n").filter(Boolean);

const byLower = new Map();
for (const file of files) {
  const key = file.toLowerCase();
  if (!byLower.has(key)) byLower.set(key, []);
  byLower.get(key).push(file);
}

const collisions = [...byLower.values()].filter((group) => group.length > 1);

if (collisions.length > 0) {
  for (const group of collisions) {
    console.error(`case-only collision: ${group.join("  ↔  ")}`);
  }
  console.error(
    "\nThese resolve to one file on macOS/Windows. Rename one — prefer naming a " +
      "module after what it exports (KI-33 renamed unscheduledRack.ts to fitIntoDay.ts).",
  );
  process.exit(1);
}

console.log(`case collision check OK (${files.length} tracked paths)`);
