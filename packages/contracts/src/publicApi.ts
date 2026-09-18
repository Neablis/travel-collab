import { z } from "zod";
import { Location } from "./activity.ts";

/**
 * The public REST API's wire vocabulary (M22, the 2026-09-16 design).
 *
 * **Two surfaces, and this file owns the words of exactly one.**
 * `apps/web/src/app/api/v1/**` is the public API: versioned, reachable with an
 * account's API token, and documented. Everything else under
 * `apps/web/src/app/api/**` is the frontend's BFF — session-cookie only, never
 * token-reachable, free to change shape without notice. **A route is public if
 * and only if its file is under `v1/`** (Decision 1), which is why there is no
 * registry constant here and must never be one: the Next.js file router already
 * decides the URL, and a second list of the same truth is the drift invariant 5
 * exists to stop.
 *
 * **This file owns the words and nothing else**, on the same split as
 * `entitlement.ts` (ADR-045 rule 6). Which scopes a given *token* holds is a
 * row in `api_tokens`; which scope a given *route* demands is a field on that
 * route's declaration. Neither lives here.
 *
 * **Phase 0 of five.** Nothing reads these yet — the storage, the `route()`
 * wrapper and the token UI are Phases 1 through 3. The vocabulary lands first
 * because everything after it depends on the words, and a word changed after
 * its second consumer exists is a migration rather than an edit.
 */

/**
 * What an API token may do. A capability, never a resource and never a route.
 *
 * **Eight, deliberately not per-endpoint and not per-table** (Decision 4,
 * confirmed by Mitchell 2026-09-16). Coarser — a single `read` and `write` —
 * makes one token do everything and stops the scope system meaning anything.
 * Finer, per resource, is roughly sixteen strings most callers would never set
 * differently from their neighbour.
 *
 * **`sharing:write` is separate from `trips:write`, and that separation was a
 * gap found by writing this list out in plain language rather than by design.**
 * The first draft had seven, and under it *creating an invite* fell under
 * `trips:write`, because an invite is an ordinary table write against a trip.
 * The module map is what says that is wrong: **"let another person into my trip"
 * is Access & Membership, not Trip Planning.** A token minted to sync an
 * itinerary from a calendar should not be able to hand a stranger editor rights,
 * and under the seven-scope draft it silently could.
 *
 * **No ordering export and no `atLeast`** — the same refusal as `PlanId`, for
 * the same reason (ADR-045 rule 4). A comparison operator anywhere near this
 * forces every later scope to be a superset of an earlier one, permanently and
 * quietly. **`trips:write` does not imply `trips:read`**; a token asks for both.
 *
 * **Three absences are load-bearing rather than TODOs**, each fixed by Mitchell
 * at placement: nothing for AI (a token may not spend model budget, so `/ask`
 * and `/ask/apply` are not in `v1` and no string here names them), nothing for
 * admin (`/api/admin/**` keeps its 404-on-failure posture), and nothing for
 * billing writes (checkout and the portal move money and are session-only
 * forever).
 */
export const ApiScope = z.enum([
  "trips:read",
  "trips:write",
  "notebook:read",
  "notebook:write",
  "library:read",
  "library:write",
  "sharing:write",
  "account:read",
]);
export type ApiScope = z.infer<typeof ApiScope>;

/** Every scope, for a call site that must handle all of them. */
export const API_SCOPES: readonly ApiScope[] = ApiScope.options;

/** One scope, in the words a person reads when deciding whether to grant it. */
export interface ApiScopeDescription {
  /** Two or three words, for the checkbox label. */
  readonly title: string;
  /** One sentence, in the second person, naming what the holder may actually do. */
  readonly description: string;
}

/**
 * What each scope means, in the words the token-creation UI has to use.
 *
 * **Exhaustive over `ApiScope`, and that is the entire point.** A ninth scope
 * **fails to compile** until somebody writes the sentence a person reads when
 * deciding whether to grant it. The alternative — writing the copy when the UI
 * is built — means eight sentences get drafted in a hurry by whoever happens to
 * be building a form, long after the person who knew what the scope was for.
 *
 * **Copy in a contracts package is deliberate here**, and it has precedent:
 * `AdminGrantInput`'s refusal message is user-facing text in this same package.
 * These sentences are not one screen's decoration — they are what `openapi.json`
 * will publish (Decision 9) and what the token UI will render (Phase 3), and two
 * copies of them would disagree within a release.
 *
 * **Reads of the sharing surface stay under `trips:read`** — listing your own
 * trip's share links is not more sensitive than reading the trip. One thing to
 * re-check when the DTO exists: if listing invites exposes third-party email
 * addresses, that read earns its own scope after all.
 */
export const SCOPE_CATALOGUE: Readonly<Record<ApiScope, ApiScopeDescription>> = Object.freeze({
  "trips:read": {
    title: "Read trips",
    description:
      "See your trips, their days and stops, costs, history, and existing share links.",
  },
  "trips:write": {
    title: "Change trips",
    description:
      "Create, change and delete trips, days and stops; undo, redo and revert.",
  },
  "notebook:read": {
    title: "Read the Notebook",
    description: "Read the Notebook pages on a trip.",
  },
  "notebook:write": {
    title: "Write the Notebook",
    description: "Create, change and delete the Notebook pages on a trip.",
  },
  "library:read": {
    title: "Read your library",
    description: "Read your saved-days library.",
  },
  "library:write": {
    title: "Change your library",
    description:
      "Create and delete saved days, and publish or unpublish them to Discover.",
  },
  "sharing:write": {
    title: "Invite and share",
    description:
      "Invite people to a trip, revoke invites, remove members, and create or revoke share links.",
  },
  "account:read": {
    title: "Read your account",
    description: "See who you are and what plan you hold.",
  },
});

/**
 * Every way a `v1` request can fail, as a wire code.
 *
 * **An enum rather than free strings, so a route cannot invent one.** The
 * wrapper owns the envelope (Decision 10) and every code below is emitted by the
 * wrapper itself, not by a handler — which is what keeps the set small and
 * keeps a caller's error handling from breaking when an endpoint is added.
 *
 * Kebab-case, matching the one wire code that already exists
 * (`ai-not-entitled`, `modelSelection.ts:181`).
 *
 * **`token-expired` and `token-revoked` are two codes for one HTTP status, on
 * purpose** (Decision 13). Both are 401, and an integrator reading the response
 * has to be able to tell "mint a new one" from "you were cut off" — a single
 * `unauthenticated` makes a scheduled expiry look like a security incident.
 *
 * **`insufficient-scope` names the scope it wanted.** That leaks nothing a
 * caller does not already know about its own token, and it saves a support round
 * trip.
 *
 * **`not-entitled` is 402**, matching `AI_NOT_ENTITLED_STATUS` rather than
 * inventing a second shape for the same idea. It is the answer both when a
 * `free` or `plus` account tries to mint a token and when a lapsed account tries
 * to use one — a lapse disables tokens without revoking them (Decision 12), so
 * the code says "your plan", not "your token".
 */
export const ApiErrorCode = z.enum([
  /** 400 — the request did not parse against the endpoint's declared schema. */
  "invalid-request",
  /** 401 — no credential, or one that does not resolve to an account. */
  "unauthenticated",
  /** 401 — the token was real and its `expiresAt` has passed. Mint a new one. */
  "token-expired",
  /** 401 — the token was real and someone revoked it. */
  "token-revoked",
  /** 402 — the owner's plan does not grant `api.tokens`. */
  "not-entitled",
  /** 403 — the token does not hold the scope this endpoint declares. */
  "insufficient-scope",
  /** 403 — the token is restricted to trips that do not include this one. */
  "trip-out-of-scope",
  /** 403 — the *account* lacks the role this endpoint declares on this trip. */
  "forbidden",
  /** 404 — no such resource, or one this account may not know exists. */
  "not-found",
  /**
   * 409 — the resource moved under the request. Retry with a fresh read.
   *
   * **The planning domain's own refusal, and the reason this code exists at
   * all.** `executeTripCommand` answers `concurrency-conflict` when an append
   * loses the optimistic-concurrency race, and every other route in the app has
   * mapped that to 409 since M1. `v1` mapped it to 400 and this enum had no
   * word for it, which told an integrator their request was malformed when what
   * it actually was, was early.
   */
  "conflict",
  /** 429 — rate limited. Carries `Retry-After`. */
  "rate-limited",
  /** 500 — ours, and unexplained. */
  "server-error",
  /** 503 — a dependency we fail closed on, including the rate-limit counter store. */
  "service-unavailable",
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCode>;

/**
 * The one error envelope every `v1` route returns.
 *
 * Today's BFF routes return `{ error: "unauthenticated" }` as a bare string,
 * inconsistently. **That is not migrated and this does not replace it** — the
 * frontend routes keep what they have, and this is the shape `v1` commits to.
 *
 * `details` is for the machine-readable half of a validation failure (which
 * field, what was wrong). It is `unknown` rather than a shape because the only
 * producer is the wrapper's own zod error formatting, and pinning that here
 * would freeze zod's error shape into our public contract.
 */
export const ApiError = z.object({
  error: z.object({
    code: ApiErrorCode,
    /** Plain English, safe to show a developer. Never a stack, never SQL. */
    message: z.string().min(1),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

/**
 * The `tc_` prefix every token secret carries.
 *
 * **Greppability is the whole reason it exists**: GitHub's secret scanning
 * matches on a known prefix, and a human reading a log can tell what they are
 * looking at. It is not a namespace and nothing parses it.
 */
export const API_TOKEN_PREFIX = "tc_";

/**
 * How many leading characters of a secret are stored and shown (`tc_7Fq2xR9a…`).
 *
 * Display only. Long enough to tell two tokens apart in a list, far too short to
 * narrow a 256-bit secret.
 */
export const API_TOKEN_PREFIX_LENGTH = 8;

/**
 * The longest life a token may be given, in days (Decision 13).
 *
 * **Mandatory expiry, and "never" is not offerable.** Mitchell, 2026-09-16:
 * *"yes mandatory token expiration, but lets pick a reasonable max, 1 year
 * long?"* One year is a defensible ceiling rather than an arbitrary one —
 * GitHub's fine-grained personal access tokens cap at 366 days for the same
 * reason: an unbounded credential is one whose blast radius only ever grows.
 *
 * **A longer request is a 400, never a silent clamp.** Quietly shortening a
 * lifetime someone asked for is how an integration dies on a date nobody chose.
 */
export const API_TOKEN_MAX_LIFETIME_DAYS = 365;

/** The lifetime offered by default — the length most integrations actually need. */
export const API_TOKEN_DEFAULT_LIFETIME_DAYS = 90;

/**
 * The owner's view of a token they hold. **Never the secret.**
 *
 * The secret is returned exactly once, by the creation call, and is not stored
 * in a form anything can return again (Decision 6) — `sha256` at rest, and this
 * DTO is why that costs nothing: no screen needs the plaintext back.
 *
 * **This breaks with the invite/share precedent deliberately.** `TripShare`
 * carries its `token` in plain text and the schema says exactly why — *"because
 * the owner's invite list has to be able to re-show a link they already handed
 * out."* That justification does not transfer: an API token is shown once and
 * never again, which is what a user expects and what every comparable product
 * does.
 *
 * **No entitlement field, and there must never be one.** Whether the owner may
 * use this token is resolved per request from the database — never cached here
 * and never read from a JWT — because a downgrade must bite before a token
 * refreshes, and a token lives for months (M20's third rule, Decision 12).
 *
 * **No `expired` or `expiresIn` boolean either.** `expiresAt` and `revokedAt`
 * are the facts; "expires in 12 days" and "expired" are renderings of them
 * against the reader's own clock. A server-computed boolean would be stale the
 * moment it was serialised.
 */
export const ApiToken = z.object({
  tokenId: z.string().uuid(),
  /** What the user called it. */
  name: z.string().min(1),
  /** The first `API_TOKEN_PREFIX_LENGTH` characters, for the list. Display only. */
  prefix: z.string().min(1),
  /**
   * What this token may do — a set, stored as an array and never ordered.
   *
   * Parsed through `ApiScope` on the way out of the database, because a `text[]`
   * column is not a guarantee.
   *
   * **No `.min(1)` here, unlike `ApiTokenCreateInput`, and the asymmetry is the
   * point.** Minting a scopeless token is refused; *listing* one is not. If a
   * row ever ends up with no scopes — a bad migration, someone's SQL — the
   * owner needs to see it in order to revoke it, and a read schema that refuses
   * to parse it would hide the one token they most need to find.
   */
  scopes: z.array(ApiScope),
  /**
   * The trips this token is confined to, or `null` for account-wide.
   *
   * **`null` follows membership live** — every trip the owner can reach,
   * including ones created later. A list is exactly those trips, and only while
   * the owner still holds the role the endpoint demands, because the role check
   * is the unchanged one that already runs for a session.
   */
  tripIds: z.array(z.string().uuid()).nullable(),
  createdAt: z.string(),
  /**
   * When this token was last accepted, coarse to five minutes (Decision 7).
   *
   * **Deliberately imprecise.** Writing a row on every authenticated read is a
   * write on a read path; the only question anyone asks of this field is "was
   * this used today", and five-minute precision answers it. `null` until first
   * use.
   */
  lastUsedAt: z.string().nullable(),
  /** Mandatory, and at most `API_TOKEN_MAX_LIFETIME_DAYS` after creation. */
  expiresAt: z.string(),
  /**
   * When someone revoked it, or `null`.
   *
   * **Expiry and revocation are resolved on read and never swept** — the
   * `entitlement_grants` rule. An expired token is refused, not deleted, so its
   * row stays listable and a user can see what lapsed and why.
   */
  revokedAt: z.string().nullable(),
});
export type ApiToken = z.infer<typeof ApiToken>;

/**
 * The one and only response that carries a token's secret.
 *
 * A separate type from `ApiToken` rather than an optional field on it, because
 * an optional secret is one a list endpoint can forget not to fill in. A shape
 * that only the creation path can construct cannot leak from the read path.
 */
export const ApiTokenCreated = z.object({
  token: ApiToken,
  /**
   * `tc_<base64url(32 random bytes)>`. **Shown once, stored nowhere.**
   *
   * The only copy that will ever exist is the one in this response body.
   */
  secret: z.string().min(1),
});
export type ApiTokenCreated = z.infer<typeof ApiTokenCreated>;

/**
 * What a person fills in to mint a token.
 *
 * **`expiresInDays` is required, because expiry is** (Decision 13). Optional
 * with a default would let "forever" be chosen by an omitted field, which is the
 * same reasoning that made `AdminGrantInput.expiresAt` nullable rather than
 * optional — except that here there is no "forever" to choose at all.
 *
 * **`tripIds` is nullable rather than optional** for the same reason: confining
 * a token to two trips and forgetting to confine it are different intentions,
 * and an absent field would express both.
 */
export const ApiTokenCreateInput = z.object({
  name: z.string().min(1).max(100).refine(
    (name) => name.trim().length > 0,
    "Give the token a name — a blank one is indistinguishable from every other in the list.",
  ),
  /**
   * At least one scope. A token with none is a credential that can do nothing,
   * which is not a safe default but a mistake wearing one.
   */
  scopes: z.array(ApiScope).min(1),
  /** `null` for account-wide; a non-empty list to confine it to those trips. */
  tripIds: z.array(z.string().uuid()).min(1).nullable(),
  expiresInDays: z
    .number()
    .int()
    .min(1)
    .max(
      API_TOKEN_MAX_LIFETIME_DAYS,
      `A token may live at most ${API_TOKEN_MAX_LIFETIME_DAYS} days. Ask for fewer, or mint a new one when this expires.`,
    ),
});
export type ApiTokenCreateInput = z.infer<typeof ApiTokenCreateInput>;

/**
 * What happened to a stop's location on a v1 write, sent as the
 * `Geocode-Outcome` response header whenever the body carried a `location`.
 *
 * A header rather than a body field so `TripDetail`, the published response,
 * does not change shape. The body also shows the result directly:
 * `location.lat` is absent when nothing resolved.
 */
export const GeocodeOutcome = z.enum([
  "provided",        // the caller sent lat/lng; nothing was looked up
  "address",         // coordinates came from geocoding `location.address`
  "name",            // coordinates came from geocoding `location.name`
  "no-match",        // looked up, vendor found nothing; saved without coordinates
  "quota-exhausted", // the owner's daily geocode allowance is spent; saved without coordinates
  "unavailable",     // geocoder unconfigured, erroring, or quota store down; saved without coordinates
]);
export type GeocodeOutcome = z.infer<typeof GeocodeOutcome>;
export const GEOCODE_OUTCOME_HEADER = "Geocode-Outcome";

/** `GET /v1/trips/{tripId}/geocode` — each result is a `Location` a caller can send back as a stop's `location` unchanged. */
export const GeocodeCandidates = z.object({ results: z.array(Location) });
export type GeocodeCandidates = z.infer<typeof GeocodeCandidates>;
