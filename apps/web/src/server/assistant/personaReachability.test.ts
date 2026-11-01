// **Which personas a turn can reach, held in a committed baseline so opening or
// closing a path is a reviewed diff** (M57, ADR-085 decision 3), in the pattern
// of `ai/contextBudget.test.ts`. For every page a turn can start on and every
// combination of the three caps that are not the page's, it records the
// personas reachable inside the turn (`switch` edges) and the ones a person can
// end up at (adding `hand-off` buttons). The Mermaid drawing in
// `docs/architecture/personas.mmd` is checked for drift beside it.
//
// Any change fails until both are regenerated:
//
//   UPDATE_PERSONA_GRAPH=1 pnpm --filter web exec vitest run \
//     -c vitest.unit.config.ts src/server/assistant/personaReachability.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { ENTRY, personaMermaid, reachable, type PersonaId, type TurnCaps } from "./personas";
import type { SurfaceKind } from "./grants";

const BASELINE = new URL("./personaReachability.baseline.json", import.meta.url);
const MERMAID = new URL("../../../../../docs/architecture/personas.mmd", import.meta.url);

const LEVELS = ["read", "propose"] as const;

interface Reach {
  entry: PersonaId;
  inTurn: PersonaId[];
  withHandOffs: PersonaId[];
}

function measure(): Record<string, Reach> {
  const out: Record<string, Reach> = {};
  for (const surface of Object.keys(ENTRY) as SurfaceKind[]) {
    for (const role of LEVELS) for (const plan of LEVELS) for (const classifier of LEVELS) {
      const caps: TurnCaps = { role, plan, classifier };
      out[`${surface} | role=${role} plan=${plan} classifier=${classifier}`] = {
        entry: ENTRY[surface],
        inTurn: reachable(ENTRY[surface], caps, false),
        withHandOffs: reachable(ENTRY[surface], caps, true),
      };
    }
  }
  return out;
}

/** Every line that moved, readable without the JSON. */
function changesBetween(baseline: Record<string, Reach>, current: Record<string, Reach>): string[] {
  const lines: string[] = [];
  for (const key of new Set([...Object.keys(baseline), ...Object.keys(current)])) {
    const before = baseline[key];
    const after = current[key];
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      lines.push(`${key}: ${JSON.stringify(before ?? "absent")} -> ${JSON.stringify(after ?? "absent")}`);
    }
  }
  return lines;
}

describe("persona reachability", () => {
  it("matches the committed baseline, so opening or closing a path is a reviewed diff", () => {
    const current = measure();
    if (process.env.UPDATE_PERSONA_GRAPH === "1") {
      writeFileSync(BASELINE, `${JSON.stringify(current, null, 2)}\n`);
      writeFileSync(MERMAID, personaMermaid());
      return;
    }
    const baseline = JSON.parse(readFileSync(BASELINE, "utf8")) as Record<string, Reach>;
    expect(
      changesBetween(baseline, current),
      "A path through the persona graph opened or closed. If that is intended, regenerate " +
        "personaReachability.baseline.json and personas.mmd (UPDATE_PERSONA_GRAPH=1, see this file's header); " +
        "if it is not, find the edge or guard that moved.",
    ).toEqual([]);
  });

  it("draws the graph that is in code, so docs/architecture/personas.mmd cannot drift", () => {
    if (process.env.UPDATE_PERSONA_GRAPH === "1") return;
    expect(readFileSync(MERMAID, "utf8"), "personas.mmd is stale: regenerate it (see this file's header).").toBe(personaMermaid());
  });
});
