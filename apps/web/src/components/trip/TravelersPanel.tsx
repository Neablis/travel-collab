"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { InviteRole, TripAccess, TripInvite } from "@tc/contracts";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { displayNameFor } from "@/lib/displayName";
import {
  createTripInvite,
  fetchTripAccess,
  inviteLink,
  revokeTripInvite,
} from "@/lib/apiClient";
import { INVITE_ROLES_OFFERED, roleLabel } from "@/lib/tripRole";

// SPEC §8 lists "Travelers UI" as DELIBERATELY NOT DESIGNED, and M11 parks
// travelers inside Trip settings until it exists. So this invents as little as
// possible: the member rows are the same list the sheet already rendered, the
// controls are existing primitives on existing tokens (Input, NativeSelect,
// Button, Badge), and there is no new visual language to unpick when the real
// design lands. Expect this to be the surface most likely to be redesigned.

// Delegates to the single resolver rather than spelling the fallback out a
// second time: M11b's author strip and public profile need the same question
// answered from strictly less data, and the milestone's M17 amendment is
// explicit that a second call site means the seam is built wrong. See
// `lib/displayName.ts`.
function displayName(member: TripAccess["members"][number]): string {
  return displayNameFor(member);
}

function statusLabel(invite: TripInvite): string {
  if (invite.status === "revoked") return "Revoked";
  if (invite.status === "accepted") return "Joined";
  return "Waiting";
}

export function TravelersPanel({
  tripId,
  onInvitesChanged,
}: {
  tripId: string;
  /**
   * Whether an invite is out: on every read of the list, and as soon as one is
   * made. The board polls on a timer while one is (W73) — the person invited
   * can join and suggest while it is open — and stops once the last is
   * revoked. It read its invites at load, before any made or revoked here.
   */
  onInvitesChanged?: (pending: boolean) => void;
}) {
  // A ref, so `load` keeps its identity and its effect runs once per trip.
  const reportInvites = useRef(onInvitesChanged);
  reportInvites.current = onInvitesChanged;
  const [access, setAccess] = useState<TripAccess | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InviteRole>("editor");
  const [copied, setCopied] = useState<string | null>(null);
  // The link, shown as selectable text, when the clipboard refused it. A
  // `title` tooltip is not a delivery mechanism — it is unreachable by
  // keyboard and on touch — so a denied clipboard permission would otherwise
  // leave the owner with no way to actually send the invite (CodeRabbit,
  // PR #70).
  const [revealed, setRevealed] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await fetchTripAccess(tripId);
    if (result.ok) {
      setAccess(result.value);
      reportInvites.current?.(result.value.invites.some((i) => i.status === "pending"));
      // Cleared on success: a retry that worked must not leave the previous
      // failure sitting next to fresh, correct data.
      setError(null);
    } else {
      setError(result.error.message);
    }
  }, [tripId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleInvite(event: React.FormEvent) {
    event.preventDefault();
    // **The gated form cannot submit, stated here rather than inferred.** Its
    // controls are all `disabled`, so no browser reaches this line today — but
    // that is two `disabled` props away from being false, and the rule ("an
    // unentitled owner sends no invite") belongs where the send happens. The
    // endpoint refuses with 402 regardless; this just declines to ask.
    if (!(access?.collaboratorsEntitled ?? true)) return;
    setBusy(true);
    setError(null);
    const trimmed = email.trim();
    // `busy` is released in `finally`, AFTER the copy and the reload — not
    // the moment the POST returns. Clearing it early left a window in which a
    // second click minted a second invite while the first refresh was still
    // in flight (CodeRabbit, PR #70).
    try {
      const result = await createTripInvite(tripId, {
        email: trimmed === "" ? null : trimmed,
        role,
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setEmail("");
      // Before the reload below, which a failed read would skip.
      reportInvites.current?.(true);
      // The link is the invite. An address also gets it by email, but a send
      // can fail or be unconfigured, so the freshly minted link still goes
      // straight onto the clipboard rather than making the owner hunt for it
      // in the list about to re-render.
      await copy(result.value);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function copy(invite: TripInvite) {
    const link = inviteLink(invite.token);
    try {
      await navigator.clipboard.writeText(link);
      setCopied(invite.inviteId);
      setRevealed(null);
    } catch {
      // A denied clipboard permission is not an error worth a red banner —
      // but it does need a way out, so the link is shown as selectable text
      // instead of only living in a tooltip.
      setCopied(null);
      setRevealed(link);
    }
  }

  async function handleRevoke(invite: TripInvite) {
    setBusy(true);
    try {
      const result = await revokeTripInvite(tripId, invite.inviteId);
      // Reload FIRST, then report this action's own failure. `load()` clears
      // the error on success, so setting it before the reload would have this
      // handler wipe its own message — a revoke that failed would look like
      // one that worked.
      await load();
      if (!result.ok) setError(result.error.message);
    } finally {
      setBusy(false);
    }
  }

  const isOwner = access?.myRole === "owner";
  // **Two conditions, and the second is M20 link 6.** Owner-only was already
  // true; inviting anyone now also requires the trip owner's
  // `trip.collaborators`. Advisory only — `POST /invites` refuses with 402
  // server-side whatever this decides.
  const collaboratorsEntitled = access?.collaboratorsEntitled ?? true;
  const canInvite = isOwner && collaboratorsEntitled;
  // **The form is rendered for any owner and INERT for an unentitled one.**
  // These two used to be the same condition — see the block comment on the
  // gate below for why that changed.
  const inviteGated = isOwner && !collaboratorsEntitled;
  // Everyone who is on this trip because they accepted an invite — i.e. not the
  // owner. When the owner is not entitled these are the rows the server capped
  // to `viewer` on read, which is what the banner below explains.
  const grantedCount = (access?.members ?? []).filter((m) => m.role !== "owner").length;
  const lapsed = isOwner && !collaboratorsEntitled && grantedCount > 0;
  const pending = (access?.invites ?? []).filter((i) => i.status === "pending");

  return (
    <div className="flex flex-col gap-3" data-testid="travelers-panel">
      {/* **The member list's outline while it loads** — Mitchell, PR #269
          preview: *"Need a skeleton placeholder here, so it doesnt pop in
          magically"*, and then *"I meant to add a placeholder under invite
          someone and the invites"*. The whole panel pops in on one answer, so
          the whole panel is outlined, in the panel's own order: two member
          rows (a name, a role badge — the owner and one more is the commonest
          trip), the invite form (field and role picker, the button, its note),
          and one invite row. Only while nothing has answered — a failure is
          said below, not left breathing.

          The form's outline is drawn for everyone, though only an owner gets
          the form: the role is in the very answer being waited for, and an
          outline that goes away costs less than a form that appears from
          nothing. */}
      {access === null && error === null && (
        <SkeletonRegion label="Loading travelers" className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            {[1, 2].map((row) => (
              <div key={row} className="flex items-center justify-between gap-3">
                <Skeleton className="h-3 w-28" delay={row === 1 ? 1 : 2} />
                <Skeleton circle className="h-5 w-12" delay={row === 1 ? 1 : 2} />
              </div>
            ))}
          </div>
          <div data-testid="travelers-skeleton-invite-form" className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Skeleton className="h-9 flex-1" delay={2} />
              <Skeleton className="h-9 w-24" delay={2} />
            </div>
            <Skeleton className="h-7 w-full" delay={2} />
            <Skeleton className="h-3 w-3/4" delay={3} />
          </div>
          <div
            data-testid="travelers-skeleton-invites"
            className="flex items-center justify-between gap-2 border-t border-hairline pt-3"
          >
            <Skeleton className="h-3 w-32" delay={3} />
            <Skeleton circle className="h-5 w-12" delay={3} />
          </div>
        </SkeletonRegion>
      )}
      <div className="flex flex-col gap-1.5">
        {(access?.members ?? []).map((member) => (
          // The testid carries the userId so a test can assert identity AND
          // role together. Without it the only handle is the role text, which
          // the pending-invite rows below also render — an assertion on
          // "editor" alone passes from an invite row with no traveller entry
          // at all (CodeRabbit, PR #70).
          <div
            key={member.userId}
            data-testid={`traveller-${member.userId}`}
            className="flex items-center justify-between gap-3"
          >
            <Text as="span" className="text-xs text-ink">
              {displayName(member)}
            </Text>
            <Badge variant={member.role === "owner" ? "brand" : "neutral"}>{member.role}</Badge>
          </div>
        ))}
      </div>

      {/* **The lapse banner, in the same words the read boundary uses.**
          Everyone except the owner is capped at reading, nothing was removed,
          no role was rewritten, and paying again restores all of them with no
          re-invites — which is literally true, because `capGranted` narrows a
          READ and `trip_memberships` was never written. */}
      {lapsed && (
        <div role="status" className="flex flex-col gap-1 border-t border-hairline pt-3">
          <Text as="span" className="text-xs text-ink">
            {grantedCount === 1 ? "Your collaborator can" : `Your ${grantedCount} collaborators can`}{" "}
            read this trip but not edit it, because this account is not on Premium.
          </Text>
          <Text as="span" className="text-xs text-slate">
            Nobody was removed and no role was changed. Subscribing again restores everyone exactly
            as they were.
          </Text>
        </div>
      )}

      {/* **The invite form stays on screen for an unentitled owner, disabled,
          under a CTA** — reversing §17.3's 2026-09-02 decision on Mitchell's
          call, from the preview, 2026-09-15: *"I thought the free tier shouldnt
          let me invite people? We should keep the ui but have it greyed out,
          and have a CTA to get people to upgrade."*

          The line this replaces read *"a disabled button beside an explanation
          offers a control that can never work"*, and that is still true of M20,
          where it was written: there was no checkout, so the only honest thing
          to show was a sentence. **M21 is what changes the argument.** The
          control is no longer one that can never work — it is one that works as
          soon as the CTA beside it is taken, and hiding the shape of what you
          are buying makes the offer harder to read, not cleaner.

          This is still the half of M20's gate box the server cannot satisfy on
          its own. `POST /invites` refuses with 402 and the tier named whatever
          this renders; this is where a person reads it BEFORE trying.

          **Still no price here.** §29 puts prices on `plans` and nowhere else,
          so the CTA names the destination rather than a number. */}
      {inviteGated && (
        <div
          role="note"
          data-testid="collaborators-gate"
          className="flex flex-col gap-1.5 border-t border-hairline pt-3"
        >
          <Text as="span" className="text-xs text-ink">
            Inviting people to a trip is part of Premium.
          </Text>
          <Text as="span" className="text-xs text-slate">
            Planning a trip on your own is always free — days, activities, costs, saved days and
            publishing to Discover are all included.
          </Text>
          {/* `buttonVariants` on a `Link`, the repo's pattern for a control
              that navigates (PlanSection:218). It leaves the trip, which is
              the point: the decision is not made in this sheet. */}
          <Link
            href="/plans"
            className={buttonVariants({ variant: "primary", size: "sm" }) + " self-start"}
            data-testid="collaborators-gate-cta"
          >
            See plans
          </Link>
        </div>
      )}

      {/* Rendered for `isOwner`, not for `canInvite`: an unentitled owner sees
          the same form with every control disabled, beneath the CTA above.
          `busy || inviteGated` on each one — the primitives' shared
          `disabled:opacity-50` is what "greyed out" means here, so there is no
          new visual language and nothing to keep in sync. */}
      {isOwner && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => void handleInvite(e)}
          data-testid="invite-form"
        >
          <div className="flex items-center gap-2">
            <Input
              aria-label="Invite by email"
              placeholder="name@example.com"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="flex-1"
              disabled={inviteGated}
            />
            <NativeSelect
              aria-label="Invite role"
              value={role}
              onChange={(e) => setRole(e.target.value as InviteRole)}
              disabled={inviteGated}
            >
              {INVITE_ROLES_OFFERED.map((r) => (
                <option key={r} value={r}>
                  {roleLabel(r)}
                </option>
              ))}
            </NativeSelect>
          </div>
          <Button type="submit" variant="secondary" size="sm" disabled={busy || inviteGated}>
            Invite someone
          </Button>
          {/* Said once, plainly: the link IS the invite; email is a courtesy. */}
          <Text as="span" className="text-xs text-slate">
            Creates a link and copies it. Add an email and we&rsquo;ll send it there too.
          </Text>
        </form>
      )}

      {canInvite && pending.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-hairline pt-3">
          {pending.map((invite) => (
            <div key={invite.inviteId} className="flex items-center justify-between gap-2">
              <Text as="span" className="min-w-0 flex-1 truncate text-xs text-ink">
                {invite.email ?? "Anyone with the link"}
              </Text>
              <Badge variant="neutral">{invite.role}</Badge>
              <Text as="span" className="text-xs text-slate">
                {statusLabel(invite)}
              </Text>
              {/* The visible label flips to "Copied", but the accessible
                  name does not: creating an invite copies it immediately, so
                  a name derived from the label would mean the freshly minted
                  row is addressable as "Copied" and every older row as "Copy
                  link" — a locator that depends on which row you are looking
                  at. `title` carries the URL itself, which is also what makes
                  a denied clipboard permission a non-event. */}
              <Button
                variant="ghost"
                size="sm"
                aria-label="Copy invite link"
                title={inviteLink(invite.token)}
                onClick={() => void copy(invite)}
              >
                {copied === invite.inviteId ? "Copied" : "Copy link"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Revoke invite"
                disabled={busy}
                onClick={() => void handleRevoke(invite)}
              >
                Revoke
              </Button>
            </div>
          ))}
        </div>
      )}

      {revealed !== null && (
        <div className="flex flex-col gap-1">
          <Text as="span" className="text-xs text-slate">
            Couldn&apos;t reach your clipboard — copy this instead:
          </Text>
          <Input readOnly aria-label="Invite link" value={revealed} onFocus={(e) => e.target.select()} />
        </div>
      )}

      {error !== null && (
        <Text as="span" className="text-xs text-danger-ink">
          {error}
        </Text>
      )}
    </div>
  );
}
