"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  API_SCOPES,
  API_TOKEN_DEFAULT_LIFETIME_DAYS,
  API_TOKEN_MAX_LIFETIME_DAYS,
  SCOPE_CATALOGUE,
  type ApiScope,
  type ApiToken,
  type ApiTokenCreated,
} from "@tc/contracts";
import type { TripSummary } from "@tc/contracts";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Button, buttonVariants } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/cn";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { fetchTrips } from "@/lib/apiClient";
import type { AccountPlanState } from "@/lib/accountPlan";

// **The Tokens section in Account settings** (M22 Phase 3).
//
// A section and not a route, following `PlanSection` — this is a thing you hold
// rather than a thing you compare, and it belongs where the rest of what you
// hold already lives.
//
// **Everything here talks to `/api/account/tokens`, which is session-only.** A
// token that could mint or revoke tokens could grant itself scopes its owner
// never approved and outlive its own revocation. Managing credentials is a
// signed-in act and no scope names this surface.
//
// **Three obligations mandatory expiry puts on this screen** (Decision 13), and
// they are cheap only because they were designed in rather than discovered at
// the first outage:
//
//   1. **Time remaining, not a creation date.** "Expires in 12 days" is the only
//      form of this anyone acts on.
//   2. **Expired reads differently from revoked.** Both are dead; one is a
//      schedule and the other is a decision, and a person looking at the list is
//      reading for exactly that difference.
//   3. **Rotation is two actions, not a feature.** Create the replacement, then
//      revoke the old one. Saying so here is what stops it being assumed.

/** "in 12 days" / "today" / "3 days ago" — the only form of a deadline anyone acts on. */
export function relativeDays(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  // Whole days, floored toward the past, so a token with 23 hours left reads
  // "tomorrow" rather than "today" — rounding a deadline toward *more* time is
  // the direction that gets somebody caught out.
  const days = Math.floor((then - now.getTime()) / (24 * 60 * 60 * 1000));
  if (days < -1) return `${Math.abs(days)} days ago`;
  if (days === -1) return "yesterday";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

/** Live, expired or revoked — resolved on read here exactly as the server does. */
export function tokenState(token: ApiToken, now: Date = new Date()): "live" | "expired" | "revoked" {
  if (token.revokedAt !== null) return "revoked";
  return new Date(token.expiresAt).getTime() <= now.getTime() ? "expired" : "live";
}

/**
 * **30 days / 90 days / a year**, not a number field (§34.1).
 *
 * The third is `API_TOKEN_MAX_LIFETIME_DAYS` rather than a literal 365, so the
 * ceiling has exactly one definition; the copy beside the control states it
 * rather than letting the reader discover it from a refusal.
 */
const LIFETIMES = [
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
  { value: API_TOKEN_MAX_LIFETIME_DAYS, label: "A year" },
] as const;
type LifetimeDays = (typeof LIFETIMES)[number]["value"];

/**
 * The contract's default, snapped to the nearest offered lifetime.
 *
 * Reading it from the contract rather than writing `90` keeps one source for
 * the number. Snapping rather than asserting equality means lowering
 * `API_TOKEN_DEFAULT_LIFETIME_DAYS` to something not on this list changes which
 * chip starts selected instead of breaking the build over a cosmetic default.
 */
const DEFAULT_LIFETIME: LifetimeDays = [...LIFETIMES].sort(
  (a, b) =>
    Math.abs(a.value - API_TOKEN_DEFAULT_LIFETIME_DAYS) -
    Math.abs(b.value - API_TOKEN_DEFAULT_LIFETIME_DAYS),
)[0]!.value;

/** Under a week reads in `--color-warning-ink` (§34.1, obligation 1). */
export function expiresSoon(token: ApiToken, now: Date = new Date()): boolean {
  const left = new Date(token.expiresAt).getTime() - now.getTime();
  return left > 0 && left < 7 * 24 * 60 * 60 * 1000;
}

/**
 * *"Read and change your trips · 2 trips"* — the one line of what a token may
 * do and how far it reaches.
 *
 * Joined with ` · ` rather than `, ` because the two halves are different
 * facts, not a list; and pluralised, because `1 trip(s)` is the defect class
 * `KI-048` already records as `1 travellers`.
 */
export function reachLine(token: ApiToken): string {
  const what =
    token.scopes.length === 0
      ? "No permissions — this token can do nothing"
      : token.scopes.map((scope) => SCOPE_CATALOGUE[scope].title).join(", ");
  const where =
    token.tripIds === null
      ? "all trips"
      : token.tripIds.length === 1
        ? "1 trip"
        : `${token.tripIds.length} trips`;
  return `${what} · ${where}`;
}

const STATE_LABEL = { live: "Active", expired: "Expired", revoked: "Revoked" } as const;
const STATE_BADGE = { live: "success", expired: "warning", revoked: "neutral" } as const;

// **This took an `onNavigate` prop until M26 link 1, and it is gone** — it
// existed only to close the account Sheet behind a navigation to `/plans`.
// Account is a route now (§34.4), so there is no container to close.
export function TokensSection() {
  const [tokens, setTokens] = useState<ApiToken[] | null>(null);
  const [entitled, setEntitled] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  // **A choice of three, not a number field** (§34.1). The raw field made the
  // reader do arithmetic to express "about a year" and then defended itself
  // with a validator; three named lifetimes say the same thing and cannot be
  // wrong. `API_TOKEN_DEFAULT_LIFETIME_DAYS` still picks the default, so the
  // contract stays the source of that number rather than this list.
  const [days, setDays] = useState<LifetimeDays>(DEFAULT_LIFETIME);
  // **Which trips** (§34.1, DRIFT D12). `trip_ids` has been real and enforced
  // end to end since M22 — `publicApi.ts`, `api-tokens/index.ts`, `actor.ts`
  // and the route's own widening refusal — and this UI posted `null` regardless.
  // Nothing on the server changes for this; the gap was one hardcoded value and
  // a control above it.
  const [tripScope, setTripScope] = useState<"all" | "chosen">("all");
  const [tripIds, setTripIds] = useState<string[]>([]);
  const [trips, setTrips] = useState<TripSummary[] | null>(null);
  const [tripsFailed, setTripsFailed] = useState(false);
  const [billingState, setBillingState] = useState<AccountPlanState | null>(null);
  const [scopes, setScopes] = useState<ApiScope[]>(["trips:read"]);
  const [revealed, setRevealed] = useState<ApiTokenCreated | null>(null);
  // **Keyed on the REVEAL, not a boolean and not the secret's text.** The
  // clipboard write is async, so a slow one can resolve after the person has
  // dismissed the reveal and minted a second token — and a bare
  // `setCopied(true)` then labelled that new secret as copied while the
  // clipboard held the old one. They navigate away trusting it.
  //
  // Identity rather than value: two reveals are different objects even when
  // their fields match, so this cannot be fooled by a repeated secret the way
  // comparing the text can. Dismissing clears the label for free, because
  // `revealed` becomes null and nothing equals it.
  const [copiedFor, setCopiedFor] = useState<ApiTokenCreated | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void Promise.all([
      // eslint-disable-next-line no-restricted-globals -- an app API call with no client helper yet; moves onto the client with the collapse still open in KI-2026-09-05-q
      fetch("/api/account/tokens").then((res) => (res.ok ? res.json() : null)),
      // eslint-disable-next-line no-restricted-globals -- an app API call with no client helper yet; moves onto the client with the collapse still open in KI-2026-09-05-q
      fetch("/api/account/plan").then((res) => (res.ok ? res.json() : null)),
    ])
      .then(([tokenBody, planBody]) => {
        if (!live) return;
        if (tokenBody === null || planBody === null) {
          setFailed(true);
          return;
        }
        setTokens((tokenBody as { tokens: ApiToken[] }).tokens);
        const plan = (
          planBody as { plan: { entitlements: readonly string[]; billing?: { state: AccountPlanState } } }
        ).plan;
        setEntitled(plan.entitlements.includes("api.tokens"));
        // **Already on the wire and unused until now** (`accountPlan.ts`). A
        // lapsed account is not the same as one that never subscribed, and the
        // gate copy said the same sentence to both.
        //
        // **Read defensively, and that is not defensive programming for its own
        // sake.** The first cut read `plan.billing.state` outright; a plan body
        // without `billing` threw inside this `.then`, hit the `.catch` below,
        // and rendered "your API tokens could not be loaded" — the entire
        // section lost to a field that only changes one sentence of copy. The
        // token list is the thing this screen is for; a missing nicety must not
        // take it down.
        setBillingState(plan.billing?.state ?? null);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  // **The lifetime validator is gone with the field it defended.** It existed
  // because a free-text number could be empty, fractional or 400 — and the
  // three choices below are none of those by construction. `LIFETIMES` is
  // asserted against the contract's ceiling at module scope, so a lowered
  // ceiling is a build error rather than a 400 somebody meets at runtime.
  //
  // **Chosen trips with nothing chosen is the one state that can still be
  // wrong**, and it is refused here rather than sent: a token scoped to no
  // trips can do nothing at all, which nobody means to create.
  const scopedToNothing = tripScope === "chosen" && tripIds.length === 0;

  async function create() {
    setBusy(true);
    setError(null);
    try {
      // eslint-disable-next-line no-restricted-globals -- an app API call with no client helper yet; moves onto the client with the collapse still open in KI-2026-09-05-q
      const res = await fetch("/api/account/tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          scopes,
          // Was hardcoded `null` — the whole of DRIFT D12 (§34.1: *"Which trips
          // is the one thing the design asks the build for"*).
          tripIds: tripScope === "all" ? null : tripIds,
          expiresInDays: days,
        }),
      });
      if (!res.ok) {
        // **Three answers, because they need three different actions** — and
        // the first version of this had two, so a server that could not mint at
        // all told the person to check their own typing. An e2e walk found it:
        // the deployment was missing `API_TOKEN_PEPPER`, the route threw, and
        // the screen said "check the name and the number of days".
        setError(
          res.status === 402
            ? "API tokens are on the Premium plan."
            : res.status >= 500
              ? "Tokens are not available on this deployment just now. This is our side, not yours."
              : "That token could not be created. Check the name and the number of days.",
        );
        return;
      }
      const created = (await res.json()) as ApiTokenCreated;
      // **Shown once, and the list updates in the same breath.** There is no
      // second chance to reveal this: nothing stores the secret, so if this
      // component loses it the person has to mint another.
      setRevealed(created);
      setTokens((current) => (current === null ? [created.token] : [created.token, ...current]));
      setCreating(false);
      setName("");
      setScopes(["trips:read"]);
      setDays(DEFAULT_LIFETIME);
      setTripScope("all");
      setTripIds([]);
    } catch {
      setError("That token could not be created.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * The caller's trips, fetched the first time somebody asks to scope a token
   * to some of them.
   *
   * Lazy on purpose: every account that opens this tab would otherwise pay for
   * a trip list that only the minority using Chosen trips ever sees.
   */
  async function loadTrips() {
    if (trips !== null) return;
    const result = await fetchTrips();
    if (result.ok) {
      // **Clear the failure before storing the trips.** `trips` stays null on a
      // failed fetch, so the `trips !== null` guard above lets a later attempt
      // through — but `tripsFailed` was never reset, and the failure branch in
      // the render takes precedence over having trips. A recovered fetch would
      // sit behind "could not be loaded" until the component remounted
      // (CodeRabbit, PR 196).
      setTripsFailed(false);
      setTrips(result.value);
    } else {
      setTripsFailed(true);
    }
  }

  async function revoke(tokenId: string) {
    // eslint-disable-next-line no-restricted-globals -- an app API call with no client helper yet; moves onto the client with the collapse still open in KI-2026-09-05-q
    const res = await fetch(`/api/account/tokens/${tokenId}`, { method: "DELETE" });
    if (!res.ok) {
      setError("That token could not be revoked.");
      return;
    }
    const body = (await res.json()) as { token: ApiToken };
    setTokens((current) =>
      current === null ? current : current.map((t) => (t.tokenId === tokenId ? body.token : t)),
    );
  }

  if (failed) {
    return (
      <Text variant="secondary" className="text-sm">
        Your API tokens could not be loaded just now.
      </Text>
    );
  }
  if (tokens === null || entitled === null) return null;

  return (
    // No `<Heading>API tokens</Heading>` and no `aria-labelledby` here: the
    // `← Profile` / H3 pair and the region they label are `AccountScreen`'s
    // (§35.4), drawn before this fetches — and one heading, not two (project
    // rule 4).
    <section className="flex flex-col gap-3" data-testid="tokens-section">
      {/* **All three clauses** (§34.1). The third — *"it can never do more than
          you can"* — is the build's second gate stated in plain words, and it
          is true of this build: `route.ts` re-checks membership on every call,
          so removing somebody removes their tokens' access in the same instant.
          It was the one clause missing, and it is the one that answers the
          question a reader actually has. */}
      <Text variant="secondary" className="text-xs">
        A token lets a program you write read and change your trips. Treat one like a password: it
        is shown once, it always expires, and it can never do more than you can.
      </Text>

      {/* **What a free or plus account sees instead — a prompt, not a hidden
          section.** Hiding it would answer "this product has no API"; showing
          it locked answers "not on this plan", which is the true and the
          actionable answer. */}
      {!entitled ? (
        <Banner variant="info" data-testid="tokens-upgrade">
          {/* **Both halves of the split, named here rather than discovered in a
              support conversation** (§34.1): tokens are Premium, and taking your
              trips with you is not. Somebody reading "not on this plan" next to
              their own data reasonably fears the second, and the answer is one
              clause long.

              **And the lapsed variant.** `billing.state` has been on the wire
              since M21 (`accountPlan.ts`) and nothing read it, so an account
              whose subscription ended was told it had never had the feature.
              "Subscribe" and "restart" are different acts and different
              sentences. */}
          {billingState === "lapsed"
            ? "Your subscription has ended, so your API tokens stopped working. Restarting it turns them back on — nothing was deleted."
            : "API tokens are on the Premium plan. Downloading a trip as a file is not — that is on every plan, from Trip settings."}{" "}
          <Link
            href="/plans"
            className={buttonVariants({ variant: "secondary", size: "sm" })}
            data-testid="tokens-upgrade-link"
          >
            {billingState === "lapsed" ? "Restart it" : "See plans"}
          </Link>
        </Banner>
      ) : null}

      {/* **The one-time reveal.** Deliberately a `readOnly` input rather than a
          `<code>` block: a person needs to select it, and on a phone the only
          reliable way to select text is a field. */}
      {revealed !== null ? (
        <Banner variant="success" data-testid="token-revealed">
          <div className="flex flex-col gap-2">
            <Text as="span" className="text-sm font-semibold">
              Copy this now — it is not shown again.
            </Text>
            <Input
              readOnly
              value={revealed.secret}
              aria-label="Your new API token"
              data-testid="token-secret"
              onFocus={(e) => e.currentTarget.select()}
            />
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                data-testid="token-copy"
                onClick={() => {
                  // **"Copied" is a claim, and this secret is shown once.** A
                  // browser with no clipboard API, or one that refuses the
                  // write over http or without a user gesture, left the button
                  // saying Copied over an empty clipboard — and the only copy
                  // of the token is the one on screen the person is about to
                  // navigate away from. The field beside this button is
                  // selectable for exactly that fallback, so the honest failure
                  // is to say so.
                  void (async () => {
                    try {
                      const copying = revealed;
                      await navigator.clipboard.writeText(copying.secret);
                      setCopiedFor(copying);
                    } catch {
                      setError("This browser would not let us copy. Select the token and copy it.");
                    }
                  })();
                }}
              >
                {copiedFor === revealed ? "Copied" : "Copy"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                data-testid="token-reveal-dismiss"
                onClick={() => {
                  setRevealed(null);
                  setCopiedFor(null);
                }}
              >
                Done
              </Button>
            </div>
          </div>
        </Banner>
      ) : null}

      {error !== null ? (
        <Banner variant="danger" data-testid="tokens-error">
          {error}
        </Banner>
      ) : null}

      {tokens.length === 0 ? (
        <Text variant="secondary" className="text-sm" data-testid="tokens-empty">
          You have no tokens yet.
        </Text>
      ) : (
        /* **A list of like things is a table** (§34.5). Every token carries the
            same four facts and the question asked of the list is comparative —
            which one dies first, which one is the wide one. The stack of
            per-row hairline boxes this replaced was a hairline card on a
            hairline card on paper, and that nesting is what made a row hard to
            separate from the background.

            One filled card with `shadow-raised` so the list reads as a single
            object against the paper page, and `overflow-hidden` so the moss
            header takes the card's own corners. */
        <div
          className="overflow-hidden rounded-lg border border-hairline bg-surface shadow-raised"
          data-testid="tokens-list"
        >
          <Table>
            <THead>
              <TR className="bg-moss">
                <TH className="px-3.5 py-3">Token</TH>
                <TH className="px-3.5 py-3">What it may do</TH>
                <TH className="px-3.5 py-3">Expires</TH>
                {/* The column exists for every row's sake; naming it for a
                    screen reader while leaving the header visually empty keeps
                    the head from reading "Revoke" over rows that offer none. */}
                <TH className="px-3.5 py-3 text-right">
                  <span className="sr-only">Actions</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {tokens.map((token) => {
                const state = tokenState(token);
                const soon = state === "live" && expiresSoon(token);
                return (
                  <TR key={token.tokenId} className="last:border-b-0" data-testid={`token-${token.tokenId}`}>
                    <TD className="px-3.5 py-3 align-middle">
                      <div className="flex flex-wrap items-center gap-2">
                        <Text as="span" className="text-sm font-semibold text-ink">
                          {token.name}
                        </Text>
                        <Badge variant={STATE_BADGE[state]} data-testid="token-state">
                          {STATE_LABEL[state]}
                        </Badge>
                      </div>
                      <Text as="span" variant="secondary" className="block font-mono text-xs">
                        {token.prefix}…
                      </Text>
                    </TD>
                    <TD className="px-3.5 py-3 align-middle">
                      <Text as="span" variant="secondary" className="text-xs text-pretty">
                        {reachLine(token)}
                      </Text>
                    </TD>
                    <TD className="px-3.5 py-3 align-middle">
                      {/* Obligations 1 and 2 together: time remaining while it is
                          alive — and under a week in `--color-warning-ink`, which
                          is the whole point of showing time remaining rather than
                          a date — and a dead token saying WHICH kind of dead. */}
                      <Text
                        as="span"
                        variant="secondary"
                        className={cn("text-xs text-pretty", soon && "font-semibold text-warning-ink")}
                        data-testid="token-expiry"
                      >
                        {state === "revoked"
                          ? "Revoked. It stopped working immediately."
                          : state === "expired"
                            ? `Expired ${relativeDays(token.expiresAt)}. Create a new one to replace it.`
                            : `Expires ${relativeDays(token.expiresAt)}.`}
                      </Text>
                    </TD>
                    <TD className="px-3.5 py-3 text-right align-middle">
                      {state === "live" ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          data-testid="token-revoke"
                          onClick={() => void revoke(token.tokenId)}
                        >
                          Revoke
                        </Button>
                      ) : null}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </div>
      )}

      {entitled && !creating ? (
        <div>
          <Button variant="secondary" size="sm" data-testid="token-new" onClick={() => setCreating(true)}>
            New token
          </Button>
        </div>
      ) : null}

      {entitled && creating ? (
        <div className="flex flex-col gap-4 rounded-lg border border-hairline bg-surface p-4" data-testid="token-form">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="token-name">Name</Label>
            <Input
              id="token-name"
              value={name}
              placeholder="Calendar sync"
              data-testid="token-name"
              onChange={(e) => setName(e.currentTarget.value)}
            />
          </div>

          <fieldset className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <legend className="text-sm font-medium text-ink">What it may do</legend>
              {/* **Two buttons rather than one that flips its label.** A single
                  toggle reading "Select all" until everything is on cannot clear
                  a partial selection in one click — you would have to select all
                  first. With eight scopes the common shape is "most of them", so
                  both directions are worth one click each.

                  `ghost`/`sm`, which is the lightest the design system offers:
                  these are adjuncts to the legend and must not out-weigh the
                  Create button below them. The first draft hand-rolled a
                  `<button>` with a link-ish class to get lighter still, and the
                  lint wall refused it — correctly. A control that looks like
                  nothing else in the app is a worse outcome than one that is
                  slightly heavier than I wanted. */}
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  data-testid="token-scopes-all"
                  disabled={scopes.length === API_SCOPES.length}
                  onClick={() => setScopes([...API_SCOPES])}
                >
                  Select all
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  data-testid="token-scopes-none"
                  disabled={scopes.length === 0}
                  onClick={() => setScopes([])}
                >
                  Select none
                </Button>
              </div>
            </div>
            {/* **Every scope, in the sentence somebody decided it needed.**
                `SCOPE_CATALOGUE` is exhaustive over `ApiScope`, so a ninth scope
                cannot compile until that sentence exists — which is why this
                list can be generated rather than hand-kept. */}
            {API_SCOPES.map((scope) => (
              <CheckboxField
                key={scope}
                checked={scopes.includes(scope)}
                title={SCOPE_CATALOGUE[scope].title}
                description={SCOPE_CATALOGUE[scope].description}
                data-testid={`token-scope-${scope}`}
                onCheckedChange={(checked) =>
                  setScopes((current) =>
                    checked ? [...current, scope] : current.filter((s) => s !== scope),
                  )
                }
              />
            ))}
          </fieldset>

          {/* **Which trips** (§34.1, DRIFT D12) — a two-way control, exactly as
              the design asks. The server side of this shipped with M22 and has
              been enforced end to end ever since; the UI posted `null`
              regardless, so the whole gap was this control and one value.

              **A `SegmentedControl` and not `ToggleChip`s**: this is one choice
              of two, which is a radiogroup. `ToggleChip` is `aria-pressed`
              multi-select and would say the wrong thing to a screen reader. */}
          <div className="flex flex-col gap-2">
            <Text as="span" className="text-sm font-medium text-ink">
              Which trips
            </Text>
            <div className="self-start">
              <SegmentedControl<"all" | "chosen">
                aria-label="Which trips"
                value={tripScope}
                options={[
                  { value: "all", label: "All trips" },
                  { value: "chosen", label: "Chosen trips" },
                ]}
                onValueChange={(next) => {
                  setTripScope(next);
                  if (next === "chosen") void loadTrips();
                }}
              />
            </div>
            {tripScope === "chosen" ? (
              <div className="flex flex-col gap-2" data-testid="token-trip-picker">
                {/* **Decision 5's rule is not something to implement — it is
                    something to STATE**, because the server already refuses the
                    widening a trip-scoped token would need
                    (`public-api/route.ts` answers `POST /v1/trips` with a
                    refusal). Saying it here is the difference between a rule
                    somebody meets as an error and one they understood before
                    they minted the token. */}
                <Text variant="secondary" className="text-xs text-pretty">
                  A token limited to trips cannot create one, and it will never see a trip added
                  after today unless you mint a new token.
                </Text>
                {/* While the list is in flight, nothing: the sentence above is
                    the picker's chrome and the chips are its data — never the
                    word `Loading…` (KI-2026-09-20-e). */}
                {tripsFailed ? (
                  <Text variant="secondary" className="text-xs" data-testid="token-trips-failed">
                    Your trips could not be loaded just now, so this token can only be scoped to all
                    of them.
                  </Text>
                ) : trips === null ? null : trips.length === 0 ? (
                  <Text variant="secondary" className="text-xs" data-testid="token-trips-empty">
                    You have no trips yet, so there is nothing to choose.
                  </Text>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {trips.map((trip) => (
                      <ToggleChip
                        key={trip.tripId}
                        pressed={tripIds.includes(trip.tripId)}
                        className="h-auto w-auto"
                        data-testid={`token-trip-${trip.tripId}`}
                        onClick={() =>
                          setTripIds((current) =>
                            current.includes(trip.tripId)
                              ? current.filter((id) => id !== trip.tripId)
                              : [...current, trip.tripId],
                          )
                        }
                      >
                        {trip.name}
                      </ToggleChip>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <Text as="span" className="text-sm font-medium text-ink">
              Expires after
            </Text>
            {/* **Three named lifetimes, not a number field** (§34.1). The field
                this replaces made the reader do arithmetic to say "about a
                year" and then defended itself with a validator against the
                inputs it had invited. */}
            <div className="self-start">
              <SegmentedControl<string>
                aria-label="Expires after"
                value={String(days)}
                options={LIFETIMES.map((l) => ({ value: String(l.value), label: l.label }))}
                onValueChange={(next) => setDays(Number(next) as LifetimeDays)}
              />
            </div>
            {/* **"Never" is not offered, and the ceiling is stated rather than
                enforced silently.** Now it cannot be met as a refusal at all —
                the longest choice IS the ceiling. */}
            <Text variant="secondary" className="text-xs text-pretty">
              Every token expires — at most {API_TOKEN_MAX_LIFETIME_DAYS} days. To rotate one,
              create its replacement and then revoke this one.
            </Text>
          </div>

          <div className="flex gap-2">
            <Button
              size="sm"
              data-testid="token-create"
              disabled={busy || name.trim() === "" || scopes.length === 0 || scopedToNothing}
              onClick={() => void create()}
            >
              {busy ? "Creating…" : "Create token"}
            </Button>
            <Button variant="ghost" size="sm" data-testid="token-cancel" onClick={() => setCreating(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
