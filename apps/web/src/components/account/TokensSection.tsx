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
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Button, buttonVariants } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/checkbox";
import { Heading } from "@/components/ui/heading";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Text } from "@/components/ui/text";

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

const STATE_LABEL = { live: "Active", expired: "Expired", revoked: "Revoked" } as const;
const STATE_BADGE = { live: "success", expired: "warning", revoked: "neutral" } as const;

export function TokensSection({ onNavigate }: { onNavigate?: () => void }) {
  const [tokens, setTokens] = useState<ApiToken[] | null>(null);
  const [entitled, setEntitled] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [days, setDays] = useState(String(API_TOKEN_DEFAULT_LIFETIME_DAYS));
  const [scopes, setScopes] = useState<ApiScope[]>(["trips:read"]);
  const [revealed, setRevealed] = useState<ApiTokenCreated | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void Promise.all([
      fetch("/api/account/tokens").then((res) => (res.ok ? res.json() : null)),
      fetch("/api/account/plan").then((res) => (res.ok ? res.json() : null)),
    ])
      .then(([tokenBody, planBody]) => {
        if (!live) return;
        if (tokenBody === null || planBody === null) {
          setFailed(true);
          return;
        }
        setTokens((tokenBody as { tokens: ApiToken[] }).tokens);
        setEntitled(
          (planBody as { plan: { entitlements: readonly string[] } }).plan.entitlements.includes(
            "api.tokens",
          ),
        );
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  // **One rule, read by the button and by the handler.** `disabled` alone is a
  // claim about a button, not about the function behind it — and this screen's
  // own copy states the ceiling, so an empty, fractional or 400-day lifetime
  // reaching the server as a 400 would be the field wasting somebody's
  // afternoon exactly the way the note below it promises it will not.
  const lifetimeDays = Number(days);
  const lifetimeOk =
    days.trim() !== "" &&
    Number.isInteger(lifetimeDays) &&
    lifetimeDays >= 1 &&
    lifetimeDays <= API_TOKEN_MAX_LIFETIME_DAYS;

  async function create() {
    if (!lifetimeOk) {
      setError(`A token lasts between 1 and ${API_TOKEN_MAX_LIFETIME_DAYS} days.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/account/tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          scopes,
          tripIds: null,
          expiresInDays: lifetimeDays,
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
      setDays(String(API_TOKEN_DEFAULT_LIFETIME_DAYS));
    } catch {
      setError("That token could not be created.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(tokenId: string) {
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
    <section className="flex flex-col gap-3" aria-labelledby="tokens-heading" data-testid="tokens-section">
      <Heading level={3} id="tokens-heading">
        API tokens
      </Heading>
      <Text variant="secondary" className="text-xs">
        A token lets a program you write read and change your trips. Treat one like a password.
      </Text>

      {/* **What a free or plus account sees instead — a prompt, not a hidden
          section.** Hiding it would answer "this product has no API"; showing
          it locked answers "not on this plan", which is the true and the
          actionable answer. */}
      {!entitled ? (
        <Banner variant="info" data-testid="tokens-upgrade">
          API tokens are on the Premium plan.{" "}
          <Link
            href="/plans"
            className={buttonVariants({ variant: "secondary", size: "sm" })}
            data-testid="tokens-upgrade-link"
            onClick={onNavigate}
          >
            See plans
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
                      await navigator.clipboard.writeText(revealed.secret);
                      setCopied(true);
                    } catch {
                      setError("This browser would not let us copy. Select the token and copy it.");
                    }
                  })();
                }}
              >
                {copied ? "Copied" : "Copy"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                data-testid="token-reveal-dismiss"
                onClick={() => {
                  setRevealed(null);
                  setCopied(false);
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
        <ul className="flex flex-col gap-2" data-testid="tokens-list">
          {tokens.map((token) => {
            const state = tokenState(token);
            return (
              <li
                key={token.tokenId}
                className="flex flex-col gap-1 rounded-lg border border-hairline p-3"
                data-testid={`token-${token.tokenId}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Text as="span" className="text-sm font-semibold text-ink">
                    {token.name}
                  </Text>
                  <Badge variant={STATE_BADGE[state]} data-testid="token-state">
                    {STATE_LABEL[state]}
                  </Badge>
                  <Text as="span" variant="secondary" className="text-xs font-mono">
                    {token.prefix}…
                  </Text>
                </div>
                <Text variant="secondary" className="text-xs" data-testid="token-expiry">
                  {/* Obligation 1 and 2 together: time remaining while it is
                      alive, and a dead token says WHICH kind of dead it is. */}
                  {state === "revoked"
                    ? "Revoked. It stopped working immediately."
                    : state === "expired"
                      ? `Expired ${relativeDays(token.expiresAt)}. Create a new one to replace it.`
                      : `Expires ${relativeDays(token.expiresAt)}.`}
                </Text>
                <Text variant="secondary" className="text-xs">
                  {token.scopes.length === 0
                    ? "No permissions — this token can do nothing."
                    : token.scopes.map((scope) => SCOPE_CATALOGUE[scope].title).join(", ")}
                  {token.tripIds === null ? " · all trips" : ` · ${token.tripIds.length} trip(s)`}
                </Text>
                {state === "live" ? (
                  <div className="mt-1">
                    <Button
                      variant="secondary"
                      size="sm"
                      data-testid="token-revoke"
                      onClick={() => void revoke(token.tokenId)}
                    >
                      Revoke
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {entitled && !creating ? (
        <div>
          <Button variant="secondary" size="sm" data-testid="token-new" onClick={() => setCreating(true)}>
            New token
          </Button>
        </div>
      ) : null}

      {entitled && creating ? (
        <div className="flex flex-col gap-3 rounded-lg border border-hairline p-3" data-testid="token-form">
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
            <legend className="text-sm font-medium text-ink">What it may do</legend>
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

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="token-days">Expires after (days)</Label>
            <Input
              id="token-days"
              type="number"
              min={1}
              max={API_TOKEN_MAX_LIFETIME_DAYS}
              value={days}
              data-testid="token-days"
              onChange={(e) => setDays(e.currentTarget.value)}
            />
            {/* **"Never" is not offered, and the ceiling is stated rather than
                enforced silently.** A field that rejects 400 without having said
                what the limit was is a field that wastes somebody's afternoon. */}
            <Text variant="secondary" className="text-xs">
              Every token expires — at most {API_TOKEN_MAX_LIFETIME_DAYS} days. To rotate one,
              create its replacement and then revoke this one.
            </Text>
          </div>

          <div className="flex gap-2">
            <Button
              size="sm"
              data-testid="token-create"
              disabled={busy || name.trim() === "" || scopes.length === 0 || !lifetimeOk}
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
