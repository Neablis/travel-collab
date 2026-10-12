/**
 * Social features the landing once pictured and the app does not have:
 * replies, votes, comments, reactions, and live presence (ADR-049 polls every
 * five seconds; nobody is "here now", "online" or "viewing"). Mitchell,
 * 2026-10-11 — the landing draws suggestions and past actions instead. Shared
 * by the tests that sweep each landing tree, each hero view and the feature
 * blocks, their drawings and their real components alike.
 */
export const UNBUILT_SOCIAL =
  /\brepl(y|ies)\b|\bvot(e|es|ed|er|ers|ing)\b|\bcomment|\breact(s|ed|ing|ion|ions)?\b|can.?t wait|here now|\btyping\b|is (reading|moving|dragging|viewing|editing|typing)|\bonline\b|\bviewing\b/i;
