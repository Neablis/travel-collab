// **The account page's wire shape** (M36 link 3), on the UI side of the lint
// wall — `adminOverview.ts`'s arrangement for one more read. Each type mirrors
// one in `server/entitlements/adminAccount.ts` or `server/admin/accountDetail.ts`,
// and `adminWireShape.test.ts` pins every pair with the same compile-time
// identity check.
//
// **No field carries a question, an answer or a trip's content** (M36 D7).
// The ledger has none to give, and a field added here for one would be the
// "view question" affordance the page must not grow.
import type { GrantSource } from "@tc/contracts";
import type { AdminAccountRow } from "./adminOverview";

/** Mirrors `AdminAccountState`. */
export type AdminAccountState = "active" | "granted" | "pastDue" | "none";

/** Mirrors `AdminAccountGrantRecord` — every grant row, revoked and expired included. */
export interface AdminAccountGrantRecord {
  id: string;
  source: GrantSource;
  planVersionRef: string;
  grantedBy: string | null;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  active: boolean;
}

/** Mirrors `AdminAccountMoment`. */
export interface AdminAccountMoment {
  at: string;
  what: string;
}

/** Mirrors `AdminAccountPlan`. */
export interface AdminAccountPlan {
  account: AdminAccountRow;
  state: AdminAccountState;
  underwater: boolean;
  joinedAt: string;
  grants: AdminAccountGrantRecord[];
  history: AdminAccountMoment[];
  fallsBackTo: string;
  offersAssistant: boolean;
  requestsPerDay: number | null;
}

/** Mirrors `AdminAccountTurn`. */
export interface AdminAccountTurn {
  at: string;
  kind: "question" | "change";
  model: string;
  steps: number;
  toolCalls: number;
  peakContext: number | null;
  latencyMs: number | null;
  outcome: "answered" | "proposed" | "failed" | "stopped";
}

/** Mirrors `AdminAccountAssistant`. */
export interface AdminAccountAssistant {
  offered: boolean;
  requestsPerDay: number | null;
  questions: number;
  steps: number;
  medianToolCalls: number | null;
  contextMedian: number | null;
  contextP95: number | null;
  failed: number;
  perDay: number[];
  topTools: { tool: string; calls: number }[];
  recent: AdminAccountTurn[];
}

/** Mirrors `AdminAccountDetail`. */
export interface AdminAccountDetail {
  windowDays: number;
  plan: AdminAccountPlan;
  assistant: AdminAccountAssistant;
  activeDays: number;
  trips: { owned: number; invitedTo: number };
  notebooks: number;
  activity: {
    editsPerDay: number[];
    recent: AdminAccountMoment[];
  };
}
