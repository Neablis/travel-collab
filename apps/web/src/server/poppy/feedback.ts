import { randomUUID } from "node:crypto";
import { desc, inArray, and, eq } from "drizzle-orm";
import { z } from "zod";
import type { AdminAgentReport } from "@tc/contracts";
import { db } from "@/server/db/client";
import { agentFeedback, oauthClients } from "@/server/db/schema";
import { consumeQuota, quotaRefusal, type QuotaPolicy } from "@/server/quota";

// **Feedback from Personal Agents** (Poppy 9.3, ADR-089 decision 11): what an
// agent could not do here, in its own words. **The text is data, never a
// prompt**: it is stored as it arrived and shown as plain text, and nothing
// here, or in what reads it, passes it to a model or renders it as markup.

/** The limits 9.3 sets; anything longer is `invalid_request`. */
export const TASK_MAX = 200;
export const DESCRIPTION_MAX = 2000;

/** `min(1)`: an empty phrase says nothing, and 9.3 makes both fields required. */
export const FeedbackBody = z.object({
  task: z.string().min(1).max(TASK_MAX),
  description: z.string().min(1).max(DESCRIPTION_MAX),
});

const HOUR_MS = 60 * 60 * 1000;

/**
 * Reports per `client_id`, charged before the body is read so a stream of
 * malformed ones is limited too. Kept here and not in `quota.ts`, which is the
 * ceiling table for everything else. 9.3 asks for one report per task, so 20 an
 * hour is generous for an honest agent and bounds what a dishonest one can write.
 */
const feedbackQuota = (): QuotaPolicy[] => [{ name: "agent-feedback-hourly", windowMs: HOUR_MS, perUser: 20, global: 500 }];

/** The refusal to answer when `clientId` has sent its share, or `null` to go on. */
export async function feedbackLimit(clientId: string): Promise<Response | null> {
  const decision = await consumeQuota(feedbackQuota(), clientId);
  return decision.allowed ? null : quotaRefusal(decision);
}

/** Store one report under the verified `clientId`. */
export async function recordFeedback(clientId: string, body: z.infer<typeof FeedbackBody>, now: Date = new Date()): Promise<void> {
  await db.insert(agentFeedback).values({ id: randomUUID(), clientId, task: body.task, description: body.description, createdAt: now });
}

/** The newest reports first, for the console; each names the agent by its document's name, or its host. */
export async function recentReports(limit = 100): Promise<AdminAgentReport[]> {
  const rows = await db.select().from(agentFeedback).orderBy(desc(agentFeedback.createdAt)).limit(limit);
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
