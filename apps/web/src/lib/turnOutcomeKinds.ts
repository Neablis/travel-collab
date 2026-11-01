/**
 * What a person did with a turn's answer (M57, ADR-085). Here, not beside the
 * table, so the browser can name the three it sends without importing the
 * server module that writes them.
 */
export const TURN_OUTCOME_KINDS = [
  "proposal_applied",
  "suggestion_accepted",
  "hand_off_pressed",
  "carried_ask_pressed",
  "trip_created_from_hand_off",
] as const;
export type TurnOutcomeKind = (typeof TURN_OUTCOME_KINDS)[number];

/**
 * The three a browser may report. The other two are written by the server at
 * the approval and the accept, where it knows they happened; a client that
 * could post those could mint an acceptance.
 */
export const CLIENT_OUTCOME_KINDS = ["hand_off_pressed", "carried_ask_pressed", "trip_created_from_hand_off"] as const satisfies readonly TurnOutcomeKind[];
export type ClientOutcomeKind = (typeof CLIENT_OUTCOME_KINDS)[number];
