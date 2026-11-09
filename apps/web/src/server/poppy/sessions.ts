import { randomUUID } from "node:crypto";
import { and, eq, isNull, lt } from "drizzle-orm";
import { db } from "@/server/db/client";
import { agentSessions } from "@/server/db/schema";
import { clientIp } from "@/server/og/limit";
import { bearerToken } from "@/server/public-api/actor";
import { poppyError } from "./errors";
import { POPPY_PROTOCOL_VERSION } from "./discovery";
import { tokenHolder, verifySessionHeader, type SessionClaims, type SessionDeps } from "./sessionHeader";

// **A Session is one row** (Poppy 5.3 step 4, 5.5; ADR-089 decision 8), found
// by `(client_id, sid, agent_user_id)` and made by the first verified request
// with a new `sid`. Idle for 30 days it ends, and the row is kept so the `sid`
// does not quietly start again.

export const SESSION_IDLE_MS = 30 * 24 * 60 * 60 * 1000;
/** How stale `last_seen_at` may get before a request is worth a write, as `api_tokens.last_used_at`. */
const LAST_SEEN_COARSENING_MS = 5 * 60 * 1000;

export type SessionOpened = { ok: true; id: string } | { ok: false };

/**
 * Open the Session `claims` name, or continue it. `accountId` is the account
 * of the access token the request carries, `null` when signed out. A Session
 * that ended, or that was signed in as another account (5.4), is `ok: false`:
 * the caller answers `session_ended`.
 */
export async function openOrContinueSession(input: {
  claims: SessionClaims;
  accountId: string | null;
  now: Date;
}): Promise<SessionOpened> {
  const { claims, accountId, now } = input;
  const where = and(
    eq(agentSessions.clientId, claims.clientId),
    eq(agentSessions.sid, claims.sid),
    eq(agentSessions.agentUserId, claims.userId),
  );
  // Two first requests with one sid race to insert; the unique index picks one
  // and the other reads its row.
  await db
    .insert(agentSessions)
    .values({
      id: randomUUID(),
      clientId: claims.clientId,
      sid: claims.sid,
      agentUserId: claims.userId,
      agentId: claims.agentId,
      accountId,
      createdAt: now,
      lastSeenAt: now,
    })
    .onConflictDoNothing();
  const [row] = await db.select().from(agentSessions).where(where);
  if (row === undefined) return { ok: false };

  if (row.endedAt !== null) return { ok: false };
  if (now.getTime() - row.lastSeenAt.getTime() >= SESSION_IDLE_MS) {
    await db.update(agentSessions).set({ endedAt: now }).where(and(eq(agentSessions.id, row.id), isNull(agentSessions.endedAt)));
    return { ok: false };
  }
  if (accountId !== null && row.accountId !== null && row.accountId !== accountId) return { ok: false };

  const staleBefore = new Date(now.getTime() - LAST_SEEN_COARSENING_MS);
  // The account is recorded by the first signed-in request, and only then: the
  // `isNull` keeps two requests from each believing they set it.
  if (accountId !== null && row.accountId === null) {
    await db
      .update(agentSessions)
      .set({ accountId, lastSeenAt: now })
      .where(and(eq(agentSessions.id, row.id), isNull(agentSessions.accountId)));
  } else if (row.lastSeenAt < staleBefore) {
    await db.update(agentSessions).set({ lastSeenAt: now }).where(and(eq(agentSessions.id, row.id), lt(agentSessions.lastSeenAt, staleBefore)));
  }
  return { ok: true, id: row.id };
}

/**
 * Two versions are compatible when they share a major version and, before 1.0,
 * a minor one (Poppy 3.4); this deployment serves exactly one.
 */
function versionServed(header: string | null): boolean {
  const match = header === null ? null : /^(\d+)\.(\d+)$/.exec(header);
  return match !== null && `${Number(match[1])}.${Number(match[2])}` === POPPY_PROTOCOL_VERSION;
}

/**
 * What `route()` and `/api/mcp` ask first of a request that carries
 * `Poppy-Session`: `null` to go on, or the 400 to answer with. A request
 * without the header is `null` without a read or a write, so no route changes
 * for the people and agents that never send it.
 *
 * Verified before the actor, so a Session that fails is refused as one, as 5.3
 * wants, and a lapsed token's own refusal still comes after from the actor.
 */
export async function poppyGate(request: Request, deps: SessionDeps = {}): Promise<Response | null> {
  if (request.headers.get("poppy-session") === null) return null;
  const token = bearerToken(request) ?? undefined;
  const verified = await verifySessionHeader(request, token, { chargeTo: `poppy:${clientIp(request)}`, ...deps });
  if (!verified.ok) return poppyError("invalid_session", verified.reason);
  if (!versionServed(request.headers.get("poppy-version"))) return poppyError("version_unsupported");
  const holder = token === undefined ? null : await tokenHolder(token);
  const opened = await openOrContinueSession({
    claims: verified.claims,
    accountId: holder?.accountId ?? null,
    now: deps.now ?? new Date(),
  });
  return opened.ok ? null : poppyError("session_ended");
}
