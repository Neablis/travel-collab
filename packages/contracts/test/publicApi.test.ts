// The public API's vocabulary, and the three things it must never grow.
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  API_SCOPES,
  API_TOKEN_DEFAULT_LIFETIME_DAYS,
  API_TOKEN_MAX_LIFETIME_DAYS,
  API_TOKEN_PREFIX,
  API_TOKEN_PREFIX_LENGTH,
  ApiError,
  ApiErrorCode,
  ApiScope,
  ApiToken,
  ApiTokenCreateInput,
  ApiTokenCreated,
  SCOPE_CATALOGUE,
} from "../src/publicApi.ts";

const SOURCE = readFileSync(fileURLToPath(new URL("../src/publicApi.ts", import.meta.url)), "utf8");
// Same real parse as `entitlement.test.ts`, and for the same reason: a comment
// is a lexical construct, and three regex attempts at this in that file were
// each wrong in a different way. `getChildren`, not `forEachChild` — trivia
// hangs off TOKENS, which the latter never yields.
const CODE = (() => {
  const parsed = ts.createSourceFile("publicApi.ts", SOURCE, ts.ScriptTarget.Latest, true);
  const out = SOURCE.split("");
  const blank = (node: ts.Node): void => {
    for (const range of [
      ...(ts.getLeadingCommentRanges(SOURCE, node.getFullStart()) ?? []),
      ...(ts.getTrailingCommentRanges(SOURCE, node.getEnd()) ?? []),
    ]) {
      for (let i = range.pos; i < range.end && i < out.length; i += 1) {
        if (out[i] !== "\n") out[i] = " ";
      }
    }
    for (const child of node.getChildren(parsed)) blank(child);
  };
  blank(parsed);
  return out.join("");
})();

describe("ApiScope", () => {
  it("names the eight scopes, including the one plain language found", () => {
    // `sharing:write` is the eighth. The seven-scope draft let `trips:write`
    // create an invite — an ordinary table write against a trip — so a token
    // minted to sync an itinerary could have handed a stranger editor rights.
    expect(API_SCOPES).toEqual([
      "trips:read",
      "trips:write",
      "notebook:read",
      "notebook:write",
      "library:read",
      "library:write",
      "sharing:write",
      "account:read",
    ]);
  });

  it("refuses a scope outside the vocabulary", () => {
    expect(ApiScope.safeParse("trips:delete").success).toBe(false);
    // A typo must not parse. It would silently grant nothing, and the token
    // would look broken for reasons nobody can see.
    expect(ApiScope.safeParse("Trips:read").success).toBe(false);
    expect(ApiScope.safeParse("trips").success).toBe(false);
  });

  // **Three absences fixed by Mitchell at placement**, each load-bearing rather
  // than a TODO: no AI (a token may not spend model budget), no admin (that
  // surface keeps its 404-on-failure posture), no billing writes (they move
  // money and are session-only forever).
  it("names nothing for AI, admin or billing", () => {
    for (const scope of API_SCOPES) {
      expect(scope).not.toMatch(/^(ai|admin|billing)[:.]/);
    }
    // Names of the surfaces themselves, not any word that resembles one: the
    // first version of this line read `\bask\b` and matched "Ask for fewer"
    // in a lifetime-ceiling message, which is user copy and not an AI surface.
    expect(CODE).not.toMatch(/\bai\.\w|\/ask\b|\bapi\/admin\b/i);
    expect(CODE).not.toMatch(/\b(requireAdminApi|stripe|checkout|geocode)\b/i);
  });

  // **A scope is a set, not a rank** — the same refusal as `PlanId`, for the
  // same reason (ADR-045 rule 4). `trips:write` does not imply `trips:read`.
  // A comparison operator here forces every later scope to be a superset of an
  // earlier one, permanently and quietly.
  it("exports no ordering and defines none", () => {
    // Substring rather than `\b`-delimited, the lesson `entitlement.test.ts`
    // learned by breaking its own code: `SCOPE_RANK` has no word boundary
    // before `RANK`.
    expect(CODE).not.toMatch(/rank|atleast|implies|superset|scope_order|ordinal/i);
    expect(CODE).not.toMatch(/\bindexOf\b/);
  });

  // **The directory is the registry** (Decision 1). A route is public if and
  // only if its file is under `v1/`. A constant here listing routes would be a
  // second copy of what the file router already decides — the drift invariant 5
  // exists to stop.
  it("holds no route registry", () => {
    expect(CODE).not.toMatch(/\/v1\//);
    expect(CODE).not.toMatch(/\b(ROUTES|ENDPOINTS|PUBLIC_ROUTES|registry)\b/i);
  });
});

describe("SCOPE_CATALOGUE", () => {
  // The exhaustive `Record` is the mechanism: a ninth scope fails to COMPILE
  // until somebody writes the sentence a person reads when granting it. This
  // test covers what the type cannot — that the sentences are real sentences.
  it("describes every scope, in words a person could act on", () => {
    expect(Object.keys(SCOPE_CATALOGUE).sort()).toEqual([...API_SCOPES].sort());
    for (const scope of API_SCOPES) {
      const entry = SCOPE_CATALOGUE[scope];
      expect(entry.title.trim().length, scope).toBeGreaterThan(0);
      // Long enough to be a sentence rather than a restatement of the key.
      expect(entry.description.trim().length, scope).toBeGreaterThan(20);
      expect(entry.description.trim().endsWith("."), scope).toBe(true);
      expect(entry.description, scope).not.toContain(scope);
    }
  });

  it("cannot be edited at runtime", () => {
    expect(Object.isFrozen(SCOPE_CATALOGUE)).toBe(true);
  });
});

describe("ApiErrorCode", () => {
  // **Two codes for one status, on purpose** (Decision 13). Both 401, and an
  // integrator has to be able to tell "mint a new one" from "you were cut off"
  // — a single `unauthenticated` makes a scheduled expiry look like an
  // incident.
  it("tells an expired token from a revoked one", () => {
    expect(ApiErrorCode.safeParse("token-expired").success).toBe(true);
    expect(ApiErrorCode.safeParse("token-revoked").success).toBe(true);
    expect(ApiErrorCode.options).toContain("unauthenticated");
  });

  it("uses the kebab-case the one existing wire code already uses", () => {
    // `ai-not-entitled` (modelSelection.ts:181) is the precedent.
    for (const code of ApiErrorCode.options) {
      expect(code, code).toMatch(/^[a-z]+(-[a-z]+)*$/);
    }
  });

  it("refuses a code a handler invented", () => {
    expect(ApiErrorCode.safeParse("oops").success).toBe(false);
    expect(ApiErrorCode.safeParse("TOKEN_EXPIRED").success).toBe(false);
  });
});

describe("ApiError", () => {
  it("accepts the envelope every v1 route returns", () => {
    expect(ApiError.safeParse({ error: { code: "not-found", message: "No such trip." } }).success).toBe(true);
    expect(
      ApiError.safeParse({
        error: { code: "invalid-request", message: "Bad body.", details: { field: "name" } },
      }).success,
    ).toBe(true);
  });

  it("refuses a bare-string error, which is what the BFF returns today", () => {
    // Today's routes answer `{ error: "unauthenticated" }`. That shape is not
    // migrated and is not accepted here — v1 commits to the envelope.
    expect(ApiError.safeParse({ error: "unauthenticated" }).success).toBe(false);
    // A message is required: a code with no sentence is a support ticket.
    expect(ApiError.safeParse({ error: { code: "not-found" } }).success).toBe(false);
    expect(ApiError.safeParse({ error: { code: "not-found", message: "" } }).success).toBe(false);
  });
});

describe("ApiToken", () => {
  const token = {
    tokenId: "3f1a5b6c-7d8e-4f90-a1b2-c3d4e5f60718",
    name: "Calendar sync",
    prefix: "tc_7Fq2xR9a",
    scopes: ["trips:read"],
    tripIds: null,
    createdAt: "2026-09-16T10:00:00.000Z",
    lastUsedAt: null,
    expiresAt: "2026-12-15T10:00:00.000Z",
    revokedAt: null,
  };

  it("accepts an account-wide token and a trip-confined one", () => {
    expect(ApiToken.safeParse(token).success).toBe(true);
    expect(
      ApiToken.safeParse({ ...token, tripIds: ["3f1a5b6c-7d8e-4f90-a1b2-c3d4e5f60719"] }).success,
    ).toBe(true);
  });

  // **The secret is not in this shape and must never be.** It is returned once,
  // by `ApiTokenCreated`, and stored as a hash — which is what makes a token
  // list free of the thing worth stealing. `TripShare` carries its token in
  // plain text for a stated reason that does not transfer: nothing re-shows an
  // API token.
  it("carries no secret, in any spelling", () => {
    const parsed = ApiToken.parse({ ...token, secret: "tc_leaked", token: "tc_leaked" });
    expect(parsed).not.toHaveProperty("secret");
    expect(parsed).not.toHaveProperty("token");
    expect(CODE).not.toMatch(/\bplaintext\b/i);
  });

  // **No entitlement may be cached on a token** (M20's third rule, Decision 12).
  // Whether the owner may use it is resolved per request from the database, so
  // a downgrade bites before the token refreshes — and a token lives for months.
  it("carries no entitlement and no plan", () => {
    const parsed = ApiToken.parse({ ...token, entitlements: ["api.tokens"], planId: "premium" });
    expect(parsed).not.toHaveProperty("entitlements");
    expect(parsed).not.toHaveProperty("planId");
    expect(CODE).not.toMatch(/\b(entitlement|entitlements|planId|planVersion)\b/);
  });

  // `expiresAt` and `revokedAt` are the facts; "expires in 12 days" is a
  // rendering of one against the reader's clock. A server-computed boolean
  // would be stale the moment it was serialised.
  it("states the two timestamps rather than a derived verdict", () => {
    const parsed = ApiToken.parse({ ...token, expired: true, isActive: false });
    expect(parsed).not.toHaveProperty("expired");
    expect(parsed).not.toHaveProperty("isActive");
    expect(parsed.expiresAt).toBe(token.expiresAt);
    expect(parsed.revokedAt).toBeNull();
  });

  it("requires an expiry, because expiry is mandatory", () => {
    const { expiresAt: _dropped, ...withoutExpiry } = token;
    expect(ApiToken.safeParse(withoutExpiry).success).toBe(false);
    expect(ApiToken.safeParse({ ...token, expiresAt: null }).success).toBe(false);
  });
});

describe("ApiTokenCreated", () => {
  it("is the one shape that carries a secret", () => {
    const created = {
      token: {
        tokenId: "3f1a5b6c-7d8e-4f90-a1b2-c3d4e5f60718",
        name: "Calendar sync",
        prefix: "tc_7Fq2xR9a",
        scopes: ["trips:read"],
        tripIds: null,
        createdAt: "2026-09-16T10:00:00.000Z",
        lastUsedAt: null,
        expiresAt: "2026-12-15T10:00:00.000Z",
        revokedAt: null,
      },
      secret: "tc_dGhpcy1pcy1ub3QtYS1yZWFsLXNlY3JldA",
    };
    expect(ApiTokenCreated.safeParse(created).success).toBe(true);
    // A separate type rather than an optional field on `ApiToken`, because an
    // optional secret is one a list endpoint can forget not to fill in.
    const { secret: _dropped, ...withoutSecret } = created;
    expect(ApiTokenCreated.safeParse(withoutSecret).success).toBe(false);
  });
});

describe("ApiTokenCreateInput", () => {
  const input = { name: "Calendar sync", scopes: ["trips:read"], tripIds: null, expiresInDays: 90 };

  it("accepts a named, scoped, expiring token", () => {
    expect(ApiTokenCreateInput.safeParse(input).success).toBe(true);
    expect(
      ApiTokenCreateInput.safeParse({ ...input, tripIds: ["3f1a5b6c-7d8e-4f90-a1b2-c3d4e5f60718"] }).success,
    ).toBe(true);
  });

  // **A longer request is a 400, never a silent clamp.** Quietly shortening a
  // lifetime someone asked for is how an integration dies on a date nobody
  // chose.
  it("refuses a lifetime past the ceiling rather than clamping it", () => {
    expect(ApiTokenCreateInput.safeParse({ ...input, expiresInDays: API_TOKEN_MAX_LIFETIME_DAYS }).success).toBe(true);
    const over = ApiTokenCreateInput.safeParse({ ...input, expiresInDays: API_TOKEN_MAX_LIFETIME_DAYS + 1 });
    expect(over.success).toBe(false);
    // Not clamped to the maximum and accepted — refused.
    expect(over.success === false && over.error.issues[0]?.message).toContain(String(API_TOKEN_MAX_LIFETIME_DAYS));
  });

  // "Never expires" is not an option a user can choose (Decision 13). Optional
  // with a default would let "forever" be chosen by an omitted field.
  it("refuses a token with no expiry at all", () => {
    const { expiresInDays: _dropped, ...withoutExpiry } = input;
    expect(ApiTokenCreateInput.safeParse(withoutExpiry).success).toBe(false);
    expect(ApiTokenCreateInput.safeParse({ ...input, expiresInDays: null }).success).toBe(false);
    expect(ApiTokenCreateInput.safeParse({ ...input, expiresInDays: 0 }).success).toBe(false);
    expect(ApiTokenCreateInput.safeParse({ ...input, expiresInDays: 30.5 }).success).toBe(false);
  });

  // A credential that can do nothing is not a safe default, it is a mistake
  // wearing one — and the person who made it will not find out until it 403s.
  it("refuses a token with no scopes", () => {
    expect(ApiTokenCreateInput.safeParse({ ...input, scopes: [] }).success).toBe(false);
  });

  // An empty list and `null` are different intentions: "confine it to no trips"
  // is not a thing anyone means, while `null` is "every trip I can reach".
  it("refuses an empty trip list, which would mean nothing", () => {
    expect(ApiTokenCreateInput.safeParse({ ...input, tripIds: [] }).success).toBe(false);
    const { tripIds: _dropped, ...withoutTripIds } = input;
    expect(ApiTokenCreateInput.safeParse(withoutTripIds).success).toBe(false);
  });

  // Same reasoning as `AdminGrantInput.reason`: a blank name is
  // indistinguishable from every other in a list, six months later, when
  // someone is deciding which token to revoke.
  it("refuses a blank or whitespace-only name", () => {
    for (const name of ["", " ", "   ", "\t\n"]) {
      expect(ApiTokenCreateInput.safeParse({ ...input, name }).success, JSON.stringify(name)).toBe(false);
    }
  });
});

describe("the token format constants", () => {
  it("prefixes every secret with tc_, which is what makes it greppable", () => {
    // GitHub's secret scanning matches on a known prefix, and a human reading a
    // log can tell what they are looking at.
    expect(API_TOKEN_PREFIX).toBe("tc_");
    expect(API_TOKEN_PREFIX_LENGTH).toBeGreaterThan(API_TOKEN_PREFIX.length);
  });

  it("offers a default well inside the ceiling", () => {
    expect(API_TOKEN_MAX_LIFETIME_DAYS).toBe(365);
    expect(API_TOKEN_DEFAULT_LIFETIME_DAYS).toBeLessThan(API_TOKEN_MAX_LIFETIME_DAYS);
  });
});
