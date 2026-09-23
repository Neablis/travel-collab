"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { InviteLanding } from "@tc/contracts";
import { FrontDoorHeader } from "@/components/front/FrontDoorHeader";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Heading } from "@/components/ui/heading";
import { Text } from "@/components/ui/text";
import { fetchInviteLanding } from "@/lib/apiClient";
import { cn } from "@/lib/cn";
import { dayAccents, type AccentFamily } from "@/lib/dayAccent";
import { firstNameOf } from "@/lib/displayName";
import { addDaysIso } from "@/lib/dates";
import { formatRelativeInstant, formatTripDateWithYear } from "@/lib/formatDate";
import { takeInviteJoin } from "@/lib/pendingInviteJoin";
import { useInviteJoin } from "./useInviteJoin";

// The screen an invite link opens (M27 link 6, SPEC §35.6). It answers, before
// anything else: who asked, what the trip is, who is already in it, and what
// you will be able to do — for somebody who may have no account at all, which
// is why it lives in `(front)` and reads a public endpoint.
//
// Four states from the server (`valid`, `revoked`, `member`, `unavailable`),
// plus the two §35.10 owes that the design did not draw: the read failing
// (offline) and Join failing after sign-in. `expired` is not here — invites do
// not expire (M27 D9).

type ValidLanding = Extract<InviteLanding, { state: "valid" }>;

type Phase = { kind: "loading" } | { kind: "failed"; message: string } | { kind: "ready"; landing: InviteLanding };

/**
 * The invite landing: reads `GET /api/invites/:token` and draws the state it
 * answers, or a retry when the read itself failed.
 */
export function InviteLandingScreen({ token, googleAvailable }: { token: string; googleAvailable: boolean }) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });

  const load = useCallback(async () => {
    const result = await fetchInviteLanding(token);
    setPhase(result.ok ? { kind: "ready", landing: result.value } : { kind: "failed", message: result.error.message });
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const landing = phase.kind === "ready" ? phase.landing : null;

  return (
    <>
      <FrontDoorHeader
        actions={
          landing?.state === "valid" && !landing.signedIn ? (
            <Link
              href={`/signin?callbackUrl=${encodeURIComponent(`/invite/${encodeURIComponent(token)}`)}`}
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "no-underline")}
            >
              Sign in
            </Link>
          ) : undefined
        }
      />
      <main className="flex justify-center px-4 pb-14 pt-4 sm:px-7 sm:pt-8">
        {phase.kind === "loading" && <Text variant="secondary">Opening this invite…</Text>}
        {phase.kind === "failed" && (
          <Elsewhere
            eyebrow="Couldn't load"
            title="This invite didn't open"
            body="We couldn't reach Caesura to read it. Check your connection and try again — the link itself is fine."
            action={
              <Button variant="primary" size="touch" onClick={() => void load()}>
                Try again
              </Button>
            }
          />
        )}
        {landing?.state === "valid" && (
          <ValidInvite landing={landing} token={token} googleAvailable={googleAvailable} reload={load} />
        )}
        {landing?.state === "revoked" && (
          <Elsewhere
            eyebrow="Invite withdrawn"
            title="This invite was taken back"
            body="Nothing about you was shared. If you think it was a mistake, ask the person who sent it."
            action={<PrimaryLink href="/">Start your own trip</PrimaryLink>}
          />
        )}
        {landing?.state === "member" && (
          <Elsewhere
            eyebrow="Already joined"
            title="You're already on this trip"
            body="You're already a member, so there's nothing to join. Everything on it is where you left it."
            action={<PrimaryLink href={`/trips/${landing.tripId}`}>Open {shortName(landing.tripName)}</PrimaryLink>}
          />
        )}
        {landing?.state === "unavailable" && (
          <Elsewhere
            eyebrow="Invite unavailable"
            title="This invite doesn't work"
            body={landing.message}
            action={<PrimaryLink href="/">Start your own trip</PrimaryLink>}
          />
        )}
      </main>
    </>
  );
}

/** "Japan: food and temples" → "Japan" — the design's `trip.name.split(':')[0]`. */
function shortName(name: string): string {
  return name.split(":")[0]!.trim() || name;
}

function PrimaryLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className={cn(buttonVariants({ variant: "primary" }), "h-10 no-underline")}>
      {children}
    </Link>
  );
}

/** The one-column screen every state but `valid` shares. */
function Elsewhere({
  eyebrow,
  title,
  body,
  action,
}: {
  eyebrow: string;
  title: string;
  body: string;
  action: React.ReactNode;
}) {
  return (
    <div className="flex w-full max-w-120 flex-col gap-4 pt-10 sm:pt-14">
      <Text as="span" className="font-mono text-2xs uppercase tracking-widest text-slate">
        {eyebrow}
      </Text>
      <Heading level={1} className="text-balance tracking-tight">
        {title}
      </Heading>
      <Text className="text-md leading-relaxed text-slate">{body}</Text>
      <div className="flex flex-wrap gap-2.5">
        {action}
        <Link href="/welcome" className={cn(buttonVariants({ variant: "ghost" }), "h-10 no-underline")}>
          What is Caesura?
        </Link>
      </div>
    </div>
  );
}

function ValidInvite({
  landing,
  token,
  googleAvailable,
  reload,
}: {
  landing: ValidLanding;
  token: string;
  googleAvailable: boolean;
  reload: () => Promise<void>;
}) {
  const { join, joining, error } = useInviteJoin({
    token,
    signedIn: landing.signedIn,
    inviterName: firstNameOf(landing.inviterName),
    googleAvailable,
    onRefused: () => void reload(),
  });

  // Back from sign-in, having pressed Join on the way out: finish it. The
  // marker is read-and-clear and names this token, so a second render, a
  // StrictMode double effect or a different invite cannot fire it again —
  // see `pendingInviteJoin.ts` for why this is not a `?join=1`.
  const redeemed = useRef(false);
  useEffect(() => {
    if (redeemed.current || !landing.signedIn) return;
    redeemed.current = true;
    if (takeInviteJoin(token)) void join();
  }, [landing.signedIn, token, join]);

  const joinLabel = landing.signedIn ? "Join the trip" : googleAvailable ? "Join with Google" : "Sign in to join";
  const inviter = firstNameOf(landing.inviterName);

  return (
    <div className="grid w-full max-w-content grid-cols-1 items-start gap-8 lg:grid-cols-2 lg:gap-16">
      <div className="flex flex-col gap-5.5 pt-2">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="grid size-11 shrink-0 place-items-center rounded-full bg-info-tint text-md font-semibold text-info-ink"
          >
            {initials(landing.inviterName)}
          </span>
          <span className="flex min-w-0 flex-col gap-px">
            <Text as="span" className="text-md font-semibold">
              {landing.inviterName} invited you
            </Text>
            <Text as="span" variant="secondary">
              {sentLine(landing)}
            </Text>
          </span>
        </div>

        <div className="flex flex-col gap-2.5">
          <Heading level={1} className="text-balance leading-tight tracking-tight">
            {landing.trip.name}
          </Heading>
          <Text as="span" className="font-mono text-sm text-slate">
            {metaLine(landing)}
          </Text>
        </div>

        <div className="flex items-center gap-3">
          <span aria-hidden className="flex shrink-0">
            {landing.crew.slice(0, CREW_AVATARS).map((name, index) => (
              <span
                key={`${name}-${index}`}
                title={name}
                className={cn(
                  "grid size-7.5 place-items-center rounded-full border-2 border-paper bg-moss text-2xs font-semibold text-ink",
                  index > 0 && "-ml-2",
                )}
              >
                {initials(name)}
              </span>
            ))}
          </span>
          <Text as="span" className="text-pretty text-slate">
            {crewLine(landing)}
          </Text>
        </div>

        <div className="flex max-w-95 flex-col gap-2.5">
          <Button variant="primary" size="touch" className="w-full" disabled={joining} onClick={() => void join()}>
            {joining ? "Joining…" : joinLabel}
          </Button>
          {error !== null && (
            <Text as="span" role="alert" className="text-sm text-danger-ink">
              {error} Your invite is still open — try again.
            </Text>
          )}
          <Link
            href={`/invite/${encodeURIComponent(token)}/look`}
            className={cn(buttonVariants({ variant: "ghost", size: "touch" }), "w-full no-underline")}
          >
            Have a look first
          </Link>
          <Text as="span" className="text-pretty text-xs text-slate">
            Joining is free — {inviter}&apos;s plan covers everyone on the trip.
          </Text>
        </div>
      </div>

      <PlanSoFar landing={landing} />
    </div>
  );
}

/** How many faces the crew stack draws before the sentence carries the rest. */
const CREW_AVATARS = 4;

/** The right-hand card: a ribbon of days, then one row per leg. */
function PlanSoFar({ landing }: { landing: ValidLanding }) {
  // The board's own derivation, fed the board's own input — one city per day,
  // in day order — so a city here wears the colour it wears on the board.
  const accents = dayAccents(landing.days.map((d) => d.city));
  const familyOf = new Map<string | null, AccentFamily>();
  landing.days.forEach((day, index) => familyOf.set(day.city, accents[index]!.solid));
  return (
    <Card raised className="overflow-hidden p-0">
      <div className="flex flex-col gap-3 border-b border-hairline px-5 pb-3.5 pt-4.5">
        <Text as="span" className="text-2xs font-semibold uppercase tracking-wider text-slate">
          The plan so far
        </Text>
        {landing.days.length > 0 && (
          <div aria-hidden className="flex h-2.5 gap-0.5">
            {landing.days.map((day, index) => (
              <span
                key={index}
                className={cn("flex-1 rounded-xs", SOLID_BG[accents[index]!.solid], day.stopCount === 0 && "opacity-35")}
              />
            ))}
          </div>
        )}
      </div>
      <ul aria-label="Legs of the trip" className="flex flex-col">
        {landing.legs.map((leg) => (
          <li key={leg.dayFrom} className="flex items-start gap-3 border-b border-hairline px-5 py-3.5">
            <span aria-hidden className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", SOLID_BG[familyOf.get(leg.city) ?? "neutral"])} />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <Text as="span" className="text-md font-semibold">
                {leg.city ?? "Not placed yet"}
              </Text>
              <Text as="span" variant="secondary" className="text-pretty">
                {highlightLine(leg)}
              </Text>
            </span>
            <Text as="span" className="shrink-0 whitespace-nowrap pt-0.5 font-mono text-xs text-slate">
              {leg.dayFrom === leg.dayTo ? `Day ${leg.dayFrom}` : `Days ${leg.dayFrom}–${leg.dayTo}`}
            </Text>
          </li>
        ))}
      </ul>
      <Text className="px-5 pb-4 pt-3 text-sm text-slate">
        {landing.trip.stopCount === 1 ? "1 stop" : `${landing.trip.stopCount} stops`} so far, and plenty of room
        left.
      </Text>
    </Card>
  );
}

// A static map, never a template string: Tailwind only emits utilities it can
// see as literal text (same pattern as `MapHoverCard`'s DOT_BG).
const SOLID_BG: Record<AccentFamily, string> = {
  brand: "bg-brand",
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  neutral: "bg-slate",
};

function highlightLine(leg: ValidLanding["legs"][number]): string {
  if (leg.stopCount === 0) return "Nothing planned yet — open for ideas";
  if (leg.highlights.length > 0) return leg.highlights.join(" · ");
  return leg.stopCount === 1 ? "1 stop" : `${leg.stopCount} stops`;
}

/** "Dana Reyes" → "DR", "Alice" → "A". From a NAME — the landing carries no ids. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";
}

function sentLine(landing: ValidLanding): string {
  const when = formatRelativeInstant(landing.sentAt);
  if (landing.recipientEmail === null) return when === null ? "" : `Sent ${when}`;
  return when === null ? `Sent to ${landing.recipientEmail}` : `Sent to ${landing.recipientEmail} · ${when}`;
}

function metaLine(landing: ValidLanding): string {
  const { startDate, dayCount, cityCount } = landing.trip;
  const parts: string[] = [];
  if (startDate !== null) {
    const end = dayCount > 1 ? addDaysIso(startDate, dayCount - 1) : startDate;
    parts.push(
      end === startDate
        ? formatTripDateWithYear(startDate)
        : `${formatTripDateWithYear(startDate)} – ${formatTripDateWithYear(end)}`,
    );
  }
  parts.push(dayCount === 1 ? "1 day" : `${dayCount} days`);
  parts.push(cityCount === 1 ? "1 city" : `${cityCount} cities`);
  return parts.join(" · ");
}

/**
 * "Dana, Mei, Priya and Kenji are planning. You can add stops, vote and
 * comment." The second sentence is the ROLE on offer, so a viewer invite does
 * not promise what it cannot give.
 */
function crewLine(landing: ValidLanding): string {
  const names = landing.crew;
  const shown = names.length > CREW_AVATARS ? names.slice(0, CREW_AVATARS - 1) : names;
  const rest = names.length - shown.length;
  const list =
    rest > 0
      ? `${shown.join(", ")} and ${rest} ${rest === 1 ? "other" : "others"}`
      : shown.length === 1
        ? shown[0]!
        : `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
  const verb = names.length === 1 ? "is" : "are";
  const can =
    landing.role === "editor"
      ? "You can add stops, vote and comment."
      : "You'll be able to look, but not change anything.";
  return `${list} ${verb} planning. ${can}`;
}
