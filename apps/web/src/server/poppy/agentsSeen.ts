import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { AdminAgent } from "@tc/contracts";
import { db } from "@/server/db/client";
import { agentSessions, oauthClientBlocks, oauthClients } from "@/server/db/schema";

// **The Personal Agents this deployment has seen** (ADR-089 decision 3), one per
// `client_id`, read for the console's Agents tab. Disposable: it is a count over
// `agent_sessions`, which the retention sweep trims, plus the operator's blocks.

const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
/** The most `client_id`s read from Sessions, so a tab never grows with what a stranger can make; blocks are the operator's own and always list. */
export const AGENTS_SEEN_CAP = 50;

/** The `AGENTS_SEEN_CAP` most recently seen `client_id`s with a Session in the last 30 days, and every one the operator has blocked. */
export async function agentsSeen(now: Date = new Date()): Promise<AdminAgent[]> {
  const since = new Date(now.getTime() - WINDOW_MS);
  const seen = await db
    .select({
      clientId: agentSessions.clientId,
      sessions: sql<number>`count(*)::int`,
      accounts: sql<number>`count(distinct ${agentSessions.accountId})::int`,
      lastSeenAt: sql<Date>`max(${agentSessions.lastSeenAt})`,
    })
    .from(agentSessions)
    .where(gte(agentSessions.lastSeenAt, since))
    .groupBy(agentSessions.clientId)
    .orderBy(desc(sql`max(${agentSessions.lastSeenAt})`))
    .limit(AGENTS_SEEN_CAP);
  const blocks = await db.select({ clientId: oauthClientBlocks.clientId, blockedAt: oauthClientBlocks.blockedAt }).from(oauthClientBlocks);
  const blocked = new Set(blocks.map((block) => block.clientId));

  // A block on a client with no recent Session still lists, so it can be undone.
  const ids = [...new Set([...seen.map((row) => row.clientId), ...blocked])];
  if (ids.length === 0) return [];
  const documents = await db
    .select({ cimdUrl: oauthClients.cimdUrl, name: oauthClients.clientName, logoUri: oauthClients.logoUri })
    .from(oauthClients)
    .where(and(eq(oauthClients.kind, "cimd"), inArray(oauthClients.cimdUrl, ids)));
  const documentOf = new Map(documents.map((row) => [row.cimdUrl, row]));
  const blockedAtOf = new Map(blocks.map((block) => [block.clientId, block.blockedAt]));

  return ids
    .map((clientId): AdminAgent => {
      const row = seen.find((candidate) => candidate.clientId === clientId);
      const document = documentOf.get(clientId);
      return {
        clientId,
        name: document?.name ?? null,
        logoUri: document?.logoUri ?? null,
        domain: hostOf(clientId),
        sessions30d: row?.sessions ?? 0,
        accounts: row?.accounts ?? 0,
        lastSeenAt: new Date(row?.lastSeenAt ?? blockedAtOf.get(clientId) ?? now).toISOString(),
        blocked: blocked.has(clientId),
      };
    })
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
}

function hostOf(clientId: string): string {
  try {
    return new URL(clientId).host;
  } catch {
    return clientId;
  }
}

/** Block `clientId`; blocking one already blocked changes nothing. */
export async function blockClient(clientId: string, operatorId: string, now: Date = new Date()): Promise<void> {
  await db.insert(oauthClientBlocks).values({ clientId, blockedAt: now, blockedBy: operatorId }).onConflictDoNothing();
}

/** Lift the block on `clientId`; lifting none changes nothing. */
export async function unblockClient(clientId: string): Promise<void> {
  await db.delete(oauthClientBlocks).where(eq(oauthClientBlocks.clientId, clientId));
}
