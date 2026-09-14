// The HTTP contract for the collaboration gate (M20 link 6), defined once so
// the endpoint, the panel and the tests tell one story about the same refusal.
//
// It lives in Access & Membership rather than in the Entitlements module for
// the reason ADR-045 rule 5 gives: this module knows `trip.collaborators` is
// about invites, and Entitlements must not.

/**
 * **402 Payment Required**, the same status and for the same reason as the AI
 * gate's `ai-not-entitled`. A 403 says the account did something it may not; a
 * 402 says it does not have a thing it could have, and only the second is
 * something a person can act on.
 */
export const COLLABORATORS_NOT_ENTITLED_CODE = "collaborators-not-entitled";

/**
 * The refusal **names the tier, not a permission** — M20's gate box, and it
 * carries more weight here than anywhere else in the milestone.
 *
 * `trip.collaborators` is never trialled (the trial grants `plus`), so **nobody
 * experiences collaboration before paying for it**. A free owner meets this
 * gate cold, with no prior experience of what is behind it. *"You do not have
 * permission to invite people"* would leave them with no idea what they had
 * just met; naming Premium and what it is for is the least this refusal can do.
 *
 * `Premium` is copy rather than derived from the plan file, for the reason
 * Phase 1's test enforces: deriving it would mean an authorisation path reading
 * a display order to decide which plan to name.
 *
 * No price. M20 never learns what a plan costs.
 */
export const COLLABORATORS_NOT_ENTITLED_REASON =
  "Inviting people to a trip is part of Premium. Planning a trip on your own is always free.";
