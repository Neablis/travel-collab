"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { SCOPE_CATALOGUE, type ApiScope } from "@tc/contracts";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CheckboxField } from "@/components/ui/checkbox";
import { Heading } from "@/components/ui/heading";
import { PageContainer } from "@/components/ui/page-container";
import { Text } from "@/components/ui/text";

// **The consent page is the defence** (ADR-083 §6). Registration is open, so
// anyone can show a person this screen under any name. What it can say for
// certain is where access goes, so that is what it puts first:
//
// - the name only as the app's own claim, marked unverified, unless the code
//   goes to Claude's own callback (amendment F);
// - the redirect host large: the place the person is about to send access to;
// - for a client metadata document, the host that published it (amendment G);
// - for a loopback redirect, a warning that access goes to a program on this
//   computer, whoever it claims to be (amendment F; Claude Code included);
// - no logo, ever (amendment J): a logo is the cheapest thing to fake.
//
// Allow posts with `fetch` and then assigns `window.location`: a form POST that
// redirected to another origin would be blocked by the CSP's `form-action 'self'`.

/** How the server marked this client (`server/oauth/recognised.ts`). */
export type ConsentMarking = "recognised" | "localhost-warning" | "unverified";

export interface ConsentScreenProps {
  clientName: string;
  marking: ConsentMarking;
  /** The host the code goes to, port included for a loopback redirect. */
  redirectHost: string;
  /** The host of the client's metadata document, for a CIMD client. */
  cimdHost: string | null;
  /** What the app asked for. */
  scopes: readonly ApiScope[];
  /** Whether this account may connect apps (`api.tokens`). */
  entitled: boolean;
  /** The authorize request, posted back so the server checks it again. */
  params: Readonly<Record<string, string>>;
}

/**
 * Reading is ticked and every write is an opt-in (Mitchell, 2026-10-28): a
 * phished grant that can only read does no lasting harm.
 */
const isRead = (scope: ApiScope) => scope.endsWith(":read");

/** The two sections, each with its own Select all and Clear all. */
const SECTIONS = [
  { title: "Read", kind: "read", holds: isRead },
  { title: "Write", kind: "write", holds: (scope: ApiScope) => !isRead(scope) },
] as const;

/** The consent screen: where access goes, what the app asked for, and Allow or Deny posted back for the server to check again. */
export function ConsentScreen({
  clientName,
  marking,
  redirectHost,
  cimdHost,
  scopes,
  entitled,
  params,
}: ConsentScreenProps) {
  const [chosen, setChosen] = useState<ApiScope[]>(() => scopes.filter(isRead));
  const sectionId = useId();
  const noneHintId = useId();
  const noneChosen = chosen.length === 0;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: "allow" | "deny") {
    setBusy(true);
    setError(null);
    try {
      // eslint-disable-next-line no-restricted-globals -- an app API call with no client helper yet; moves onto the client with the collapse still open in KI-2026-09-05-q
      const res = await fetch("/api/oauth/authorize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // The name too: the server refuses Allow if the app's name changed since this page showed it.
        body: JSON.stringify({ params, decision, scopes: chosen, clientName }),
      });
      const body = (await res.json().catch(() => null)) as { redirectTo?: unknown } | null;
      if (res.ok && typeof body?.redirectTo === "string") {
        // Stays busy: the page is leaving.
        window.location.assign(body.redirectTo);
        return;
      }
      setError("That did not go through. Reload the page and try again.");
    } catch {
      setError("Could not reach Caesura. Check your connection and try again.");
    }
    setBusy(false);
  }

  const recognised = marking === "recognised";
  return (
    <PageContainer width="measure" as="main" className="py-10">
      <Card className="flex flex-col gap-5 p-6">
        <div className="flex flex-col gap-2">
          <Heading level={1}>
            {recognised
              ? "Claude wants to connect to your Caesura account"
              : `An app calling itself "${clientName}" wants to connect to your Caesura account`}
          </Heading>
          {recognised ? (
            <Badge variant="success" className="self-start">
              Recognised: Claude
            </Badge>
          ) : (
            <Text variant="secondary">
              <Badge variant="warning">Unverified</Badge> Anyone can give an app this name. Check where access
              goes before you allow it.
            </Text>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <Text variant="secondary">Access goes to</Text>
          <Heading level={2} className="break-all">
            {redirectHost}
          </Heading>
          {cimdHost === null ? null : (
            <Text variant="secondary">
              This app is described by <span className="font-semibold text-ink">{cimdHost}</span>.
            </Text>
          )}
        </div>

        {marking === "localhost-warning" ? (
          <Banner variant="warning">
            Access goes to a program on this computer, not to a website. Continue only if you started this connection
            yourself, in an app you trust.
          </Banner>
        ) : null}

        {!entitled ? (
          <Banner variant="info">
            Connecting apps is on the Premium plan, with API tokens.{" "}
            <Link href="/plans" className={buttonVariants({ variant: "secondary", size: "sm" })}>
              See plans
            </Link>
          </Banner>
        ) : null}

        <fieldset className="flex flex-col gap-5" disabled={!entitled || busy}>
          <legend className="mb-2 text-sm font-semibold text-ink">It will be able to</legend>
          {SECTIONS.map(({ title, kind, holds }) => {
            const section = scopes.filter(holds);
            if (section.length === 0) return null;
            const others = (current: ApiScope[]) => current.filter((scope) => !holds(scope));
            return (
              // Named by its heading alone: a legend would fold the buttons' names into the group's.
              // An h3, under the redirect host's h2: the host stays the largest thing on the page (ADR-083 §6).
              <fieldset key={kind} className="flex flex-col gap-3" aria-labelledby={`${sectionId}-${kind}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Heading level={3} id={`${sectionId}-${kind}`}>
                    {title}
                  </Heading>
                  <span className="flex gap-2">
                    <Button
                      size="sm"
                      aria-label={`Select all ${kind} access`}
                      onClick={() => setChosen((current) => [...others(current), ...section])}
                    >
                      Select all
                    </Button>
                    <Button size="sm" aria-label={`Clear all ${kind} access`} onClick={() => setChosen(others)}>
                      Clear all
                    </Button>
                  </span>
                </div>
                {section.map((scope) => (
                  <CheckboxField
                    key={scope}
                    checked={chosen.includes(scope)}
                    title={SCOPE_CATALOGUE[scope].title}
                    description={SCOPE_CATALOGUE[scope].description}
                    onCheckedChange={(checked) =>
                      setChosen((current) => (checked ? [...current, scope] : current.filter((s) => s !== scope)))
                    }
                  />
                ))}
              </fieldset>
            );
          })}
        </fieldset>

        {error === null ? null : <Banner variant="danger">{error}</Banner>}

        <div className="flex flex-col gap-2">
          {/* Clear all makes an empty grant one press away, and a disabled Allow alone does not say why. */}
          {noneChosen ? (
            <Text variant="secondary" id={noneHintId}>
              Choose at least one thing this app may do.
            </Text>
          ) : null}
          <div className="flex gap-2">
            <Button
              variant="primary"
              disabled={!entitled || busy || noneChosen}
              aria-describedby={noneChosen ? noneHintId : undefined}
              onClick={() => void decide("allow")}
            >
              Allow
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => void decide("deny")}>
              Deny
            </Button>
          </div>
        </div>
      </Card>
    </PageContainer>
  );
}

/**
 * An app's error, once its redirect is proven, for an app that is not
 * recognised (ADR-083 amendment M). The link carries `error`, `state` and
 * `iss` as a redirect would; the person follows it or not.
 */
export function ConsentErrorBack({ description, redirectTo }: { description: string; redirectTo: string }) {
  return (
    <PageContainer width="measure" as="main" className="py-10">
      <Card className="flex flex-col gap-3 p-6">
        <Heading level={1}>This app&apos;s request was refused</Heading>
        <Text>Caesura could not connect the app that sent you here: {description}.</Text>
        <Text variant="secondary">Nothing was shared. You can close this page, or tell the app what went wrong.</Text>
        <a href={redirectTo} className={`${buttonVariants({ variant: "secondary", size: "sm" })} self-start`}>
          Return to {new URL(redirectTo).host}
        </a>
      </Card>
    </PageContainer>
  );
}

/** An authorize request we will not show consent for, and will not redirect: the app or its redirect is not proven. */
export function ConsentRefused({ description }: { description: string }) {
  return (
    <PageContainer width="measure" as="main" className="py-10">
      <Card className="flex flex-col gap-3 p-6">
        <Heading level={1}>This app cannot connect</Heading>
        <Text>Caesura could not check the app that sent you here: {description}.</Text>
        <Text variant="secondary">Nothing was shared. You can close this page.</Text>
      </Card>
    </PageContainer>
  );
}
