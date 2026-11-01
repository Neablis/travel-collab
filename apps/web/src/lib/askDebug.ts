// The two operator endpoints behind the Ask panel's Debug view (M57 part 5,
// ADR-085): the persona graph for a page, and one turn's ledger trace.
//
// **Web-local, and here rather than in a component or a server file**, for the
// reason `lib/reports.ts` gives: the route builds these and a component reads
// them, and a component may not import `server/` while a route should not
// import a component. Plain types, not zod schemas: both ends are this app,
// and the endpoints answer 404 to anyone who is not an operator, so there is no
// untrusted body to parse. The fetchers are `apiClient`'s.

export type DebugPersonaId = "schedule" | "discover" | "page-writer" | "account" | "playbook-editor" | "explorer";

/** How a persona relates to the page's entry persona under the viewer's caps. */
export type PersonaReach = "entry" | "switch" | "hand-off" | "never";

export interface DebugTool {
  name: string;
  domain: string;
  effect: string;
}

export interface DebugPersona {
  id: DebugPersonaId;
  label: string;
  does: string;
  reach: PersonaReach;
  /** What the persona holds under these caps, in registry order. */
  tools: DebugTool[];
}

export interface DebugEdge {
  from: DebugPersonaId;
  /** Null: the hand-off leaves the graph. */
  to: DebugPersonaId | null;
  kind: "switch" | "hand-off";
  via: string;
  /** The caps the edge names, as `cap=value`. Empty: always taken. */
  guard: string[];
}

export interface PersonaGraphResponse {
  surface: string;
  entry: DebugPersonaId;
  caps: { role: "read" | "propose"; plan: "read" | "propose" };
  /** The entry persona first, then its reach order. */
  personas: DebugPersona[];
  /** Every edge that leaves the entry persona, self-loops included. */
  edges: DebugEdge[];
}

export interface TraceToolCall {
  callId: string;
  tool: string;
  outcome: string;
  durationMs: number | null;
}

export interface TraceStep {
  index: number;
  persona: string | null;
  model: string;
  tokensIn: number | null;
  tokensOut: number | null;
  cacheReadTokens: number | null;
  durationMs: number | null;
  finishReason: string | null;
  /** The edge this step came in by, when it is the first after one. */
  crossed: { from: string; kind: string } | null;
  escalated: boolean;
  pivoted: boolean;
  calls: TraceToolCall[];
}

export interface TraceOutcome {
  kind: string;
  at: string;
  actor: string;
}

/** A task the turn handed off. `task` is model-paraphrased text, so it travels only on this operator endpoint. */
export interface TraceGap {
  persona: string;
  target: string;
  task: string;
}

export interface TurnTrace {
  turnId: string;
  endpoint: string;
  outcome: string;
  taskClass: string;
  entryPersona: string | null;
  latencyMs: number | null;
  /** Micro-dollars at the rate in force when the turn ran; null when any model has no rate. */
  costMicroUsd: number | null;
  steps: TraceStep[];
  /** Calls whose step the provider never named. */
  looseCalls: TraceToolCall[];
  outcomes: TraceOutcome[];
  gaps: TraceGap[];
}
