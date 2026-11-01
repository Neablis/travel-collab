// The graph's invariants (M57 part 1): what must stay true however an edge or a
// persona is added, asserted against the contract and the registry rather than
// against the table that produced them.
import { describe, expect, it } from "vitest";
import { HAND_OFF_TARGETS } from "@tc/contracts";
import { capabilitiesOf, type ChangeLimit } from "./capabilities";
import { EDGES, ENTRY, PERSONAS, guardHolds, reachable, switchTargetsOf, type PersonaId, type TurnCaps } from "./personas";
import { SURFACES, type SurfaceKind } from "./grants";
import { SURFACE_INTENTS } from "./intents";
import { ASSISTANT_TOOLS } from "./registry";
import { personaMermaid } from "./personas";

const IDS = Object.keys(PERSONAS) as PersonaId[];
const SURFACE_KINDS = Object.keys(ENTRY) as SurfaceKind[];
const OPEN: TurnCaps = { role: "propose", plan: "propose", classifier: "propose" };

describe("the persona graph", () => {
  // Discover is the one persona no page enters: a turn gets there by
  // `switch_persona` from Schedule (M57 part 4), so the test says which, and
  // would fail for a persona that is neither entered nor switched to.
  it("enters every persona from some page, or by a switch from one that is entered", () => {
    const entered = new Set(Object.values(ENTRY));
    const switchedTo = new Set(EDGES.filter((e) => e.kind === "switch" && e.via === "switch_persona" && entered.has(e.from)).map((e) => e.to));
    expect([...new Set([...entered, ...switchedTo])].sort()).toEqual([...IDS].sort());
    expect([...IDS].filter((id) => !entered.has(id))).toEqual(["discover"]);
  });

  // Schedule and Discover trade places in both directions, guarded on the caps
  // that let a turn change the trip at all. A turn makes one switch, so the way
  // back is for a graph that grows a second entry, not for today's turn.
  it("joins Schedule and Discover with a guarded switch each way", () => {
    for (const [from, to] of [["schedule", "discover"], ["discover", "schedule"]] as const) {
      const edge = EDGES.find((e) => e.kind === "switch" && e.via === "switch_persona" && e.from === from && e.to === to);
      expect(edge, `${from} -> ${to}`).toBeDefined();
      expect(edge!.guard).toEqual({ role: "propose", plan: "propose" });
    }
    expect(switchTargetsOf("schedule")).toEqual(["discover"]);
    expect(switchTargetsOf("discover")).toEqual(["schedule"]);
    expect(switchTargetsOf("page-writer")).toEqual([]);
  });

  // The split moves tools out of the entry persona; it must never leave a turn
  // that switched holding less than one that started there would have.
  it("lets Discover hold every domain Schedule does, at least as high", () => {
    const rank = { read: 0, propose: 1 } as const;
    for (const { domain, max } of PERSONAS.schedule.grants) {
      const theirs = PERSONAS.discover.grants.find((g) => g.domain === domain);
      expect(theirs, domain).toBeDefined();
      expect(rank[theirs!.max], domain).toBeGreaterThanOrEqual(rank[max]);
    }
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

  // The graph names its tools by string, so it can drift from the registry
  // unseen: an edge whose tool the persona is never granted is a dead edge.
  it("ties every switch, go_to and open_trip edge to a real tool the persona is granted", () => {
    for (const edge of EDGES.filter((e) => e.kind === "switch" || e.via === "go_to" || e.via === "open_trip")) {
      const tool = ASSISTANT_TOOLS.find((t) => t.name === edge.via);
      expect(tool, `${edge.via} is a registered tool`).toBeDefined();
      const domains = PERSONAS[edge.from].grants.map((g) => g.domain);
      expect(domains, `${edge.via} from ${edge.from}`).toContain(tool!.domain);
    }
  });

  // A page whose SURFACE_INTENTS has something to pivot between must have the
  // switch edge for its pivot tool; a single-intent page must have none.
  it("has a switch edge for a page's pivot exactly when the page has an intent to pivot to", () => {
    for (const kind of SURFACE_KINDS) {
      const { allowed, pivot } = SURFACE_INTENTS[kind];
      const switches = EDGES.filter((e) => e.kind === "switch" && e.from === ENTRY[kind]).map((e) => e.via);
      if (allowed.length > 1) expect(switches, `${kind} pivots with ${pivot}`).toContain(pivot);
      else expect(switches, `${kind} has one intent`).toEqual([]);
    }
  });

  it("emits a valid Mermaid id for a persona id with several hyphens", () => {
    const persona = { id: "a-b-c", label: "Multi" };
    const mutable = PERSONAS as unknown as Record<string, unknown>;
    mutable["a-b-c"] = { ...persona, grants: [] };
    try {
      expect(personaMermaid()).toContain("  a_b_c[");
      expect(personaMermaid()).not.toMatch(/^ *\S*-\S*\[/m);
    } finally {
      delete mutable["a-b-c"];
    }
  });

  it("derives SURFACES from the entry map", () => {
    for (const kind of SURFACE_KINDS) expect(SURFACES[kind]).toBe(PERSONAS[ENTRY[kind]].grants);
  });
});
