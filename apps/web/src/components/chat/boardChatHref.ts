/** The board's query param that opens its chat on arrival (`boardChatHref`). */
export const OPEN_CHAT_PARAM = "chat";

/**
 * The trip's chat, opened where it lives (Mitchell, PR 537 round 3): the
 * board, with its panel on Chat, a sheet on a phone. A notebook's *Group chat*
 * goes here; the board reads the param once per arrival and then drops it
 * (`TripBoardScreen`).
 */
export function boardChatHref(tripId: string): string {
  return `/trips/${tripId}?${OPEN_CHAT_PARAM}=open`;
}
