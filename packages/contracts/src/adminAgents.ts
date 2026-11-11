import { z } from "zod";
import { isoDateTime } from "./isoDateTime.ts";

// **The console's Agents tab** (M60 part 4, ADR-089 decision 3): the Personal
// Agents a deployment has seen, and the operator's switch over each one.

/**
 * One Personal Agent seen, by its protocol `client_id` (the URL of its metadata
 * document). `name` and `logoUri` are from the document as of the last time
 * someone allowed it, so they are `null` for an agent that has only ever been
 * signed out; the console falls back to `domain`, which is the `client_id`'s host.
 */
export const AdminAgent = z.object({
  clientId: z.string(),
  name: z.string().nullable(),
  logoUri: z.string().nullable(),
  domain: z.string(),
  /** Sessions it opened or continued in the last 30 days. */
  sessions30d: z.number().int().nonnegative(),
  /** Distinct accounts signed in through those Sessions. */
  accounts: z.number().int().nonnegative(),
  lastSeenAt: isoDateTime(),
  blocked: z.boolean(),
});
export type AdminAgent = z.infer<typeof AdminAgent>;

export const AdminAgentList = z.object({ agents: z.array(AdminAgent) });
export type AdminAgentList = z.infer<typeof AdminAgentList>;

/** What `PUT` and `DELETE …/block` answer: the agent and whether it is now blocked. */
export const AdminAgentBlock = z.object({ clientId: z.string(), blocked: z.boolean() });
export type AdminAgentBlock = z.infer<typeof AdminAgentBlock>;
