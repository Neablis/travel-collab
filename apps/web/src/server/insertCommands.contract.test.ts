import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// M23 link 3's gate box, as a test rather than as a note in a review checklist:
// **"A test fails if a second construction of `AddDay` from saved stops appears
// anywhere in the tree."**
//
// The milestone asks for one insert primitive with three callers — add a
// Playbook to an existing trip, start a new trip from one day, start a new trip
// from N days — and answers the older "does it reuse the fork path or get its
// own?" with *neither and both*. The precedent it cites is this repo's own:
// `citiesOfDay` folds `citiesOfStops` so a profile's cities cannot disagree
// with Discover's, and `rollupCosts` is read by both `detail.ts` and
// `conflicts.ts` rather than being summed twice. A second materialisation of
// saved stops into trip days would be free to disagree about day boundaries,
// about how many days an empty one costs, and about whether the whole thing is
// one batch — and it would disagree only for the people who used the other
// door.
//
// **Why a source scan rather than a behavioural test.** The property is "there
// is no second one", and no amount of exercising the first one can observe a
// second one existing. This is the same shape as the lint wall and the colour
// wall, and it is checked here for the same reason they are checked at all.

const SRC = fileURLToPath(new URL("..", import.meta.url));

/** Every `.ts`/`.tsx` under `src`, minus tests — tests may build whatever they like. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return entry === "node_modules" ? [] : sourceFiles(full);
    if (!/\.tsx?$/.test(entry)) return [];
    if (/\.(test|int\.test)\.tsx?$/.test(entry)) return [];
    return [full];
  });
}

describe("materialising saved stops into trip days has exactly one implementation", () => {
  // **The property, stated exactly:** every file that mints days AND knows
  // about saved days either IS the primitive or CALLS it. Both halves of that
  // are load-bearing, and getting them wrong is how this test would become
  // noise:
  //
  //   * `type: "AddDay"` on its own is the ordinary "add a day to this trip"
  //     button (`TripBoardScreen.tsx`) and a `ProposedChange` label in the
  //     assistant (`ai/writeTools.ts`). Neither is a second implementation of
  //     anything, and a test that flagged them would be deleted within a month.
  //   * `\bSavedDay\b` rather than a substring, so `AddSavedDayButton` and
  //     `addSavedDay={...}` — a component and a prop — do not count as knowing
  //     about the shape.
  //   * Mentioning `insertCommands` clears a file, because that is either the
  //     definition (`server/savedDays.ts`) or a caller. There are four callers
  //     today: `insertSavedDay` for "add to a trip", the same path again behind
  //     `AddToTripDialog`'s "Start a new trip", and the assistant's approved
  //     insert. All four go through the one function, which is the whole point.
  it("has no file that mints days from saved stops without going through insertCommands", () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => {
        const text = readFileSync(file, "utf8");
        if (!text.includes('type: "AddDay"')) return false;
        if (!/\bSavedDay\b|\bSavedStop\b/.test(text)) return false;
        return !text.includes("insertCommands");
      })
      .map((file) => file.slice(SRC.length));

    expect(offenders).toEqual([]);
  });

  // The definition is where it is said to be. Without this, the test above
  // passes just as happily if `insertCommands` is deleted altogether.
  it("keeps that one implementation in server/savedDays.ts", () => {
    const primitive = readFileSync(join(SRC, "server", "savedDays.ts"), "utf8");
    expect(primitive).toContain("export function insertCommands");
    expect(primitive).toContain('type: "AddDay"');
  });
});
