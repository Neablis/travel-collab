import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, lt, notInArray } from "drizzle-orm";
import { z } from "zod";
import type { AdminAgentReport } from "@tc/contracts";
import { db } from "@/server/db/client";
import { agentFeedback, oauthClientBlocks, oauthClients } from "@/server/db/schema";
import { clientIp } from "@/server/og/limit";
import { agentFeedbackIpQuota, agentFeedbackQuota, consumeQuota, envCeiling, quotaRefusal } from "@/server/quota";

// **Feedback from Personal Agents** (Poppy 9.3, ADR-089 decision 11): what an
// agent could not do here, in its own words. **The text is data, never a
// prompt**: it is stored as it arrived and shown as plain text, and nothing
// here, or in what reads it, passes it to a model or renders it as markup.

/** The limits 9.3 sets, in characters; anything longer is `invalid_request`. */
export const TASK_MAX = 200;
export const DESCRIPTION_MAX = 2000;

/**
 * The most bytes of a body read. A report of the longest allowed text, every
 * character a four-byte one, is under 9 KB, and JSON escaping adds some: 32 KB
 * is past any honest report and far short of what a stream could cost.
 */
export const BODY_MAX_BYTES = 32 * 1024;

/** Length in characters, as 9.3 counts them: `.length` counts UTF-16 units, so an emoji would be two. */
const within = (max: number) => (text: string) => [...text].length <= max;

/** `min(1)`: an empty phrase says nothing, and 9.3 makes both fields required. */
export const FeedbackBody = z.object({
  task: z.string().min(1).refine(within(TASK_MAX)),
  description: z.string().min(1).refine(within(DESCRIPTION_MAX)),
});

/**
 * The refusal to answer when `clientId` or the address it came from has sent its
 * share, or `null` to go on. Two charges, the address's first: it is the one a
 * stranger cannot multiply by naming more domains.
 */
export async function feedbackLimit(clientId: string, request: Request): Promise<Response | null> {
  for (const [policies, key] of [
    [agentFeedbackIpQuota(), clientIp(request)],
    [agentFeedbackQuota(), clientId],
  ] as const) {
    const decision = await consumeQuota(policies, key);
    if (!decision.allowed) return quotaRefusal(decision);
  }
  return null;
}

/** Store one report under the verified `clientId`. */
export async function recordFeedback(clientId: string, body: z.infer<typeof FeedbackBody>, now: Date = new Date()): Promise<void> {
  await db.insert(agentFeedback).values({ id: randomUUID(), clientId, task: body.task, description: body.description, createdAt: now });
  // A missed sweep leaves a few more rows for the next one, which changes no decision.
  if (Math.random() < SWEEP_PROBABILITY) sweepFeedback(now).catch((error) => console.error("agent feedback sweep failed", { error }));
}

const DAY_MS = 24 * 60 * 60 * 1000;
const SWEEP_PROBABILITY = 0.05;

/**
 * Keep the table bounded: delete reports older than the retention, then all but
 * the newest `AGENT_FEEDBACK_MAX_ROWS`. Reports are for an operator's reading, so
 * neither limit loses anything that is acted on.
 */
export async function sweepFeedback(now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - envCeiling("AGENT_FEEDBACK_RETENTION_DAYS", 90) * DAY_MS);
  await db.delete(agentFeedback).where(lt(agentFeedback.createdAt, cutoff));
  const keep = db.select({ id: agentFeedback.id }).from(agentFeedback).orderBy(desc(agentFeedback.createdAt)).limit(envCeiling("AGENT_FEEDBACK_MAX_ROWS", 2000));
  await db.delete(agentFeedback).where(notInArray(agentFeedback.id, keep));
}

/**
 * The newest reports first, for the console; each names the agent by its document's name, or its host.
 * A blocked agent's are left out: the operator has cut it off, and its words stay out of their view too.
 */
export async function recentReports(limit = 100): Promise<AdminAgentReport[]> {
  const blocked = db.select({ clientId: oauthClientBlocks.clientId }).from(oauthClientBlocks);
  const rows = await db
    .select()
    .from(agentFeedback)
    .where(notInArray(agentFeedback.clientId, blocked))
    .orderBy(desc(agentFeedback.createdAt))
    .limit(limit);
  if (rows.length === 0) return [];
  const ids = [...new Set(rows.map((row) => row.clientId))];
  const documents = await db
    .select({ cimdUrl: oauthClients.cimdUrl, name: oauthClients.clientName })
    .from(oauthClients)
    .where(and(eq(oauthClients.kind, "cimd"), inArray(oauthClients.cimdUrl, ids)));
  const nameOf = new Map(documents.map((row) => [row.cimdUrl, row.name]));
  return rows.map((row) => ({
    id: row.id,
    clientId: row.clientId,
    agentName: nameOf.get(row.clientId) ?? hostOf(row.clientId),
    domain: hostOf(row.clientId),
    task: row.task,
    description: row.description,
    createdAt: row.createdAt.toISOString(),
  }));
}

function hostOf(clientId: string): string {
  try {
    return new URL(clientId).host;
  } catch {
    return clientId;
  }
}
