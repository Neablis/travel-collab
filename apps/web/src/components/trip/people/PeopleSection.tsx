"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { travellerIds, type InviteRole, type TripAccess, type TripInvite, type TripMemberProfile } from "@tc/contracts";
import { useSessionUser } from "@/components/account/useSessionUser";
import { Banner } from "@/components/ui/banner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import {
  changeMemberRole,
  fetchTripAccess,
  inviteLink,
  leaveTrip,
  removeMember,
  revokeTripInvite,
  setTravelling,
  type ApiResult,
} from "@/lib/apiClient";
import { displayNameFor } from "@/lib/displayName";
import { ConfirmDialog } from "./ConfirmDialog";
import { InviteDialog } from "./InviteDialog";
import { InviteRow, inviteName } from "./InviteRow";
import { PersonMenu, type PersonAction } from "./PersonMenu";
import { PersonRow } from "./PersonRow";
import { RoleDialog } from "./RoleDialog";

// The travellers spec §4. One avatar, one name, one plain-words role line and
// ONE control per row — the `⋯` menu, holding only what the reader may do.
// Inviting lives in a dialog, so the list is the first thing you read.

type Confirming =
  | { kind: "revoke"; invite: TripInvite }
  | { kind: "remove"; member: TripMemberProfile; name: string }
  | { kind: "leave" };

const CONFIRM_COPY = {
  revoke: () => ({
    title: "Revoke this invite?",
    body: "The link stops working. If they already joined, they lose access.",
    confirmLabel: "Revoke",
  }),
  remove: (name: string) => ({
    title: `Remove ${name} from the trip?`,
    body: `${name} loses access. Stops they were picked for keep the pick.`,
    confirmLabel: "Remove",
  }),
  leave: () => ({
    title: "Leave this trip?",
    body: "You lose access to this trip. Stops you were picked for keep the pick, and only the owner can invite you back.",
    confirmLabel: "Leave trip",
  }),
};

/**
 * Whether `next` is older than the access already held, so adopting it would
 * step back. The section's own read and the provider's re-read race, and a slow
 * mount read (rev 5) landing after the provider's (rev 6) would otherwise
 * stick: the provider has seen 6 and never re-reads to correct it.
 *
 * `accessRev` is a per-trip integer counter serialized as a string (W5), so it
 * is compared as a number. A read without one (the demo, a failed rev read)
 * cannot be placed, and is taken only while nothing held carries a rev.
 */
function isOlder(next: TripAccess, held: TripAccess | null): boolean {
  if (held?.accessRev === undefined) return false;
  if (next.accessRev === undefined) return true;
  return Number(next.accessRev) < Number(held.accessRev);
}

function travellersLine(count: number): string {
  // D5: totals floor at one person, so a trip with nobody travelling is still
  // priced for one — said, rather than "split across 0".
  if (count === 0) return "Nobody is marked as travelling, so costs are priced for one person.";
  return `Costs are split across ${count} traveller${count === 1 ? "" : "s"}.`;
}

/**
 * Trip settings → People (travellers spec §4): who is on the trip, grouped by
 * Travelling, Not travelling and — for the owner — Invited, with the owner's
 * `+ Invite` and each row's `⋯`.
 *
 * Every member write answers with the trip's `TripAccess`, which is applied
 * as it arrives rather than re-read. `onAccessChanged` fires after one that
 * moved who is on the trip or who travels, because that moves the trip's
 * per-person totals too and this section does not hold the trip.
 *
 * A change made somewhere else — an invite accepted in another browser, the
 * owner marking you not travelling — arrives as `access`, the trip provider's
 * re-read on the poll's `accessRev` (KI-2026-10-04-b).
 */
export function PeopleSection({
  tripId,
  access: provided,
  onInvitesChanged,
  onAccessChanged,
}: {
  tripId: string;
  /**
   * The trip provider's latest `TripAccess`. Adopted each time it changes
   * after this section mounts; the one already there at mount is not, because
   * the section's own read is fresher than a provider read that may have
   * been answered from the cache.
   */
  access?: TripAccess | null;
  /**
   * Whether an invite is out: on every read of the list, and as soon as one is
   * made. The board polls on a timer while one is (W73) — the person invited
   * can join and suggest while it is open — and stops once the last is
   * revoked. It read its invites at load, before any made or revoked here.
   */
  onInvitesChanged?: (pending: boolean) => void;
  /** A member was moved, removed, or changed whether they travel. */
  onAccessChanged?: () => void;
}) {
  // Refs, so `load` keeps its identity and its effect runs once per trip.
  const reportInvites = useRef(onInvitesChanged);
  reportInvites.current = onInvitesChanged;
  const router = useRouter();
  const me = useSessionUser();
  const [access, setAccess] = useState<TripAccess | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const [changingRole, setChangingRole] = useState<{ member: TripMemberProfile; name: string; role: InviteRole } | null>(
    null,
  );
  const [copied, setCopied] = useState<string | null>(null);
  // The link, shown as selectable text, when the clipboard refused it. A
  // `title` tooltip is not a delivery mechanism — unreachable by keyboard and
  // on touch — so a denied clipboard would otherwise leave the owner no way to
  // send the invite (CodeRabbit, PR #70).
  const [revealed, setRevealed] = useState<string | null>(null);
  const ids = useId();

  // The value on screen, read synchronously: two reads in flight can land in
  // either order, and the one to compare against is the last one adopted.
  const held = useRef<TripAccess | null>(null);
  const adopt = useCallback((value: TripAccess) => {
    if (isOlder(value, held.current)) return;
    held.current = value;
    setAccess(value);
    reportInvites.current?.(value.invites.some((i) => i.status === "pending"));
    // Cleared on success: a retry that worked must not leave the previous
    // failure sitting next to fresh, correct data.
    setError(null);
  }, []);

  const load = useCallback(async () => {
    const result = await fetchTripAccess(tripId);
    if (result.ok) adopt(result.value);
    else setError(result.error.message);
  }, [tripId, adopt]);

  useEffect(() => {
    void load();
  }, [load]);

  const atMount = useRef(provided);
  useEffect(() => {
    if (provided === undefined || provided === null || provided === atMount.current) return;
    atMount.current = provided;
    adopt(provided);
  }, [provided, adopt]);

  /** Runs a member write and applies the `TripAccess` it answers with. */
  async function writeMember(write: () => Promise<ApiResult<TripAccess>>): Promise<boolean> {
    setBusy(true);
    try {
      const result = await write();
      if (!result.ok) {
        setError(result.error.message);
        return false;
      }
      adopt(result.value);
      onAccessChanged?.();
      return true;
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
      setCopied(null);
      setRevealed(link);
    }
  }

  async function confirm(action: Confirming) {
    setBusy(true);
    try {
      if (action.kind === "revoke") {
        const result = await revokeTripInvite(tripId, action.invite.inviteId);
        // Reload FIRST, then report this action's own failure. `load()` clears
        // the error on success, so setting it before would have this handler
        // wipe its own message — a failed revoke would look like one that worked.
        await load();
        if (!result.ok) setError(result.error.message);
      } else if (action.kind === "remove") {
        await writeMember(() => removeMember(tripId, action.member.userId));
      } else {
        // Leaving answers `{ ok: true }`, not the list: whoever left may no
        // longer read it. Home is where Home's own *Leave this trip* leaves
        // you (`(app)/page.tsx`), and this trip is no longer yours to look at.
        const result = await leaveTrip(tripId);
        if (result.ok) router.push("/");
        else setError(result.error.message);
      }
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  }

  async function changeRole(member: TripMemberProfile, role: InviteRole) {
    if (await writeMember(() => changeMemberRole(tripId, member.userId, role))) setChangingRole(null);
  }

  const isOwner = access?.myRole === "owner";
  // **Two conditions, and the second is M20 link 6.** Advisory only —
  // `POST /invites` refuses with 402 server-side whatever this decides.
  const collaboratorsEntitled = access?.collaboratorsEntitled ?? true;
  const gated = isOwner && !collaboratorsEntitled;
  // Everyone on this trip because they accepted an invite. When the owner is
  // not entitled these are the rows the server capped to `viewer` on read.
  const members = access?.members ?? [];
  const grantedCount = members.filter((m) => m.role !== "owner").length;
  const lapsed = gated && grantedCount > 0;
  const travelling = new Set(travellerIds(members));
  // The owner sorts first in whichever group they are in (spec §4).
  const ordered = [...members].sort((a, b) => Number(b.role === "owner") - Number(a.role === "owner"));
  const pending = isOwner ? (access?.invites ?? []).filter((i) => i.status === "pending") : [];

  // Who is reading, as the server that answered the read knows it; the session
  // only for a server that does not say. Waiting on the session left a member
  // no menu on their own row — no way to leave — until it answered, and for
  // good if the probe failed.
  const viewerId = access?.viewerId ?? me?.id ?? null;

  function isYou(member: TripMemberProfile): boolean {
    // The owner's row is the owner's whoever the reader turns out to be.
    return member.userId === viewerId || (isOwner && member.role === "owner");
  }

  function memberActions(member: TripMemberProfile, name: string): PersonAction[] {
    const toggle: PersonAction = {
      label: travelling.has(member.userId) ? "Mark as not travelling" : "Mark as travelling",
      onSelect: () => void writeMember(() => setTravelling(tripId, member.userId, !travelling.has(member.userId))),
    };
    // D4: the owner for anyone, a member for themselves. The owner can never
    // be removed or have their role changed, so their own menu is the toggle.
    if (isOwner) {
      const role = member.role;
      if (role === "owner") return [toggle];
      return [
        toggle,
        // Not during a lapse: every granted row reads as the capped `viewer`,
        // so the dialog would open on *Can view* whatever was stored, and a
        // change would show nothing. Resubscribing restores the roles.
        ...(lapsed ? [] : [{ label: "Change role…", onSelect: () => setChangingRole({ member, name, role }) }]),
        { label: "Remove from trip…", destructive: true, onSelect: () => setConfirming({ kind: "remove", member, name }) },
      ];
    }
    if (isYou(member)) {
      return [toggle, { label: "Leave trip…", destructive: true, onSelect: () => setConfirming({ kind: "leave" }) }];
    }
    return [];
  }

  function renderMember(member: TripMemberProfile) {
    const name = displayNameFor(member);
    return (
      <PersonRow
        key={member.userId}
        member={member}
        name={name}
        isYou={isYou(member)}
        menu={<PersonMenu label={name} actions={memberActions(member, name)} />}
      />
    );
  }

  const groups = [
    { key: "travelling", label: "Travelling", rows: ordered.filter((m) => travelling.has(m.userId)).map(renderMember) },
    { key: "not", label: "Not travelling", rows: ordered.filter((m) => !travelling.has(m.userId)).map(renderMember) },
    {
      key: "invited",
      label: "Invited",
      rows: pending.map((invite) => (
        <InviteRow
          key={invite.inviteId}
          invite={invite}
          copied={copied === invite.inviteId}
          menu={
            <PersonMenu
              label={inviteName(invite)}
              actions={[
                { label: "Copy invite link", onSelect: () => void copy(invite) },
                { label: "Revoke invite…", destructive: true, onSelect: () => setConfirming({ kind: "revoke", invite }) },
              ]}
            />
          }
        />
      )),
    },
  ];

  const confirmCopy =
    confirming === null
      ? null
      : confirming.kind === "remove"
        ? CONFIRM_COPY.remove(confirming.name)
        : CONFIRM_COPY[confirming.kind]();

  return (
    <div className="flex flex-col gap-3" data-testid="people-section">
      <div className="flex flex-col gap-0.5">
        <div className="flex min-h-7 items-center justify-between gap-3">
          <Text as="span" className="text-xs font-semibold uppercase tracking-wider text-slate">
            {access === null ? "People" : `People · ${members.length}`}
          </Text>
          {isOwner ? (
            <Button variant="secondary" size="sm" onClick={() => setInviting(true)}>
              <Plus className="size-3.5" aria-hidden />
              Invite
            </Button>
          ) : null}
        </div>
        {access !== null ? (
          <Text as="span" variant="muted">
            {travellersLine(travelling.size)}
          </Text>
        ) : null}
      </div>

      {/* **At most one banner** (spec §4). The lapse says everything the gate
          does and more, so when both are true it is the one shown — with the
          same way out. */}
      {lapsed ? (
        // The read boundary in the words the server uses: everyone but the
        // owner is capped at reading, nothing was removed, no role was
        // rewritten — literally true, because `capGranted` narrows a READ and
        // `trip_memberships` was never written.
        <Banner
          variant="warning"
          actions={
            <Link href="/plans" className={buttonVariants({ variant: "secondary", size: "sm" })}>
              See plans
            </Link>
          }
        >
          {grantedCount === 1 ? "Your collaborator can" : `Your ${grantedCount} collaborators can`} read this trip but
          not edit it, because this account is not on Premium. Nobody was removed and no role was changed. Subscribing
          again restores everyone exactly as they were.
        </Banner>
      ) : gated ? (
        // **Still no price here.** §29 puts prices on `plans` and nowhere else,
        // so the CTA names the destination rather than a number.
        <div
          role="note"
          data-testid="collaborators-gate"
          className="flex flex-col gap-1.5 rounded-lg border border-brand bg-brand-tint p-3"
        >
          <Text as="span" className="text-sm font-semibold text-brand-pressed">
            Inviting people to a trip is part of Premium.
          </Text>
          <Text as="span" className="text-xs text-brand-pressed">
            Planning a trip on your own is always free — days, activities, costs, saved days and publishing to
            Discover are all included.
          </Text>
          <Link
            href="/plans"
            className={buttonVariants({ variant: "primary", size: "sm" }) + " self-start"}
            data-testid="collaborators-gate-cta"
          >
            See plans
          </Link>
        </div>
      ) : null}

      {/* **The list's outline while it loads** — Mitchell, PR #269 preview:
          *"Need a skeleton placeholder here, so it doesnt pop in magically"*.
          Two member rows (the owner and one more is the commonest trip) and
          one invite row, in the section's own order. Only while nothing has
          answered — a failure is said below, not left breathing. */}
      {access === null && error === null ? (
        <SkeletonRegion label="Loading people" className="flex flex-col gap-2">
          {([1, 2] as const).map((row) => (
            <div key={row} className="flex min-h-11 items-center gap-2.5">
              <Skeleton circle className="size-7" delay={row} />
              <div className="flex flex-1 flex-col gap-1">
                <Skeleton className="h-3 w-28" delay={row} />
                <Skeleton className="h-2.5 w-20" delay={row} />
              </div>
            </div>
          ))}
          <div data-testid="people-skeleton-invites" className="flex min-h-11 items-center gap-2.5">
            <Skeleton circle className="size-7" delay={3} />
            <Skeleton className="h-3 w-32" delay={3} />
          </div>
        </SkeletonRegion>
      ) : null}

      {groups.map((group) =>
        group.rows.length === 0 ? null : (
          <div key={group.key} className="flex flex-col">
            <Text
              as="span"
              id={`${ids}-${group.key}`}
              // 12px, the app's floor (KI-2026-10-05-i); a step lighter than
              // the section's own heading, which is the same size.
              className="text-xs font-medium uppercase tracking-wider text-slate"
            >
              {group.label} · {group.rows.length}
            </Text>
            <ul aria-labelledby={`${ids}-${group.key}`} className="flex flex-col">
              {group.rows}
            </ul>
          </div>
        ),
      )}

      {revealed !== null ? (
        <div className="flex flex-col gap-1">
          <Text as="span" variant="muted">
            Couldn&apos;t reach your clipboard — copy this instead:
          </Text>
          <Input readOnly aria-label="Invite link" value={revealed} onFocus={(e) => e.target.select()} />
        </div>
      ) : null}

      {error !== null ? (
        <Text as="span" className="text-xs text-danger-ink">
          {error}
        </Text>
      ) : null}

      {isOwner ? (
        <InviteDialog
          tripId={tripId}
          open={inviting}
          onOpenChange={setInviting}
          gated={gated}
          onCreated={() => {
            // Before the reload, which a failed read would skip.
            reportInvites.current?.(true);
            void load();
          }}
        />
      ) : null}
      {confirming !== null && confirmCopy !== null ? (
        <ConfirmDialog
          {...confirmCopy}
          busy={busy}
          onOpenChange={(open) => {
            if (!open) setConfirming(null);
          }}
          onConfirm={() => void confirm(confirming)}
        />
      ) : null}
      {changingRole !== null ? (
        <RoleDialog
          name={changingRole.name}
          role={changingRole.role}
          busy={busy}
          onOpenChange={(open) => {
            if (!open) setChangingRole(null);
          }}
          onChange={(role) => void changeRole(changingRole.member, role)}
        />
      ) : null}
    </div>
  );
}
