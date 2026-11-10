import { randomUUID } from "node:crypto";
import { and, eq, isNull, lt } from "drizzle-orm";
import { db } from "@/server/db/client";
import { agentSessions } from "@/server/db/schema";
import { clientIp } from "@/server/og/limit";
import { clientIsBlocked, storedClientRowId } from "@/server/oauth/clients";
import { bearerToken } from "@/server/bearerToken";
import { agentSessionOpenQuota, consumeQuota, type QuotaDecision } from "@/server/quota";
import { poppyError } from "./errors";
import { POPPY_PROTOCOL_VERSION } from "./discovery";
import { verifySessionHeader, type SessionClaims, type SessionDeps } from "./sessionHeader";

// **A Session is one row** (Poppy 5.3 step 4, 5.5; ADR-089 decision 8), found
// by `(client_id, sid, agent_user_id)` and made by the first request with a new
// `sid` whose Session JWT verified **and whose access token the actor accepted**:
// a request that is refused for its credential leaves nothing behind. Idle for
// 30 days it ends, and the row is kept so the `sid` does not quietly start
// again, for a further 30 days (`SESSION_RETENTION_MS`), after which a sweep
// deletes it. Opening one is charged per `(client_id, account)`, or `(client_id,
// caller IP)` signed out, so no one can write rows faster than
// `agentSessionOpenQuota` through an agent however many `sid`s it invents.

export const SESSION_IDLE_MS = 30 * 24 * 60 * 60 * 1000;
/** How long an idle or ended Session's row is kept, from its last request: its idle month, then a month in which its `sid` is still refused. */
export const SESSION_RETENTION_MS = 2 * SESSION_IDLE_MS;
/** How stale `last_seen_at` may get before a request is worth a write, as `api_tokens.last_used_at`. */
const LAST_SEEN_COARSENING_MS = 5 * 60 * 1000;
/** One new Session in a hundred starts a sweep, as `og/limit.ts`'s: no cron for one DELETE. */
const SWEEP_PROBABILITY = 0.01;

/** `limited` is why the caller has opened its share of Sessions; the route answers it in its own envelope. */
export type SessionOpened = { ok: true; id: string } | { ok: false; limited?: Extract<QuotaDecision, { allowed: false }> };

/** Delete the rows idle past `SESSION_RETENTION_MS`; returns how many. */
export async function sweepAgentSessions(now: Date): Promise<number> {
  const gone = await db
    .delete(agentSessions)
    .where(lt(agentSessions.lastSeenAt, new Date(now.getTime() - SESSION_RETENTION_MS)))
    .returning({ id: agentSessions.id });
  return gone.length;
}

/**
 * Open the Session `claims` name, or continue it. `accountId` is the account
 * of the access token the request carries, `null` when signed out. A Session
 * that ended, or that was signed in as another account (5.4), is `ok: false`:
 * the caller answers `session_ended`.
 */
export async function openOrContinueSession(input: {
  claims: SessionClaims;
  accountId: string | null;
  /** Who is calling, which a signed-out request's new-Session share is charged to. */
  caller: string;
  now: Date;
}): Promise<SessionOpened> {
  const { claims, accountId, caller, now } = input;
  const where = and(
    eq(agentSessions.clientId, claims.clientId),
    eq(agentSessions.sid, claims.sid),
    eq(agentSessions.agentUserId, claims.userId),
  );
  const [existing] = await db.select({ id: agentSessions.id }).from(agentSessions).where(where);
  if (existing === undefined) {
    // Only a new row is charged: a Session that continues costs nothing.
    const subject = `${claims.clientId}:${accountId === null ? `ip:${caller}` : `account:${accountId}`}`;
    const decision = await consumeQuota(agentSessionOpenQuota(), subject);
    if (!decision.allowed) return { ok: false, limited: decision };
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
    // A missed sweep leaves a few more old rows for the next one, which changes no decision.
    if (Math.random() < SWEEP_PROBABILITY) sweepAgentSessions(now).catch((error) => console.error("agent session sweep failed", { error }));
  }
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
  // `isNull` keeps two requests from each believing they set it, and the one that
  // lost is held to the account that won (5.4).
  if (accountId !== null && row.accountId === null) {
    const [set] = await db
      .update(agentSessions)
      .set({ accountId, lastSeenAt: now })
      .where(and(eq(agentSessions.id, row.id), isNull(agentSessions.accountId)))
      .returning({ id: agentSessions.id });
    if (set === undefined) {
      const [won] = await db.select({ accountId: agentSessions.accountId }).from(agentSessions).where(eq(agentSessions.id, row.id));
      if (won?.accountId !== accountId) return { ok: false };
    }
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
 * The refusal for a spent share (new Sessions, or fetches for an agent nobody has allowed), in the `{ error: { code, message } }` envelope
 * `/api/v1/*` and `/api/mcp` both answer in (and `route()`'s 429 and 503 for a spent token's
 * share): a Poppy error is a bare code, and this is not one of the three.
 */
export function limitedResponse(decision: Extract<QuotaDecision, { allowed: false }>, what: string): Response {
  const unavailable = decision.reason === "unavailable";
  return Response.json(
    {
      error: unavailable
        ? { code: "service-unavailable", message: "Try again shortly." }
        : { code: "rate-limited", message: `Too many ${what}. Try again later.` },
    },
    { status: unavailable ? 503 : 429, headers: { "Retry-After": String(decision.retryAfterSeconds) } },
  );
}

/**
 * What `route()` and `/api/mcp` ask first of a request that carries
 * `Poppy-Session`: `refused`, the 400 to answer with, or `open`, to call once
 * the actor has accepted the request's credential. A request without the header
 * gets an `open` that does nothing, without a read or a write, so no route
 * changes for the people and agents that never send it.
 *
 * The header is verified before the actor, so a Session that fails is refused as
 * one, as 5.3 wants. **Nothing is written until the credential is accepted**: a
 * request with no token, or a dead one, would otherwise create a row for any
 * `sid` its sender chose, and record an account from a token nobody had checked.
 * `open(accountId)` takes the accepted token's account, `null` for none. `claims` is
 * who the verified Session is, or `null` when the request carried none.
 */
export async function poppyGate(
  request: Request,
  deps: SessionDeps = {},
): Promise<
  { refused: Response } | { claims: SessionClaims | null; open: (accountId: string | null, opts?: { recordStranger?: boolean }) => Promise<Response | null> }
> {
  if (request.headers.get("poppy-session") === null) return { claims: null, open: async () => null };
  const token = bearerToken(request) ?? undefined;
  const caller = clientIp(request);
  // An unknown client is only for a read with no access token: a token names a grant, and so a stored client.
  // Without the guard a tokened request would be fetched and then refused for its token, which costs quota for nothing.
  const verified = await verifySessionHeader(request, token, {
    chargeTo: `poppy:${caller}`,
    ...deps,
    unknownClientOk: deps.unknownClientOk === true && token === undefined,
  });
  // A spent fetch share is capacity, not a bad Session: `invalid_session` is terminal to an agent.
  if (!verified.ok) return { refused: verified.limited === undefined ? poppyError("invalid_session", verified.reason) : limitedResponse(verified.limited, "agents looked up") };
  // The operator's kill switch (ADR-089 decision 3). Poppy 7 answers a refused
  // `client_id` as `invalid_session`, and a Session that verified is the first
  // moment it is known whose it is.
  if (await clientIsBlocked(verified.claims.clientId)) return { refused: poppyError("invalid_session", "this client_id is refused") };
  if (!versionServed(request.headers.get("poppy-version"))) return { refused: poppyError("version_unsupported") };
  return {
    claims: verified.claims,
    open: async (accountId, opts) => {
      // A stranger's signed-out read is served and recorded nowhere (ADR-089 decision 8): a row per
      // made-up client_id would fill the console's Agents tab with whatever it chose to be called.
      // The report route (feedback) passes `recordStranger`: its agent gets a row so it can be blocked, bounded by that route's own quota.
      if (accountId === null && opts?.recordStranger !== true && (await storedClientRowId(verified.claims.clientId)) === null) return null;
      const opened = await openOrContinueSession({ claims: verified.claims, accountId, caller, now: deps.now ?? new Date() });
      if (opened.ok) return null;
      return opened.limited === undefined ? poppyError("session_ended") : limitedResponse(opened.limited, "new Sessions");
    },
  };
}
