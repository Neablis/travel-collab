import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";
import type { z } from "zod";
import {
  API_TOKEN_DEFAULT_LIFETIME_DAYS,
  API_TOKEN_MAX_LIFETIME_DAYS,
  API_TOKEN_PREFIX,
  API_TOKEN_PREFIX_LENGTH,
  ApiScope,
  ApiTokenCreateInput,
  type ApiToken,
  type ApiTokenCreated,
} from "@tc/contracts";
import { db } from "@/server/db/client";
import { apiTokens } from "@/server/db/schema";
import { accountCan } from "@/server/entitlements/resolver";

// **Minting, listing, verifying and revoking account API tokens** (M22 Phase 1).
//
// This module owns the credential and nothing else. It does not know what a
// route is, what a scope permits, or what a trip is — a caller hands it a
// secret and gets back an actor's identity and what that actor was granted.
// The `route()` wrapper (Phase 2) is what turns that into an authorisation
// decision, and the role check it then runs is the unchanged one a session
// already passes.
//
// **Two gates, never one replacing the other.** Everything here is gate one:
// is this credential real, live, and entitled? Gate two — does this *user*
// hold the role this endpoint demands on this trip — stays `requireTripAccess`,
// untouched. That is what makes a token unable to grant more than its owner
// holds, and what makes it degrade automatically: revoke someone's membership
// and every token they hold loses that trip in the same instant, with no token
// state to reconcile.

/** How long a token may live, restated where minting can reach it. */
export { API_TOKEN_MAX_LIFETIME_DAYS, API_TOKEN_DEFAULT_LIFETIME_DAYS };

/**
 * Why a credential was refused.
 *
 * **Each of these maps to a distinct wire code and two of them share a status**
 * — `expired` and `revoked` are both 401, because an integrator reading the
 * response has to be able to tell "mint a new one" from "you were cut off".
 * The wrapper owns that mapping; this module owns the distinction.
 */
export type TokenRefusal =
  /** No row carries this hash. Also the answer for a malformed secret. */
  | { reason: "unknown" }
  /** Real, and someone revoked it. */
  | { reason: "revoked"; revokedAt: Date }
  /** Real, and its time ran out. Refused, never deleted. */
  | { reason: "expired"; expiresAt: Date }
  /** Real and live, but its owner's plan no longer grants `api.tokens`. */
  | { reason: "not-entitled"; ownerId: string };

/** A verified credential, and everything the wrapper needs to decide with. */
export interface VerifiedToken {
  tokenId: string;
  ownerId: string;
  scopes: ReadonlySet<ApiScope>;
  /** `null` is account-wide — every trip the owner can reach, now and later. */
  tripIds: ReadonlySet<string> | null;
}

export type VerifyResult =
  | { ok: true; token: VerifiedToken }
  | { ok: false; refusal: TokenRefusal };

export type MintResult =
  | { ok: true; created: ApiTokenCreated }
  | { ok: false; reason: "not-entitled" }
  | { ok: false; reason: "invalid-lifetime"; maxDays: number }
  | { ok: false; reason: "invalid-input"; issues: z.ZodIssue[] };

/** The pepper is missing, so no token can be minted or verified. */
export class ApiTokenPepperMissingError extends Error {
  constructor() {
    super(
      "API_TOKEN_PEPPER is not set. API tokens are keyed with it, so without it " +
        "no token can be minted or verified. Generate one with " +
        "`openssl rand -base64 32` and set it wherever this app runs. " +
        "Changing it invalidates every existing token, by design.",
    );
    this.name = "ApiTokenPepperMissingError";
  }
}

/**
 * The server-side key every token digest is taken under.
 *
 * **Read per call rather than captured at module load**, so a test can set it
 * and so a missing value fails the request that needed it rather than the import
 * of anything that transitively touches this module.
 */
/**
 * `N=16384, r=8, p=1` — Node's own defaults, ~37ms here, ~16MB of memory.
 *
 * Changing any of these invalidates every stored digest exactly as rotating the
 * pepper does, so they are a constant rather than an environment knob: a
 * parameter someone can tune per deployment is one that silently locks an
 * environment's tokens out when it differs from the one that wrote them.
 */
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;

function pepper(): string {
  const value = process.env.API_TOKEN_PEPPER ?? "";
  // **Fails closed and loudly.** An empty pepper would still produce a stable
  // digest, so tokens would keep working while the property this key exists for
  // silently did not hold — the worst possible failure mode for a credential
  // store, because nothing errors.
  if (value === "") throw new ApiTokenPepperMissingError();
  return value;
}

/**
 * `scrypt(secret, pepper)`, hex — **keyed AND deliberately slow**.
 *
 * **Two properties, and they are separate.** The pepper is the salt, so the
 * digest cannot be computed by anyone holding only the database: a stolen
 * backup is not enough to verify a token, or to confirm which row a plaintext
 * leaked through some other channel belongs to. The work factor is on top of
 * that, and is what a bare keyed digest did not have.
 *
 * **A FIXED salt, on purpose.** Per-row salts exist to stop one precomputation
 * attacking every row at once — a real concern for human-chosen passwords, and
 * a non-concern for 32 bytes of `randomBytes`, where no precomputation is
 * possible at any scale. A fixed salt is also what keeps verification a single
 * indexed equality: per-row salts would force a scan of every live token on
 * every request, which is both slower and a worse failure mode than the one
 * they would be defending against.
 *
 * **The cost is real and it is accepted.** Measured on this hardware:
 * HMAC-SHA256 is under a microsecond, `N=16384` is ~37ms, `N=32768` ~87ms.
 * At `N=16384` every authenticated `v1` request pays ~37ms of CPU it did not
 * pay before. Against the per-token quota of 1,000 requests an hour that is
 * ~37 CPU-seconds an hour for a maximally busy integration.
 *
 * **Why pay it, when the input has no guessable space.** It is genuinely
 * belt-and-braces: 2^256 is not searchable whatever the work factor, so the
 * marginal security is close to nil, and the honest case for it is not
 * cryptographic. It is that a credential store should not be the place where
 * this codebase argues with a high-severity scanner finding, and that the
 * failure mode of being wrong here is unbounded while the failure mode of
 * paying 37ms is a slower background sync. Mitchell called it twice; the
 * asymmetry is the reason, not the CodeQL rule's own model, which does not
 * consider entropy.
 *
 * **Rotating the pepper invalidates every token**, deliberately and with no
 * migration path — the correct blast radius for a key compromise, and why it
 * has its own variable rather than borrowing `AUTH_SECRET`.
 */
function hashOf(secret: string): string {
  return scryptSync(secret, pepper(), 32, SCRYPT).toString("hex");
}

/**
 * Compare two hashes without leaking where they differ.
 *
 * The lookup is an indexed equality select, so this is belt-and-braces over a
 * comparison Postgres already made — but `timingSafeEqual` is the established
 * pattern here (`server/admission.ts`, `server/billing/signature.ts`) and a
 * credential comparison that is *sometimes* constant-time is the kind of
 * inconsistency that becomes a finding later.
 */
function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  // `timingSafeEqual` throws on a length mismatch, which is itself a leak of
  // one bit — but hex sha256 is always 64 characters, so a mismatch here means
  // a corrupted row rather than an attacker's probe.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * `tc_<base64url(32 random bytes)>`.
 *
 * The prefix is what makes a leaked token greppable — GitHub's secret scanning
 * matches on a known prefix, and a human reading a log can tell what they are
 * looking at.
 */
function mintSecret(): string {
  return `${API_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

type TokenRow = typeof apiTokens.$inferSelect;

function toDto(row: TokenRow): ApiToken {
  return {
    tokenId: row.id,
    name: row.name,
    prefix: row.prefix,
    // **Parsed, not cast.** A `text[]` column is not a guarantee: a scope
    // retired from the enum, or written by hand, would otherwise flow into an
    // authorisation decision as a string nothing recognises. Unknown values are
    // dropped rather than throwing, so one bad entry cannot make a token
    // unlistable — and therefore unrevokable.
    scopes: row.scopes.filter((scope): scope is ApiScope => ApiScope.safeParse(scope).success),
    tripIds: row.tripIds,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

/**
 * Mint a token for an account that is entitled to have one.
 *
 * **The entitlement is checked here AND on every use** (Decision 12). Checking
 * only here would let a token minted while entitled outlive the entitlement by
 * up to a year, which is the defect with the longest fuse in this milestone.
 *
 * **The lifetime ceiling refuses rather than clamps.** Quietly shortening a
 * lifetime someone asked for is how an integration dies on a date nobody chose.
 * The contract schema already refuses it at the edge; this refuses it again,
 * because a server-side ceiling that only exists in a request schema is one an
 * internal caller can walk straight past.
 */
export async function mintToken(
  ownerId: string,
  input: ApiTokenCreateInput,
  now: Date = new Date(),
): Promise<MintResult> {
  if (!(await accountCan(ownerId, "api.tokens", now))) {
    return { ok: false, reason: "not-entitled" };
  }
  // **The WHOLE input is parsed here, not just the lifetime.**
  //
  // The lifetime was already re-checked with the argument that *"a ceiling that
  // lives only in a request schema is one an internal caller walks straight
  // past"* — and that argument covers `name`, `scopes` and `tripIds` exactly as
  // well. Writing those through unparsed meant an internal caller could store a
  // scope the enum does not know, which `toDto` then silently filters out: the
  // token comes back with fewer powers than it was asked for, and nothing says
  // so. Caught by CodeRabbit on pull request 185.
  const parsed = ApiTokenCreateInput.safeParse(input);
  if (!parsed.success) {
    // The lifetime keeps its own answer, because a caller can act on it — the
    // ceiling is a number they can lower. Everything else is a shape error.
    const lifetime = parsed.error.issues.some((issue) => issue.path[0] === "expiresInDays");
    return lifetime
      ? { ok: false, reason: "invalid-lifetime", maxDays: API_TOKEN_MAX_LIFETIME_DAYS }
      : { ok: false, reason: "invalid-input", issues: parsed.error.issues };
  }
  const valid = parsed.data;

  const secret = mintSecret();
  const expiresAt = new Date(now.getTime() + valid.expiresInDays * 24 * 60 * 60 * 1000);
  const [row] = await db
    .insert(apiTokens)
    .values({
      id: randomUUID(),
      ownerId,
      name: valid.name,
      tokenHash: hashOf(secret),
      prefix: secret.slice(0, API_TOKEN_PREFIX_LENGTH),
      scopes: valid.scopes,
      tripIds: valid.tripIds,
      createdAt: now,
      lastUsedAt: null,
      expiresAt,
      revokedAt: null,
    })
    .returning();

  // **The only moment the secret is ever returned.** Nothing stores it, so
  // nothing can return it again — which is why `ApiToken` has no field for it.
  return { ok: true, created: { token: toDto(row!), secret } };
}

/**
 * Every token this account has, newest first — including expired and revoked.
 *
 * **Dead tokens are listed on purpose.** An expired token is refused, not
 * deleted, and the row is how its owner learns *why* an integration stopped.
 * Hiding it would answer "your token vanished", which is the one explanation
 * that sends someone to support.
 */
export async function listTokens(ownerId: string): Promise<ApiToken[]> {
  // **Ordered in SQL, and `id` is the tie-break rather than decoration.**
  //
  // This was a JS sort on `createdAt` alone over an unordered SELECT. Two tokens
  // minted in the same millisecond compared equal, so their order was whatever
  // Postgres happened to return — which can differ between two reads of the same
  // rows. A list that reshuffles under someone deciding which token to revoke is
  // a worse bug than the flaky test that found it (CodeRabbit on pull request 185).
  const rows = await db
    .select()
    .from(apiTokens)
    .where(eq(apiTokens.ownerId, ownerId))
    .orderBy(desc(apiTokens.createdAt), desc(apiTokens.id));
  return rows.map(toDto);
}

/**
 * Resolve a presented secret to an actor, or say why not.
 *
 * **Expiry and revocation are resolved HERE, on read, and never swept.** The
 * `entitlement_grants` rule. There is no job, no cron and no cleanup; a token
 * stops working because this function says so, which is also why re-entitling
 * an account restores every one of its tokens with zero writes.
 */
export async function verifyToken(secret: string, now: Date = new Date()): Promise<VerifyResult> {
  // A secret that could not have been minted here cannot name a row. Answering
  // before touching the database also means a malformed `Authorization` header
  // costs nothing.
  if (!secret.startsWith(API_TOKEN_PREFIX)) return { ok: false, refusal: { reason: "unknown" } };

  const rows = await db.select().from(apiTokens).where(eq(apiTokens.tokenHash, hashOf(secret)));
  const row = rows[0];
  if (row === undefined || !hashesMatch(row.tokenHash, hashOf(secret))) {
    return { ok: false, refusal: { reason: "unknown" } };
  }

  // **Revoked before expired**, deliberately: a token that was revoked and has
  // since also expired was cut off, and that is the more useful thing to be
  // told. The reverse order would report the later event as the cause.
  if (row.revokedAt !== null) {
    return { ok: false, refusal: { reason: "revoked", revokedAt: row.revokedAt } };
  }
  if (row.expiresAt <= now) {
    return { ok: false, refusal: { reason: "expired", expiresAt: row.expiresAt } };
  }

  // **The owner's entitlements, resolved now, from the database.** Never cached
  // on the row and never read from a JWT (M20's third rule) — a downgrade must
  // bite before a token refreshes, and a token lives for months.
  //
  // **A lapse DISABLES rather than revokes**: `revoked_at` stays null, so
  // re-subscribing restores every token this account holds with no writes at
  // all. A billing lapse can never destroy a customer's integration.
  if (!(await accountCan(row.ownerId, "api.tokens", now))) {
    return { ok: false, refusal: { reason: "not-entitled", ownerId: row.ownerId } };
  }

  return {
    ok: true,
    token: {
      tokenId: row.id,
      ownerId: row.ownerId,
      scopes: new Set(
        row.scopes.filter((scope): scope is ApiScope => ApiScope.safeParse(scope).success),
      ),
      tripIds: row.tripIds === null ? null : new Set(row.tripIds),
    },
  };
}

/** How stale `last_used_at` may get before a use is worth a write. */
const LAST_USED_COARSENING_MS = 5 * 60 * 1000;

/**
 * Record that a token was used, at most once every five minutes.
 *
 * **A write on a read path, bounded** (Decision 7). The value is worth having —
 * it is how a person decides a token is dead — but not at the price of a row
 * write per request. The guard is in the `WHERE`, not in application code, so
 * concurrent requests cannot each decide they are the one that should write.
 *
 * **Never blocks the response and never fails a request.** A token that worked
 * must not 500 because a bookkeeping update lost a race.
 */
export async function touchLastUsed(
  tokenId: string,
  now: Date = new Date(),
): Promise<void> {
  const staleBefore = new Date(now.getTime() - LAST_USED_COARSENING_MS);
  try {
    await db
      .update(apiTokens)
      .set({ lastUsedAt: now })
      .where(
        and(
          eq(apiTokens.id, tokenId),
          // Null means never used, which is always worth recording.
          sql`(${apiTokens.lastUsedAt} IS NULL OR ${apiTokens.lastUsedAt} < ${staleBefore})`,
        ),
      );
  } catch (error) {
    // **The contract is kept HERE, not by every caller remembering.** This
    // function's own comment promises it never fails a request; without this it
    // rejected, and the promise held only because the one caller happened to
    // write `.catch`. A second caller that forgot would 500 a request whose
    // token was perfectly valid (CodeRabbit on pull request 185).
    //
    // Logged rather than swallowed silently: a bookkeeping write that is failing
    // every time is worth knowing about, even though it is never worth failing a
    // request over.
    console.error("api token last_used_at touch failed", { tokenId, error });
  }
}

export type RevokeResult =
  | { ok: true; token: ApiToken }
  | { ok: false; reason: "not-found" };

/**
 * Revoke a token. Idempotent, and safe against a concurrent use.
 *
 * **One guarded `UPDATE … WHERE revoked_at IS NULL RETURNING`, never a read
 * followed by a write.** That shape is the one hard-won lesson from
 * `revokeInvite`: under READ COMMITTED a prior SELECT sees the row as it was
 * before a concurrent statement took its lock, and acting on that stale read is
 * what let a revoked invite keep its membership (PR #71 §1). It costs nothing
 * to not repeat here.
 *
 * **Already-revoked is `ok`, not 404** — matching `revokeShare`, so a
 * double-click cannot produce a scary error. A non-uuid id is 404 rather than a
 * Postgres `22P02` 500 (KI-2026-09-05-x).
 */
export async function revokeToken(
  ownerId: string,
  tokenId: string,
  now: Date = new Date(),
): Promise<RevokeResult> {
  if (!isUuid(tokenId)) return { ok: false, reason: "not-found" };

  const claimed = await db
    .update(apiTokens)
    .set({ revokedAt: now })
    .where(
      and(
        eq(apiTokens.id, tokenId),
        // **Scoped to the owner in the WHERE**, so one account cannot revoke
        // another's token even if it guesses an id. An ownership check in
        // application code would be a second read to race.
        eq(apiTokens.ownerId, ownerId),
        isNull(apiTokens.revokedAt),
      ),
    )
    .returning();
  if (claimed[0] !== undefined) return { ok: true, token: toDto(claimed[0]) };

  // Nothing matched: either no such token of this owner's, or it was already
  // revoked. Re-read to tell those apart — only the second is a success.
  const rows = await db
    .select()
    .from(apiTokens)
    .where(and(eq(apiTokens.id, tokenId), eq(apiTokens.ownerId, ownerId)));
  const row = rows[0];
  if (row === undefined) return { ok: false, reason: "not-found" };
  return { ok: true, token: toDto(row) };
}

/**
 * Tokens that have expired but were never revoked — for a screen, never a job.
 *
 * Exported so the token UI can say *"3 expired"* without every caller
 * re-deriving the comparison. **Nothing here deletes anything**, and
 * `apiTokens.retention.test.ts` fails if a caller that does ever appears.
 */
export async function expiredTokensFor(ownerId: string, now: Date = new Date()): Promise<ApiToken[]> {
  const rows = await db
    .select()
    .from(apiTokens)
    .where(and(eq(apiTokens.ownerId, ownerId), isNull(apiTokens.revokedAt), lt(apiTokens.expiresAt, now)));
  return rows.map(toDto);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
