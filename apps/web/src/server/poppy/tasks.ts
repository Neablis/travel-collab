import { deploymentOrigin } from "@/lib/deploymentOrigin";

// **The tasks response** (Poppy 9, 9.1; ADR-089 decision 11): what Caesura chose
// not to offer a Personal Agent, so it does not spend a Session looking for a way.
//
// The list is kept beside `public-api/exposure.ts` because its `never` rows are
// where "this is not offered" is already decided: a task that stands on rows
// there cites them in `rows`, and `tasks.test.ts` fails when one stops being a
// `never` row. A task no row covers (nothing has a route to refuse) cites none.
// `rows` is for the reader of this file and never sent.

export interface ExcludedTask {
  /** A short phrase (9.1), at most 200 characters. */
  task: string;
  /**
   * The alternative (9.2), natural language: the agent reads it as content, not as an
   * instruction. Absent when there is nowhere to send the person: pointing at a
   * control that does not exist would be worse than saying nothing.
   */
  instructions?: string;
  /** `EXPOSURE` keys, all `never`, that this task stands on. */
  rows: readonly string[];
}

export const EXCLUDED_TASKS: readonly ExcludedTask[] = [
  {
    task: "Change the plan, pay, or manage billing",
    instructions: "Billing and plan changes are made by the person in Caesura's settings, signed in to the website.",
    rows: ["billing/change", "billing/checkout", "billing/portal"],
  },
  {
    task: "Delete the account",
    rows: [],
  },
  {
    task: "Remove a member from a trip or change their role",
    instructions: "Members and roles are managed by the trip's owner in the trip's sharing settings, in the app.",
    rows: [],
  },
  {
    task: "Create or revoke API tokens, or connect and disconnect other apps",
    instructions: "Access tokens and connected apps are managed by the person in Caesura's account settings.",
    rows: ["account/tokens", "account/tokens/[tokenId]", "account/connected-apps", "account/connected-apps/[grantId]"],
  },
  {
    task: "Redeem or share referral codes",
    instructions: "Referrals are made by the person in Caesura's account settings.",
    rows: ["account/referrals"],
  },
];

/** The body of `GET /api/poppy/tasks`: the same for every Session, so it can be cached. */
export function tasksResponse() {
  return {
    excluded_tasks: EXCLUDED_TASKS.map(({ task, instructions }) => ({
      task,
      ...(instructions === undefined ? {} : { alternative: { instructions } }),
    })),
    feedback: { endpoint: `${deploymentOrigin()}/api/poppy/feedback` },
  };
}
