// The graph's invariants (M57 part 1): what must stay true however an edge or a
// persona is added, asserted against the contract and the registry rather than
// against the table that produced them.
import { describe, expect, it } from "vitest";
import { HAND_OFF_TARGETS } from "@tc/contracts";
import { capabilitiesOf, type ChangeLimit } from "./capabilities";
import { EDGES, ENTRY, PERSONAS, guardHolds, reachable, type PersonaId, type TurnCaps } from "./personas";
import { SURFACES, type SurfaceKind } from "./grants";

const IDS = Object.keys(PERSONAS) as PersonaId[];
const SURFACE_KINDS = Object.keys(ENTRY) as SurfaceKind[];
const OPEN: TurnCaps = { role: "propose", plan: "propose", classifier: "propose" };

describe("the persona graph", () => {
  it("enters every persona from some page", () => {
    expect([...new Set(Object.values(ENTRY))].sort()).toEqual([...IDS].sort());
  });

  it("is reachable: every persona can be reached from some page under full caps", () => {
    const reached = new Set(SURFACE_KINDS.flatMap((kind) => reachable(ENTRY[kind], OPEN, true)));
    expect([...reached].sort()).toEqual([...IDS].sort());
  });

  it("names only personas that exist as the end of an edge", () => {
    for (const edge of EDGES) {
      expect(IDS, `${edge.via} from`).toContain(edge.from);
      if (edge.to !== null) expect(IDS, `${edge.via} to`).toContain(edge.to);
    }
  });

  // A switch keeps the turn's caps, so it is the only edge that could carry a
  // viewer onto a writing persona; a hand-off ends the turn and the next one
  // resolves its own caps (open_trip lands a read-only account turn on a trip,
  // where the person's role there decides).
  it("never lets a switch take a viewer onto a persona that holds a propose grant", () => {
    const viewer: TurnCaps = { role: "read", plan: "propose", classifier: "propose" };
    const proposes = (id: PersonaId) => PERSONAS[id].grants.some(({ max }) => max === "propose");
    for (const kind of SURFACE_KINDS) {
      if (proposes(ENTRY[kind])) continue;
      for (const id of reachable(ENTRY[kind], viewer, false)) expect(proposes(id), `${kind} -> ${id} for a viewer`).toBe(false);
    }
    for (const edge of EDGES.filter((e) => e.kind === "switch" && proposes(e.to))) expect(edge.guard.role, edge.via).toBe("propose");
  });

  // Every switch edge is a step up in what the turn holds, so it must name the
  // caps that allow it; a bare switch would be a way around a mode.
  it("guards every switch edge on the role and the plan", () => {
    for (const edge of EDGES.filter((e) => e.kind === "switch")) {
      expect(edge.guard.role, edge.via).toBe("propose");
      expect(edge.guard.plan, edge.via).toBe("propose");
    }
  });

  it("offers a hand-off exactly where the capability block says it is a target", () => {
    const limits: [ChangeLimit, TurnCaps][] = [
      [null, OPEN],
      ["role", { ...OPEN, role: "read" }],
      ["plan", { ...OPEN, plan: "read" }],
    ];
    for (const kind of SURFACE_KINDS) {
      for (const [limit, caps] of limits) {
        const offered = EDGES.filter(
          (edge) => edge.kind === "hand-off" && edge.from === ENTRY[kind] && (HAND_OFF_TARGETS as readonly string[]).includes(edge.via) && guardHolds(edge.guard, caps),
        ).map((edge) => edge.via);
        // `plan_page` is a target only where the page is not itself the trip planner.
        expect([...offered].sort(), `${kind}, limit ${limit}`).toEqual([...capabilitiesOf(kind, limit).targets].sort());
      }
    }
  });

  it("derives SURFACES from the entry map", () => {
    for (const kind of SURFACE_KINDS) expect(SURFACES[kind]).toBe(PERSONAS[ENTRY[kind]].grants);
  });
});
