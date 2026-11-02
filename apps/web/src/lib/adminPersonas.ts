// **The Personas tab's wire shape** (M57 part 6, ADR-085), on the UI side of the
// lint wall: `server/entitlements/personaReport.ts` builds it from the ledger and
// `components/admin/PersonasTab.tsx` draws it, and a component may not import
// `@/server/*`. The server imports these types rather than restating them, so a
// field added here fails `tsc` on both ends and there is no mirror to drift.
//
// Counts and micro-dollars, never `Money` (M36 D10). No field carries what a
// person said: the one free-text column, `ai_capability_gaps.task`, reaches an
// operator only through the turn breakdown.

/** A persona as the page defines it: the report attaches the window's numbers. */
export interface PersonaDef {
  id: string;
  label: string;
  /** Every tool the persona holds at full caps, by name. */
  tools: string[];
  /** The page kinds that enter it. */
  entryPages: string[];
}

/** An edge as `personas.ts` defines it; `to` null is a hand-off that leaves the graph. */
export interface EdgeDef {
  from: string;
  to: string | null;
  kind: "switch" | "hand-off";
  via: string;
  /** `cap=value`, empty when always taken. */
  guard: string[];
}

/**
 * What a set of turns cost, and what they were worth. Null, never NaN or a
 * free-looking 0, when there is nothing to divide by.
 */
export interface TurnStats {
  turns: number;
  /** Micro-dollars over the set's priced turns; null when none is priced. */
  costPerTurnMicroUsd: number | null;
  /** Cost of the set over its turns a person acted on; null when none was. */
  costPerOutcomeMicroUsd: number | null;
}

export interface PersonaNode extends PersonaDef, TurnStats {
  /** Persona changes that left this persona in the window. */
  switchesOut: number;
  /** Tools it holds that no step run as it called in the window. */
  unusedTools: string[];
}

export interface PersonaEdge extends EdgeDef, TurnStats {
  /** Times taken: steps that crossed or flagged a switch, or gap rows and navigation calls for a hand-off. */
  count: number;
}

export interface RecentTurn {
  turnId: string;
  at: string;
  /** Persona of each step, consecutive repeats folded; the entry persona when no step row says. */
  personaPath: string[];
  outcome: string;
  /** What people did with the answer. */
  outcomeKinds: string[];
  costMicroUsd: number | null;
}

export interface PersonaReport extends TurnStats {
  windowDays: number;
  /** Turns in the window that someone acted on. */
  outcomeTurns: number;
  switches: number;
  nodes: PersonaNode[];
  edges: PersonaEdge[];
  recent: RecentTurn[];
}

export interface PersonaMapDef {
  personas: PersonaDef[];
  edges: EdgeDef[];
}
