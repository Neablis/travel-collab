"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CalendarClock } from "lucide-react";
import type { InviteLanding, TripPreview } from "@tc/contracts";
import { FrontDoorHeader } from "@/components/front/FrontDoorHeader";
import { Button, buttonVariants } from "@/components/ui/button";
import { Heading } from "@/components/ui/heading";
import { PersonChip } from "@/components/ui/person-chip";
import { Text } from "@/components/ui/text";
import { fetchInviteLanding, fetchInvitePreview } from "@/lib/apiClient";
import { cn } from "@/lib/cn";
import { firstNameOf } from "@/lib/displayName";
import { addDaysIso } from "@/lib/dates";
import { formatRelativeInstant, formatTripDateWithYear } from "@/lib/formatDate";
import { takeInviteJoin } from "@/lib/pendingInviteJoin";
import { useToday } from "@/lib/today";
import { SUGGESTER_APPROVAL } from "@/lib/tripRole";
import { InvitePlanCard, PreviewScope, PreviewWidget } from "./InvitePlanCard";
import { previewContext } from "./previewContext";
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
//
// A pending invite shows the trip before anyone joins (M38, canvas artboard
// 5), drawn by the notebook's own widgets from `GET /api/invites/:token/preview`
// (D4, D6): the countdown and who's going on the left, the plan card on the
// right. Every other state is unchanged.

type ValidLanding = Extract<InviteLanding, { state: "valid" }>;

type Phase =
  | { kind: "loading" }
  | { kind: "failed"; message: string }
  // `preview` is present exactly when `landing` is `valid`.
  | { kind: "ready"; landing: InviteLanding; preview: TripPreview | null };

/**
 * The invite landing: reads `GET /api/invites/:token` and, for a pending
 * invite, its preview, and draws the state they answer — or a retry when a read
 * itself failed.
 */
export function InviteLandingScreen({ token, googleAvailable }: { token: string; googleAvailable: boolean }) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });

  const load = useCallback(async () => {
    // Both at once. The preview refuses (404/410) any invite that is not
    // pending, and the landing is what says why, so that refusal is ignored.
    const [landing, preview] = await Promise.all([fetchInviteLanding(token), fetchInvitePreview(token)]);
    if (!landing.ok) setPhase({ kind: "failed", message: landing.error.message });
    else if (landing.value.state !== "valid") setPhase({ kind: "ready", landing: landing.value, preview: null });
    else if (!preview.ok) setPhase({ kind: "failed", message: preview.error.message });
    else setPhase({ kind: "ready", landing: landing.value, preview: preview.value });
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const landing = phase.kind === "ready" ? phase.landing : null;
  const preview = phase.kind === "ready" ? phase.preview : null;

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
        {landing?.state === "valid" && preview !== null && (
          <ValidInvite landing={landing} preview={preview} token={token} googleAvailable={googleAvailable} reload={load} />
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
            eyebrow="Already a member"
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
  preview,
  token,
  googleAvailable,
  reload,
}: {
  landing: ValidLanding;
  preview: TripPreview;
  token: string;
  googleAvailable: boolean;
  reload: () => Promise<void>;
}) {
  // The reader's own day, for the countdown (`WidgetContext.today`).
  const today = useToday();
  const context = useMemo(() => previewContext(preview, today), [preview, today]);
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

  // Only an owner can invite, and the owner is the preview's first person, so
  // the inviter's chip is theirs, as they look on this trip (D3).
  const owner = preview.people[0]!;

  return (
    <PreviewScope context={context}>
      <div className="grid w-full max-w-content grid-cols-1 items-start gap-8 lg:grid-cols-2 lg:gap-16">
        <div className="flex flex-col gap-5.5 pt-2">
          <div className="flex items-center gap-3">
            <PersonChip name={landing.inviterName} avatar={owner.avatar} color={owner.color} size="lg" />
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

          {/* `trip.countdown`. Its value reads "in 17 days", "starts today",
              "day 3 of 9" or "ended 2 days ago", so no one lead-in word fits
              them all; the calendar mark says what the value is about. */}
          <Text className="flex items-center gap-2 text-md">
            <CalendarClock aria-hidden className="size-4 shrink-0 text-slate" />
            <PreviewWidget context={context} name="attribute" params={COUNTDOWN} />
          </Text>

          {/* Straight before the actions, so on a phone Join follows who's
              going rather than the map (the plan card comes after). */}
          <div className="flex flex-col gap-1.5">
            <PreviewWidget context={context} name="trip.people" />
            <Text as="span" className="text-pretty text-slate">
              {CREW_CAN[landing.role]}
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

        <InvitePlanCard preview={preview} context={context} />
      </div>
    </PreviewScope>
  );
}

const COUNTDOWN = { field: "trip.countdown" };

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

// A `Record`, so a new invite role does not compile until the landing says
// what it may do.
const CREW_CAN: Record<ValidLanding["role"], string> = {
  editor: "You can add stops, vote and comment.",
  suggester: `You can suggest stops and changes ${SUGGESTER_APPROVAL}.`,
  viewer: "You'll be able to look, but not change anything.",
};
