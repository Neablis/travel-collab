import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { addCounts } from "./savedDayAdds";

const AUTHOR = "author";
const TAKER = "taker";
const DATED = "2027-04-01";

// The two clauses `addCounts` owns. (The third — once per trip — is the
// composite primary key on `saved_day_adds`, and is proven against the ledger
// in `app/api/trips/[tripId]/saved-days/[savedDayId]/route.int.test.ts`.)
describe("addCounts", () => {
  it("counts a dated trip taken by somebody other than the author", () => {
    expect(addCounts({ authorId: AUTHOR, actorId: TAKER, tripStartDate: DATED })).toBe(true);
  });

  it("does not count a trip with no dates", () => {
    expect(addCounts({ authorId: AUTHOR, actorId: TAKER, tripStartDate: null })).toBe(false);
  });

  it("does not count the author taking their own day", () => {
    expect(addCounts({ authorId: AUTHOR, actorId: AUTHOR, tripStartDate: DATED })).toBe(false);
  });

  // Both clauses at once. Stated separately because a `&&` written as an `||`
  // passes each single-clause case above.
  it("does not count the author taking their own day into an undated trip", () => {
    expect(addCounts({ authorId: AUTHOR, actorId: AUTHOR, tripStartDate: null })).toBe(false);
  });
});

// `savedDayAdds.ts` says "nothing outside this module may touch
// `saved_days.adds`", and a comment asserting an invariant is a lie with a
// timer on it unless something enforces it (AGENTS.md). The denormalised
// counter is only trustworthy because it moves in lockstep with a ledger row,
// which is one function; a second writer anywhere would break that silently and
// no runtime test could see it, because the offending call site would simply
// not be on any path a test exercises.
//
// The same shape as `scripts/check-lint-wall.mjs` and
// `preview-registry.test.ts`: a source scan, kept narrow enough to name what it
// found.
describe("the counter has exactly one writer", () => {
  const SERVER_DIR = path.resolve(__dirname);
  const OWNER = "savedDayAdds.ts";

  function tsFilesUnder(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return tsFilesUnder(full);
      return entry.isFile() && entry.name.endsWith(".ts") ? [full] : [];
    });
  }

  it("is only assigned in savedDayAdds.ts", () => {
    const offenders = tsFilesUnder(SERVER_DIR)
      .filter((file) => path.basename(file) !== OWNER && !file.endsWith(".test.ts"))
      // A Drizzle `.set({ adds: ... })` on the saved-days table. `newSavedDayRow`
      // in savedDays.ts writes `adds: 0` on a row that has no ledger at all,
      // which is the zero value and not a move — hence `set(`, not the field
      // name alone.
      .filter((file) => /\.set\(\s*\{[^}]*\badds\b/s.test(readFileSync(file, "utf8")));
    expect(offenders.map((f) => path.relative(SERVER_DIR, f))).toEqual([]);
  });
});
