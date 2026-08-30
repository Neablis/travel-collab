/**
 * Turns kept in one /ask thread.
 *
 * 40 messages is ~20 exchanges — far past any real sidebar conversation, and
 * the point at which re-sending the whole thread on every step of every
 * subsequent turn stops being cheap. Conversation state is client-held (plan
 * Ruling R1: no conversations table, no migration), so this is the only place
 * it is bounded.
 *
 * Read by BOTH halves: `handleAskRequest` refuses a longer thread with a 400,
 * and `TripBoardScreen` counts against it so the rail can warn as the thread
 * fills and offer the only exit — New conversation — when it is full. It is in
 * `src/lib`, not `src/server/ai/limits.ts`, because the lint wall stops UI
 * importing `@/server/*`, and a second copy of the number in the rail is
 * exactly the drift that made the server 400 unreachable to explain.
 */
export const MAX_ASK_MESSAGES = 40;
