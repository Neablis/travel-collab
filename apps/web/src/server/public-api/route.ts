import type { z } from "zod";
import {
  ApiErrorCode,
  type ApiScope,
  type TripDetail,
  type TripRole,
} from "@tc/contracts";
import { touchLastUsed } from "@/server/api-tokens";
import { PublicApiError } from "./commands";
import { tripAccessFor, type TripAccessDenial } from "@/server/access/trip-access";
import { consumeQuota, type QuotaPolicy } from "@/server/quota";
import {
  actorHasScope,
  actorMayReachTrip,
  resolveActor,
  type Actor,
  type ActorRefusal,
} from "./actor";

// **The one wrapper every public endpoint is declared through** (M22 Phase 2,
// Decision 2). Modelled on ADR-037's `WidgetDef`: one module carries everything
// about itself, and nothing about it lives anywhere else.
//
// **This file is the milestone's thesis.** Everything cross-cutting happens here
// exactly once — credential resolution, scope check, trip confinement, the role
// gate, request parsing, response validation, the error envelope, status codes,
// `WWW-Authenticate`, rate limiting, `last_used_at`, pagination. What a new
// endpoint costs is a declaration of intent: a scope string, maybe a role, the
// schemas it needed anyway, and the thing it actually does.
//
// **That irreducible declaration is a feature, not a residue.** `MINIMUM_ROLE`
// in `accessPolicy.ts` makes the same trade for the same reason — *"an
// exhaustive Record so a new TripCommand fails to compile until someone decides
// who may run it."* A route that had to declare nothing would be a route nobody
// decided the authority of.
//
// **There is no route registry here or anywhere.** A route is public if and only
// if its file lives under `src/app/api/v1/**` (Decision 1). The Next.js file
// router already decides the URL and cannot drift from itself; a hand-kept list
// beside it is the second copy invariant 5 exists to stop. What makes that
// enforceable rather than aspirational is `conformance.test.ts`, which walks
// `v1/**` and fails on an export that did not come through this function.

/** The HTTP methods a `v1` route may export. */
export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

/** Where the wrapper finds the trip id a trip-scoped endpoint is about. */
export type TripSource = "path";

interface BaseDef {
  /** The single scope a token must hold. A session holds every scope. */
  readonly scope: ApiScope;
  /**
   * Declares this endpoint is about one trip, and where its id comes from.
   *
   * Setting it buys three things at once: the token's trip confinement is
   * checked, the member role gate runs, and `ctx.trip` arrives as a parsed
   * `TripDetail` the handler did not have to load.
   */
  readonly trip?: TripSource;
  /** The minimum `TripRole` on that trip. Required with `trip`, meaningless without. */
  readonly role?: TripRole;
  readonly query?: z.ZodTypeAny;
  readonly body?: z.ZodTypeAny;
  /**
   * A ceiling on the request body, in bytes. Refused as a 400 **naming the
   * limit**, never clamped or truncated — the same rule `?limit=` follows, and
   * for the same reason: a caller who sent 8 MB and silently got the first 2
   * has a trip missing its last four days and nothing to read about why.
   *
   * **Here rather than in a handler**, because the wrapper owns body reading
   * and a handler never sees the `Request`. Doing it in a handler would mean a
   * second read of a body that has already been consumed, and a second error
   * shape on a surface whose whole claim is one envelope.
   *
   * Only endpoints that take a file-shaped body set it. A JSON patch with five
   * fields has no use for one.
   */
  readonly maxBodyBytes?: number;
  /**
   * The success status, when the default is wrong.
   *
   * `GET`/`PATCH`/`DELETE` answer 200 and `POST` answers 201, because a POST
   * usually creates something. The exceptions are the three actions REST has no
   * noun for — undo, redo and revert — which are POSTs that create nothing and
   * should say 200. One number, declared where it is true.
   */
  readonly status?: number;
  /** Response headers this endpoint may set, name → description, published in openapi.json. */
  readonly responseHeaders?: Readonly<Record<string, string>>;
}

/** An endpoint returning one resource. */
export interface ResourceDef extends BaseDef {
  readonly response: z.ZodTypeAny;
  readonly handle: (ctx: HandlerContext) => Promise<unknown> | unknown;
}

/** An endpoint returning a page of a collection. */
export interface CollectionDef<I = unknown> extends BaseDef {
  readonly collection: {
    readonly item: z.ZodType<I>;
    /**
     * The opaque cursor for an item — whatever the handler orders by.
     *
     * One line per collection endpoint, and it is the only pagination cost a
     * route pays. The wrapper owns the `?limit=` bounds, the `?cursor=`
     * round-trip, the `{ items, nextCursor }` envelope and the decision that
     * there is one shape for all of them.
     */
    readonly cursorOf: (item: I) => string;
  };
  readonly handle: (ctx: HandlerContext) => Promise<I[]> | I[];
}

/**
 * **The response/handler correspondence is enforced at RUNTIME, not by the
 * compiler, and that is the deliberate trade.**
 *
 * Typing `handle`'s return against `response`'s inferred output is expressible,
 * and it costs the ergonomics this wrapper exists for: the declaration object
 * has to become eight inference sites, and a handler whose return needs a
 * widening cast starts fighting the schema instead of describing the endpoint.
 *
 * The runtime check is also the stronger one for a *public* API. A compiler
 * check proves the handler's declared type matches; it cannot prove the row the
 * database actually returned does. `route()` validates every response against
 * its own schema on the way out and answers 500 with a logged diff if it does
 * not — so a contract we published and then broke is caught by the first
 * request rather than by a caller's parser.
 * `route.int.test.ts` proves that refusal happens.
 */
export type MethodDef = ResourceDef | CollectionDef<CollectionItem>;

/**
 * The item type a collection declaration is checked against.
 *
 * **`any` as a CONSTRAINT, not as the declaration's own type.** A collection
 * endpoint annotates its `cursorOf` parameter with the real schema's type — one
 * word, at the one place in a collection where the item's shape matters — and is
 * fully checked there. What this widens is only what `route()` will *accept*,
 * and it has to be bivariant: `unknown` here rejects every honest declaration,
 * because `(trip: TripSummary) => string` is not assignable to
 * `(item: unknown) => string`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CollectionItem = any;

/** The declaration object a `v1` route module exports. */
export type RouteDefs = { readonly [K in HttpMethod]?: MethodDef };

/**
 * Everything a handler is given.
 *
 * **One context type for both kinds of endpoint, deliberately.** Splitting it
 * into `HandlerContext` and a `PageContext` that extends it reads better and
 * costs the thing this wrapper exists for: TypeScript cannot contextually type a
 * parameter through a union of two function types whose parameters differ, so
 * every declaration's `({ actor, trip })` would become an implicit `any` and
 * each route would have to annotate its own context. One shared shape keeps the
 * declaration a declaration.
 */
export interface HandlerContext {
  readonly actor: Actor;
  readonly params: Readonly<Record<string, string>>;
  readonly query: unknown;
  readonly body: unknown;
  /** Present exactly when the declaration set `trip`. Parsed, member-overlaid. */
  readonly trip?: TripDetail;
  /** The actor's role on that trip, when `trip` is set. */
  readonly role?: TripRole;
  /**
   * The page a collection endpoint was asked for.
   *
   * Always parsed, because the wrapper always owns `?limit=` and `?cursor=`.
   * A resource endpoint ignores it — `GET /v1/trips/:id` has one answer, and a
   * caller passing `?limit=2` to it is not paging anything.
   */
  readonly page: {
    /** Refused outside `[1, MAX_PAGE_LIMIT]`, never clamped into it. */
    readonly limit: number;
    /** The opaque cursor, or `null` for the first page. */
    readonly after: string | null;
  };
  /**
   * Headers the handler wants on its response. Sent on success and on a
   * deliberate `PublicApiError` refusal (e.g. `Retry-After` on a 429), never on
   * a 500 — a crashed handler's half-set headers describe nothing.
   */
  readonly responseHeaders: Headers;
}

/**
 * Build the cursor for a list ordered by `(sortKey, id)`.
 *
 * **Every keyset cursor needs the tie-break, not just the sort key.** Three of
 * this surface's collections paged on a bare timestamp, and a bare timestamp
 * ties: two rows written in the same millisecond compare equal, so `createdAt <
 * cursor` steps straight past the second one and it is never returned on any
 * page. The row is not skipped visibly — the caller just receives a library
 * with a day missing and no way to tell.
 */
export function keyedCursor(sortKey: string, id: string): string {
  return `${sortKey}|${id}`;
}

/**
 * Split a cursor `keyedCursor` minted, or `null` to start from the beginning.
 *
 * A cursor we did not mint is treated as no cursor, matching
 * `listTripSummariesPage`: it can only cost the caller a first page, and
 * 400-ing on an opaque string we asked them not to interpret would be punishing
 * them for obeying.
 */
export function decodeKeyedCursor(after: string | null): { sortKey: string; id: string } | null {
  if (after === null) return null;
  const sep = after.indexOf("|");
  if (sep === -1) return null;
  const sortKey = after.slice(0, sep);
  const id = after.slice(sep + 1);
  return sortKey === "" || id === "" ? null : { sortKey, id };
}

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 200;

/**
 * The rate limit every token-authenticated request passes.
 *
 * **Reuses `consumeQuota` with no new infrastructure** — the Postgres counter
 * table, the window arithmetic, the 429 with `Retry-After` and the
 * fail-closed-to-503 when the counter store itself fails all already exist.
 *
 * **One deviation from the design worth naming**: it specified a bucket
 * `"api:token:<tokenId>"`, and `consumeQuota` composes its own bucket names as
 * `"<policy>:user:<id>"`. Rather than fork the quota module to spell one string
 * differently, the token id is passed as the identity — so the real buckets are
 * `api:user:<tokenId>` and `api:global`. The second is exactly what the design
 * asked for; the first differs in spelling only, and forking a counter module
 * over a substring would have been the more expensive mistake.
 *
 * **Session traffic is untouched**, because a session actor has no token id and
 * this is not called for one.
 */
export const API_TOKEN_QUOTA: QuotaPolicy = {
  name: "api",
  windowMs: 60 * 60 * 1000,
  perUser: 1000,
  global: 50_000,
};

/** Marks a handler as having come through `route()`. The conformance test reads it. */
export const DECLARED = Symbol.for("tc.publicApi.declared");

export interface DeclaredHandler {
  (request: Request, context: { params: Promise<Record<string, string>> }): Promise<Response>;
  [DECLARED]: {
    readonly method: HttpMethod;
    readonly scope: ApiScope;
    readonly trip?: TripSource;
    readonly role?: TripRole;
    readonly kind: "resource" | "collection";
    /**
     * The declaration itself, so the OpenAPI generator reads the very schemas
     * the wrapper validates against.
     *
     * **Not a copy of them.** A generator given its own list of shapes is the
     * second source of truth this design exists to avoid — the docs would then
     * be able to drift from the implementation, which is the thing Decision 9
     * claims is impossible here.
     */
    readonly def: MethodDef;
  };
}

function fail(
  code: z.infer<typeof ApiErrorCode>,
  message: string,
  status: number,
  extra?: { details?: unknown; headers?: Record<string, string> },
): Response {
  return Response.json(
    { error: { code, message, ...(extra?.details === undefined ? {} : { details: extra.details }) } },
    { status, headers: extra?.headers },
  );
}

/**
 * The refusal for a body over `maxBodyBytes`, **naming the limit**.
 *
 * **400 and not 413, deliberately.** `413 Payload Too Large` is the more
 * precise status and M25's exit gate says 400 — *"refused with the limit named,
 * as a 400 and not a truncation, a timeout or a 500"* — and a gate definition
 * changes only by Mitchell's explicit decision, not by a build preferring a
 * different number. The `details`-free message is what a caller acts on either
 * way. Recorded here so the next reader finds the reason rather than the
 * discrepancy.
 */
function tooLarge(max: number): string {
  return `That file is too large. The limit is ${max.toLocaleString("en-US")} bytes.`;
}

/**
 * The byte length of a string as it arrived, not its character count.
 *
 * `"京".length` is 1 and it costs 3 bytes on the wire. A limit measured in
 * characters would let a bundle of CJK stop titles through at three times the
 * size it was meant to allow.
 */
function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** 401s carry `WWW-Authenticate`, because a bearer scheme that does not is guessing. */
const BEARER_CHALLENGE = { "WWW-Authenticate": "Bearer" };

const DENIAL_TO_ERROR: Record<TripAccessDenial, { code: z.infer<typeof ApiErrorCode>; status: number; message: string }> = {
  // A stranger and an under-privileged member get the same answer, because
  // telling them apart would confirm the trip exists.
  "not-found": { code: "not-found", status: 404, message: "No such trip." },
  forbidden: { code: "forbidden", status: 403, message: "You do not have access to this trip." },
  "malformed-trip": {
    code: "server-error",
    status: 500,
    message: "This trip could not be read. The failure has been logged.",
  },
};

/**
 * The wire code for a `PublicApiError` thrown without one.
 *
 * **The fallback used to be `invalid-request`, and that was wrong above 4xx.**
 * A handler throwing `PublicApiError(500, ...)` — the history route's broken
 * invariant, say — answered a server failure with the code that means "you sent
 * something bad", which is the one reading an integrator must not be given.
 * Defaulting by status class means a declaration only spells a code out when it
 * wants a *more specific* one than the status implies.
 */
function codeForStatus(status: number): z.infer<typeof ApiErrorCode> {
  if (status >= 500) return "server-error";
  if (status === 409) return "conflict";
  if (status === 404) return "not-found";
  if (status === 403) return "forbidden";
  if (status === 401) return "unauthenticated";
  if (status === 429) return "rate-limited";
  return "invalid-request";
}

function isCollection(def: MethodDef): def is CollectionDef<CollectionItem> {
  return "collection" in def;
}

/**
 * Declare a public endpoint.
 *
 * ```ts
 * export const { GET } = route({
 *   GET: {
 *     scope: "trips:read",
 *     trip: "path",
 *     role: "viewer",
 *     response: TripDetail,
 *     handle: ({ trip }) => trip!,
 *   },
 * });
 * ```
 */
export function route<D extends RouteDefs>(defs: D): { [K in keyof D]: DeclaredHandler } {
  const handlers: Partial<Record<HttpMethod, DeclaredHandler>> = {};
  for (const [method, def] of Object.entries(defs) as [HttpMethod, MethodDef][]) {
    handlers[method] = declare(method, def);
  }
  // **Exactly the methods that were declared.** The mapped return type is what
  // makes `export const { GET, POST } = route({ GET: ... })` a compile error
  // rather than an undefined export Next.js would happily route traffic to.
  return handlers as { [K in keyof D]: DeclaredHandler };
}

function declare(method: HttpMethod, def: MethodDef): DeclaredHandler {
  const handler = async (
    request: Request,
    context: { params: Promise<Record<string, string>> },
  ): Promise<Response> => {
    // ---- credential ------------------------------------------------------
    const resolution = await resolveActor(request);
    if (!resolution.ok) return refusalResponse(resolution.refusal);
    const actor = resolution.actor;

    // ---- rate limit, tokens only ----------------------------------------
    if (actor.via === "token") {
      const decision = await consumeQuota([API_TOKEN_QUOTA], actor.tokenId);
      if (!decision.allowed) {
        // **Fail closed when the counter store is down.** A rate limiter that
        // opens under load is not a rate limiter; `quota.ts` already made this
        // call and this inherits it rather than re-deciding.
        return decision.reason === "unavailable"
          ? fail("service-unavailable", "Try again shortly.", 503, {
              headers: { "Retry-After": String(decision.retryAfterSeconds) },
            })
          : fail("rate-limited", "Too many requests.", 429, {
              headers: { "Retry-After": String(decision.retryAfterSeconds) },
            });
      }
    }

    // ---- scope -----------------------------------------------------------
    // **Names the scope it wanted.** That leaks nothing a caller does not
    // already know about its own token, and it saves a support round trip.
    if (!actorHasScope(actor, def.scope)) {
      return fail(
        "insufficient-scope",
        `This token does not hold the "${def.scope}" scope.`,
        403,
        { details: { required: def.scope } },
      );
    }

    const params = await context.params;

    // ---- request shape ---------------------------------------------------
    let query: unknown;
    if (def.query !== undefined) {
      const url = new URL(request.url);
      const parsed = def.query.safeParse(Object.fromEntries(url.searchParams));
      if (!parsed.success) {
        return fail("invalid-request", "The query string is not valid.", 400, {
          details: parsed.error.issues,
        });
      }
      query = parsed.data;
    }

    let body: unknown;
    if (def.body !== undefined) {
      // **Measured, not trusted.** `Content-Length` is a claim a client makes
      // and can be absent entirely on a chunked upload, so it is worth an early
      // refusal and is never the answer on its own. The text below is what
      // actually arrived.
      const max = def.maxBodyBytes;
      if (max !== undefined) {
        const claimed = Number(request.headers.get("content-length"));
        if (Number.isFinite(claimed) && claimed > max) {
          return fail("invalid-request", tooLarge(max), 400);
        }
      }
      // `text()` rather than `json()` so the size can be measured before it is
      // parsed. `JSON.parse` on a string this process already holds costs the
      // same as letting `json()` do it.
      const text = await request.text().catch(() => undefined);
      if (max !== undefined && text !== undefined && byteLength(text) > max) {
        return fail("invalid-request", tooLarge(max), 400);
      }
      let raw: unknown;
      try {
        raw = text === undefined ? undefined : JSON.parse(text);
      } catch {
        raw = undefined;
      }
      const parsed = def.body.safeParse(raw);
      if (!parsed.success) {
        return fail("invalid-request", "The request body is not valid.", 400, {
          details: parsed.error.issues,
        });
      }
      body = parsed.data;
    }

    // ---- pagination ------------------------------------------------------
    const url = new URL(request.url);
    const rawLimit = url.searchParams.get("limit");
    let limit = DEFAULT_PAGE_LIMIT;
    if (rawLimit !== null) {
      const n = Number(rawLimit);
      // **Refused, not clamped.** A caller who asked for 5,000 and silently got
      // 200 will page forever and never know why.
      if (!Number.isInteger(n) || n < 1 || n > MAX_PAGE_LIMIT) {
        return fail("invalid-request", `"limit" must be between 1 and ${MAX_PAGE_LIMIT}.`, 400);
      }
      limit = n;
    }
    const page = { limit, after: url.searchParams.get("cursor") };

    // ---- the two gates, in order ----------------------------------------
    let trip: TripDetail | undefined;
    let role: TripRole | undefined;
    if (def.trip !== undefined) {
      const tripId = params["tripId"];
      if (tripId === undefined) {
        // A declaration error, not a caller's: `trip: "path"` on a route with
        // no `[tripId]` segment. 500 rather than 404, because pretending the
        // trip is missing would hide our own mistake.
        return fail("server-error", "This endpoint is misdeclared.", 500);
      }
      // **Gate one: may this CREDENTIAL reach this trip.** A trip-scoped token
      // asking about a trip it does not name is refused here, before the
      // membership question — so the answer cannot leak whether the trip
      // exists or whether its owner is a member.
      if (!actorMayReachTrip(actor, tripId)) {
        return fail("trip-out-of-scope", "This token is not scoped to that trip.", 403);
      }
      // **Gate two: may this USER act on this trip.** The unchanged seam, with
      // the actor handed in rather than resolved again. This is what makes a
      // token unable to grant more than its owner holds, and what makes it
      // degrade the instant a membership changes.
      //
      // **And it needs its own catch, because it runs before the handler's.**
      // `tripAccessFor` converts a stored document it cannot parse into a
      // denial, and deliberately lets everything else through — a dropped
      // connection, a `22P02`, a pool timeout. Those are real and they are not
      // "this trip is unreadable", so they propagate. But this call sits above
      // the `try` below, so a propagated one left `route()` entirely and the
      // caller got whatever Next renders for an unhandled throw, on a surface
      // whose whole claim is one envelope, always.
      let outcome: Awaited<ReturnType<typeof tripAccessFor>>;
      try {
        outcome = await tripAccessFor(actor.userId, tripId, def.role ?? "viewer");
      } catch (error) {
        console.error("v1 trip gate threw", { method, scope: def.scope, tripId, error });
        return fail("server-error", "Something went wrong. The failure has been logged.", 500);
      }
      if (!outcome.ok) {
        const mapped = DENIAL_TO_ERROR[outcome.denial];
        return fail(mapped.code, mapped.message, mapped.status);
      }
      trip = outcome.detail;
      role = outcome.role;
    } else if (actor.via === "token" && actor.tripIds !== null) {
      // **A trip-scoped token is refused on a route with no trip dimension.**
      // `POST /v1/trips` and `GET /v1/account` are widenings for a credential
      // restricted to named trips, and the safe answer is the boring one.
      return fail(
        "trip-out-of-scope",
        "This token is scoped to specific trips, and this endpoint is not about one.",
        403,
      );
    }

    // ---- the thing the endpoint actually does ----------------------------
    const responseHeaders = new Headers();
    const base: HandlerContext = { actor, params, query, body, trip, role, page, responseHeaders };
    let payload: unknown;
    try {
      payload = isCollection(def)
        ? await declareCollection(def as CollectionDef<CollectionItem>, base)
        : await (def as ResourceDef).handle(base);
    } catch (error) {
      // **A handler may refuse deliberately**, and that is not a crash. A write
      // that maps to a command gets its answer from the domain — "no such day",
      // "not an editor" — and rethrowing it as a 500 would tell a caller the
      // server broke when in fact they were told no.
      if (error instanceof PublicApiError) {
        return fail(
          (error.code as z.infer<typeof ApiErrorCode> | undefined) ?? codeForStatus(error.status),
          error.message,
          error.status,
          { headers: Object.fromEntries(responseHeaders) },
        );
      }
      // Anything else is ours to explain and never the caller's to read.
      console.error("v1 handler threw", { method, scope: def.scope, error });
      return fail("server-error", "Something went wrong. The failure has been logged.", 500);
    }

    // ---- response shape --------------------------------------------------
    // **Validated on the way out, every time.** A response that does not match
    // its declared schema is a contract we published and then broke, and the
    // one place to find that is here rather than in a caller's parser.
    const shape = isCollection(def)
      ? undefined
      : (def as ResourceDef).response.safeParse(payload);
    if (shape !== undefined && !shape.success) {
      console.error("v1 response failed its own schema", {
        method,
        scope: def.scope,
        issues: shape.error.issues,
      });
      return fail("server-error", "Something went wrong. The failure has been logged.", 500);
    }

    // ---- bookkeeping, never blocking -------------------------------------
    if (actor.via === "token") {
      // Fire-and-forget: a token that worked must not 500 because a
      // five-minute-coarsened bookkeeping update lost a race.
      void touchLastUsed(actor.tokenId).catch((error: unknown) => {
        console.error("last_used_at touch failed", { tokenId: actor.tokenId, error });
      });
    }

    return Response.json(shape === undefined ? payload : shape.data, {
      status: def.status ?? (method === "POST" ? 201 : 200),
      headers: responseHeaders,
    });
  };

  return Object.assign(handler, {
    [DECLARED]: {
      method,
      scope: def.scope,
      trip: def.trip,
      role: def.role,
      kind: isCollection(def) ? ("collection" as const) : ("resource" as const),
      def,
    },
  }) as DeclaredHandler;
}

/** Run a collection handler and wrap its page, validating each item. */
async function declareCollection(
  def: CollectionDef<CollectionItem>,
  ctx: HandlerContext,
): Promise<{ items: unknown[]; nextCursor: string | null }> {
  const items = await def.handle(ctx);
  for (const item of items) def.collection.item.parse(item);
  // **A full page means there may be more; a short one is the end.** The
  // handler is asked for `limit` items and the cursor is the last one's key, so
  // there is no count query and no offset — which is what keeps this the same
  // decision for every collection rather than a per-endpoint negotiation.
  const nextCursor =
    items.length === ctx.page.limit && items.length > 0
      ? def.collection.cursorOf(items[items.length - 1]!)
      : null;
  return { items, nextCursor };
}

function refusalResponse(refusal: ActorRefusal): Response {
  if (refusal.reason === "anonymous") {
    return fail("unauthenticated", "This endpoint needs an API token.", 401, {
      headers: BEARER_CHALLENGE,
    });
  }
  switch (refusal.refusal.reason) {
    case "expired":
      // **Distinct from revoked, deliberately** (Decision 13). An integrator
      // reading this learns "mint a new one" rather than "you were cut off".
      return fail("token-expired", "This token has expired. Mint a new one.", 401, {
        headers: BEARER_CHALLENGE,
      });
    case "revoked":
      return fail("token-revoked", "This token was revoked.", 401, { headers: BEARER_CHALLENGE });
    case "not-entitled":
      // A lapse disables rather than revokes, so the message names the plan
      // and not the token — re-subscribing brings every token back.
      return fail(
        "not-entitled",
        "This account's plan does not include API access.",
        402,
      );
    case "unknown":
    default:
      return fail("unauthenticated", "This token is not valid.", 401, {
        headers: BEARER_CHALLENGE,
      });
  }
}
