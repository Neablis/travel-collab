// **The AI models tab's wire shape** (M36 link 4), on the UI side of the lint
// wall — `adminOverview.ts`'s pattern and its reason: components may not reach
// `@/server/*`, so the shape is restated here and pinned to
// `server/entitlements/aiModels.ts` by the compile-time identity check in
// `adminWireShape.test.ts`. A field added on one side only fails `tsc`.
//
// Counts, tokens, milliseconds, bytes and **micro-dollars** — never `Money`
// (M36 D10). Shares are fractions; turning one into a percentage is display.
// No field carries a question or an answer: the ledger has none (D7).

/** Mirrors `AiTurnsDay`. */
export interface AdminAiTurnsDay {
  day: string;
  turns: number;
  failed: number;
}

/** Mirrors `AiContextStep`. */
export interface AdminAiContextStep {
  step: string;
  median: number;
  p95: number;
  turns: number;
}

/** Mirrors `AiModelRow`. */
export interface AdminAiModelRow {
  model: string;
  roles: readonly string[];
  calls: number;
  tokensIn: number;
  medianDurationMs: number | null;
  costMicroUsd: number;
  unpriced: number;
  cacheReadShare: number | null;
}

/** Mirrors `AiToolRow`. */
export interface AdminAiToolRow {
  tool: string;
  calls: number;
  turns: number;
  failed: number;
  repaired: number;
  medianDurationMs: number | null;
  medianOutputBytes: number | null;
  reachedProposal: { reached: number; of: number } | null;
}

/** Mirrors `AiWorstDay`. */
export interface AdminAiWorstDay {
  day: string;
  turns: number;
  failed: number;
  tool: string | null;
}

/** Mirrors `AiModelsReport`. */
export interface AdminAiModelsReport {
  windowDays: number;
  turns: number;
  previousTurns: number;
  accounts: number;
  medianStepsPerTurn: number | null;
  measuredTurns: number;
  toolCalls: {
    total: number;
    medianPerTurn: number | null;
    p95PerTurn: number | null;
    failed: number;
    repaired: number;
  };
  contextPerStep: { median: number; p95: number } | null;
  failedTurns: number;
  worstDay: AdminAiWorstDay | null;
  days: AdminAiTurnsDay[];
  taskClasses: { question: number; change: number; compose: number };
  escalatedTurns: number;
  contextByStep: AdminAiContextStep[];
  cacheReadShare: number | null;
  turnsOver32k: number;
  growthPerStep: number | null;
  models: AdminAiModelRow[];
  tools: AdminAiToolRow[];
  rarelyCalled: { tool: string; calls: number }[];
  ledgerGap: { turns: number; since: string | null };
}
