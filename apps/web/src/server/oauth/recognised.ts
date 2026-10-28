import { isLoopback } from "./redirects";

// **Which clients the consent page may call by name** (ADR-083 §6, amendment F).
//
// Registration is open, so a client's name is only its own claim. What can be
// known is where the code goes: a redirect that is exactly Claude's callback
// sends it to claude.ai, whoever registered it. That is the whole list, and it
// is a constant rather than data so adding to it is a reviewed change.
//
// **Claude Code is never recognised.** Its metadata document is public, so
// anyone can present its `client_id` with a loopback port of their own; the
// page shows the localhost warning for it like any other loopback redirect.

export const RECOGNISED_REDIRECTS: readonly string[] = ["https://claude.ai/api/mcp/auth_callback"];

/** How the consent page marks a client: by name, with a localhost warning, or as an unverified claim. */
export type ConsentMarking = "recognised" | "localhost-warning" | "unverified";

/** How the consent page marks the client sending its code to `redirectUri`. */
export function consentMarking(redirectUri: string): ConsentMarking {
  // First, so no entry in the list can ever outrank the warning.
  if (isLoopback(redirectUri)) return "localhost-warning";
  if (RECOGNISED_REDIRECTS.includes(redirectUri)) return "recognised";
  return "unverified";
}
