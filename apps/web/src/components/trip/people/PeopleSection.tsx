"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import {
  travellerIds,
  type Guest,
  type InviteRole,
  type PersonColor,
  type TripAccess,
  type TripInvite,
  type TripMemberProfile,
} from "@tc/contracts";
import { usePreferences } from "@/components/account/PreferencesProvider";
import { useSessionUser } from "@/components/account/useSessionUser";
import { useOptionalTrip } from "@/components/trip/context/TripProvider";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PersonChip } from "@/components/ui/person-chip";
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import {
  changeMemberRole,
  createGuest,
  fetchTripAccess,
  inviteLink,
  leaveTrip,
  linkGuest,
  removeGuest,
  removeMember,
  revokeTripInvite,
  setTravelling,
  unlinkGuest,
  updateGuest,
  type ApiResult,
} from "@/lib/apiClient";
import { displayNameFor } from "@/lib/displayName";
import { ConfirmDialog } from "./ConfirmDialog";
import { GuestLinkDialog } from "./GuestLinkDialog";
import { InviteDialog } from "./InviteDialog";
import { InviteRow, inviteMenuLabel } from "./InviteRow";
import { PersonMenu, type PersonAction } from "./PersonMenu";
import { PersonRow } from "./PersonRow";
import { RoleDialog } from "./RoleDialog";
import { HOME_PATH } from "@/lib/homePath";

// The travellers spec §4. One avatar, one name, one plain-words role line and
// ONE control per row — the `⋯` menu, holding only what the reader may do.
// Inviting lives in a dialog, so the list is the first thing you read.

type Confirming =
  | { kind: "revoke"; invite: TripInvite }
  | { kind: "remove"; member: TripMemberProfile; name: string }
  | { kind: "leave" }
  | { kind: "removeGuest"; guest: Guest }
  | { kind: "unlinkGuest"; guest: Guest; memberName: string };

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
  removeGuest: (name: string) => ({
    title: `Remove ${name} from the trip?`,
    body: `${name} no longer counts as a traveller. Stops they were picked for keep the pick.`,
    confirmLabel: "Remove",
  }),
  unlinkGuest: (guestName: string, memberName: string) => ({
    title: `Unlink ${guestName}?`,
    body: `${guestName} stays a guest on the trip, but is no longer claimed by ${memberName}.`,
    confirmLabel: "Unlink",
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

/** How long a row says "Copied" after its link went to the clipboard. */
const COPIED_FOR_MS = 3_000;

/**
 * The reader's own chip tooltip when this trip shows them in a colour other
 * than the one they chose (M38 D3, open question 4). `members` is the access
 * read's join order, owner first — the order the server resolved colours in —
 * and the first to have stored a colour keeps it, so whoever before the reader
 * now holds their stored colour is the one who chose it first.
 *
 * When nobody earlier holds it — preferences not read yet, or a choice
 * changed since this read — the line says only what the trip shows rather
 * than guess at a name. (A changed choice that someone earlier happens to
 * hold names them until the next read; the colours on screen are that read's
 * too.)
 */
function shiftedColorTitle(
  me: TripMemberProfile,
  members: readonly TripMemberProfile[],
  chosen: PersonColor | null,
): string | undefined {
  if (!me.colorShifted || me.color === null) return undefined;
  const first = members
    .slice(0, members.findIndex((m) => m.userId === me.userId))
    .find((m) => chosen !== null && m.color === chosen);
  return first === undefined
    ? `You show in ${me.color} on this trip, because someone chose your colour first.`
    : `${displayNameFor(first)} chose ${chosen} first, so you're ${me.color} on this trip.`;
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
   * after this section mounts. The one already there at mount is PAINTED,
   * not trusted: the section still makes its own read, which is fresher than
   * a provider read that may have been answered from the cache, and replaces
   * it (`isOlder` keeps a late, older answer from winning back). Before, the
   * section drew its skeleton on every open of Trip settings — the sheet's
   * content unmounts when it closes — for a list the provider was already
   * holding (Mitchell, trip preview: *"it really reflows on loading"*).
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
  const chosenColor = usePreferences().color;
  // Who has the trip open (M46 D7), from the board's own poll: this section
  // runs none, and outside a trip there is nobody to mark.
  const online = useOptionalTrip()?.online;
  const [access, setAccess] = useState<TripAccess | null>(provided ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const [changingRole, setChangingRole] = useState<{ member: TripMemberProfile; name: string; role: InviteRole } | null>(
    null,
  );
  const [copied, setCopied] = useState<string | null>(null);
  // "Copied" is news, not a state of the row: it goes after a few seconds.
  useEffect(() => {
    if (copied === null) return;
    const timer = setTimeout(() => setCopied(null), COPIED_FOR_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  // The link, shown as selectable text, when the clipboard refused it. A
  // `title` tooltip is not a delivery mechanism — unreachable by keyboard and
  // on touch — so a denied clipboard would otherwise leave the owner no way to
  // send the invite (CodeRabbit, PR #70). Held with its invite, so it is shown
  // only while that invite is still out: a revoked one's link is dead.
  const [revealed, setRevealed] = useState<{ inviteId: string; link: string } | null>(null);
  const ids = useId();

  // Guests: named travellers with no account (guests spec P1). They ride on
  // `TripAccess` itself — no separate read — so the list below is adopted
  // from the latest access, in `adopt` below, under the same `isOlder` guard
  // as the members. Every guest write bumps `accessRev`
  // (server/access/guests.ts): the trip provider re-reads access when the
  // poll sees it move, so a guest added in another browser arrives here
  // through `provided` without this section polling, and `onAccessChanged`
  // (the provider's `refreshAccess`) re-reads it after this section's own
  // writes. `null` while the access read is still out, the way the members'
  // list is.
  //
  // A write's own answer folds in on top (see `runGuestWrite`) until the
  // re-read that write triggered lands and replaces the list wholesale —
  // the folded answer is provisional by construction.
  const [guests, setGuests] = useState<Guest[] | null>(provided?.guests ?? null);
  const [guestError, setGuestError] = useState<string | null>(null);
  const [addingGuest, setAddingGuest] = useState(false);
  const [guestName, setGuestName] = useState("");
  const [guestNameError, setGuestNameError] = useState<string | null>(null);
  const [linkingGuest, setLinkingGuest] = useState<Guest | null>(null);

  // The value on screen, read synchronously: two reads in flight can land in
  // either order, and the one to compare against is the last one adopted.
  const held = useRef<TripAccess | null>(provided ?? null);
  const adopt = useCallback((value: TripAccess) => {
    if (isOlder(value, held.current)) return;
    held.current = value;
    setAccess(value);
    // Adopted with the access read, in the same render — no second read, and
    // no extra render cycle of its own. A provisional `guest_temp-…` row
    // rides along: its POST is still in flight, and the POST's answer (or
    // failure) reconciles it — the swap looks for the temp id, the rollback
    // removes it. Without this the wholesale replace drops the optimistic
    // row, the in-flight swap has nothing to swap into, and a quick re-add
    // can land twice (the server has no name uniqueness). Temp ids are
    // client-minted, so they can never collide with the server's list.
    setGuests((current) => {
      const pending = (current ?? []).filter(
        (g) => g.guestId.startsWith("guest_temp-") && !value.guests.some((n) => n.guestId === g.guestId),
      );
      return [...value.guests, ...pending];
    });
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

  /**
   * Runs a guest write and folds the guest it answers into the list. The v1
   * guest endpoints answer the guest, not `TripAccess` (the member writes'
   * shape), so the list is updated from the response rather than re-read —
   * and `onAccessChanged` fires, because a guest moves the trip's per-person
   * totals the way a member write does. The re-read that follows replaces
   * the list wholesale, so a folded answer is only ever provisional.
   */
  async function runGuestWrite(
    write: () => Promise<ApiResult<Guest>>,
    apply: (list: Guest[], answered: Guest) => Guest[],
  ): Promise<boolean> {
    setBusy(true);
    try {
      const result = await write();
      if (!result.ok) {
        setGuestError(result.error.message);
        return false;
      }
      setGuests((current) => apply(current ?? [], result.value));
      setGuestError(null);
      onAccessChanged?.();
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function submitGuest() {
    const name = guestName.trim();
    // The server's rule (guests.ts): something remains after trimming,
    // 1-120 chars. Said here before the round trip, in the server's words.
    if (name.length === 0 || name.length > 120) {
      setGuestNameError("A guest needs a name (1-120 characters).");
      return;
    }
    // Optimistic: the row appears at once, under a client-minted id no
    // server read will ever carry — `guest_temp-…`, still inside the `guest_`
    // namespace the contract pins, so the row renders through the same path
    // as a real one. The POST's answer swaps it for the real guest; a failure
    // takes the row back out and says so. Either way the re-read
    // `onAccessChanged` triggers reconciles the list with the server.
    const tempId = `guest_temp-${crypto.randomUUID()}`;
    const provisional: Guest = {
      guestId: tempId,
      tripId,
      name,
      // The server's rule (access.ts): a named guest is coming.
      travelling: true,
      linkedUserId: null,
      // Never read: the POST's answer replaces this row before anything
      // could, and the row keeps the contract's shape rather than growing a
      // second, provisional type.
      createdBy: "",
      createdAt: "",
    };
    setGuests((current) => [...(current ?? []), provisional]);
    setGuestError(null);
    const ok = await runGuestWrite(
      () => createGuest(tripId, name),
      (list, answered) => list.map((g) => (g.guestId === tempId ? answered : g)),
    );
    if (ok) {
      setGuestName("");
      setGuestNameError(null);
      setAddingGuest(false);
    } else {
      // The write failed: the provisional row goes, and the error below says
      // what the server answered.
      setGuests((current) => (current ?? []).filter((g) => g.guestId !== tempId));
    }
  }

  async function toggleGuest(guest: Guest) {
    await runGuestWrite(
      () => updateGuest(tripId, guest.guestId, { travelling: !guest.travelling }),
      (list, answered) => list.map((g) => (g.guestId === answered.guestId ? answered : g)),
    );
  }

  async function linkGuestToMember(guest: Guest, userId: string) {
    if (
      await runGuestWrite(
        () => linkGuest(tripId, guest.guestId, userId),
        (list, answered) => list.map((g) => (g.guestId === answered.guestId ? answered : g)),
      )
    ) {
      setLinkingGuest(null);
    }
  }

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
      setRevealed({ inviteId: invite.inviteId, link });
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
      } else if (action.kind === "removeGuest") {
        // `removeGuest` answers the removed guest, so it leaves the list.
        await runGuestWrite(
          () => removeGuest(tripId, action.guest.guestId),
          (list, answered) => list.filter((g) => g.guestId !== answered.guestId),
        );
      } else if (action.kind === "unlinkGuest") {
        await runGuestWrite(
          () => unlinkGuest(tripId, action.guest.guestId),
          (list, answered) => list.map((g) => (g.guestId === answered.guestId ? answered : g)),
        );
      } else {
        // Leaving answers `{ ok: true }`, not the list: whoever left may no
        // longer read it. Home is where Home's own *Leave this trip* leaves
        // you (`(app)/home/page.tsx`), and this trip is no longer yours to look at.
        const result = await leaveTrip(tripId);
        if (result.ok) router.push(HOME_PATH);
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
  // mayManageGuests, client-side (guests spec P1): the owner or an editor.
  // Advisory — the v1 routes refuse regardless — the way `isOwner` gates the
  // invite button above while `POST /invites` refuses server-side.
  const canManageGuests = access?.myRole === "owner" || access?.myRole === "editor";
  // **Two conditions, and the second is M20 link 6.** Advisory only —
  // `POST /invites` refuses with 402 server-side whatever this decides.
  const collaboratorsEntitled = access?.collaboratorsEntitled ?? true;
  const gated = isOwner && !collaboratorsEntitled;
  // Everyone on this trip because they accepted an invite. When the owner is
  // not entitled these are the rows the server capped to `viewer` on read.
  const members = access?.members ?? [];
  const grantedCount = members.filter((m) => m.role !== "owner").length;
  const lapsed = gated && grantedCount > 0;
  // The split line below counts what the Part 2 overlay divides by — members
  // and travelling guests both, through `travellerIds`'s second argument
  // (`server/access/overlay.ts`). Guest ids are `guest_<uuid>`, so they never
  // collide with a member `userId`: the groups and toggle labels above read
  // the set exactly as before.
  const travelling = new Set(travellerIds(members, guests ?? []));
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
    const you = isYou(member);
    return (
      <PersonRow
        key={member.userId}
        member={member}
        name={name}
        isYou={you}
        colorNote={you ? shiftedColorTitle(member, members, chosenColor) : undefined}
        online={online?.has(member.userId)}
        menu={<PersonMenu label={name} actions={memberActions(member, name)} />}
      />
    );
  }

  function guestActions(guest: Guest): PersonAction[] {
    // A provisional row (its POST still in flight) has no server identity
    // yet: a toggle, link, or remove would send the client-minted id to the
    // server and 404. `PersonMenu` renders no trigger for an empty action
    // list, so the row shows the guest with no menu until the POST's answer
    // swaps in the real id.
    if (guest.guestId.startsWith("guest_temp-")) return [];
    const actions: PersonAction[] = [];
    if (canManageGuests) {
      actions.push({
        label: guest.travelling ? "Mark as not travelling" : "Mark as travelling",
        onSelect: () => void toggleGuest(guest),
      });
    }
    // mayLinkGuest: the owner for anyone, any other member for themselves.
    // The self-claim is identity, not content, so it is offered even where
    // the list is otherwise read-only — a viewer may claim their own record.
    if (isOwner) {
      if (guest.linkedUserId === null) {
        actions.push({ label: "Link to a member…", onSelect: () => setLinkingGuest(guest) });
      } else {
        const linked = members.find((m) => m.userId === guest.linkedUserId);
        actions.push({
          label: "Unlink…",
          destructive: true,
          onSelect: () =>
            setConfirming({
              kind: "unlinkGuest",
              guest,
              memberName: linked === undefined ? "that member" : displayNameFor(linked),
            }),
        });
      }
    } else if (
      viewerId !== null &&
      guest.linkedUserId === null &&
      members.some((m) => m.userId === viewerId)
    ) {
      actions.push({ label: "Claim as me", onSelect: () => void linkGuestToMember(guest, viewerId) });
    }
    // mayUnlinkGuest is owner-only, so a non-owner never sees Unlink: the
    // branch above is the whole of it.
    if (canManageGuests) {
      actions.push({
        label: "Remove guest…",
        destructive: true,
        onSelect: () => setConfirming({ kind: "removeGuest", guest }),
      });
    }
    return actions;
  }

  function renderGuest(guest: Guest) {
    const linked = guest.linkedUserId === null ? undefined : members.find((m) => m.userId === guest.linkedUserId);
    return (
      // `data-guest-id` lets a test assert identity alongside the name, the
      // way `data-user-id` does on a member row.
      <li
        key={guest.guestId}
        data-testid="guest-row"
        data-guest-id={guest.guestId}
        className="flex min-h-11 items-center gap-2.5 py-1"
      >
        {/* No avatar and no colour: a guest has no account, so the chip draws
            their initials on the default slate, and the badge says the rest. */}
        <PersonChip name={guest.name} avatar={null} color={null} size="sm" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-1.5">
            <Text as="span" className="truncate text-sm text-ink">
              {guest.name}
            </Text>
            <Badge className="shrink-0 px-1.5 py-0 font-medium">Guest</Badge>
          </span>
          <Text as="span" variant="muted">
            {guest.travelling ? "Travelling" : "Not travelling"}
            {linked === undefined ? null : ` · linked to ${displayNameFor(linked)}`}
          </Text>
        </div>
        <PersonMenu label={guest.name} actions={guestActions(guest)} />
      </li>
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
              label={inviteMenuLabel(invite)}
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
        : confirming.kind === "removeGuest"
          ? CONFIRM_COPY.removeGuest(confirming.guest.name)
          : confirming.kind === "unlinkGuest"
            ? CONFIRM_COPY.unlinkGuest(confirming.guest.name, confirming.memberName)
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
        ) : error === null ? (
          // Its line, held while the list loads (see the skeleton below).
          <span className="block text-xs">
            <Skeleton circle className="inline-block h-2.5 w-48 align-middle" />
          </span>
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
          answered — a failure is said below, not left breathing.

          **Each group as the loaded one draws it** (Mitchell, trip preview:
          Trip settings *"really reflows on loading"*): its `Travelling · 2`
          heading line over its rows, the rows at `PersonRow`'s own `min-h-11
          py-1` with no gap between them, and the groups at the section's
          `gap-3` — with the travellers line above held too. It was three rows
          at `gap-2` and no headings, so the list grew when it landed. */}
      {access === null && error === null ? (
        <SkeletonRegion label="Loading people" className="flex flex-col gap-3">
          <div className="flex flex-col">
            <span className="block text-xs">
              <Skeleton circle className="inline-block h-2.5 w-24 align-middle" />
            </span>
            {([1, 2] as const).map((row) => (
              <div key={row} className="flex min-h-11 items-center gap-2.5 py-1">
                <Skeleton circle className="size-7" delay={row} />
                <div className="flex flex-1 flex-col">
                  <span className="block text-sm">
                    <Skeleton className="inline-block h-3 w-28 align-middle" delay={row} />
                  </span>
                  <span className="block text-xs">
                    <Skeleton className="inline-block h-2.5 w-20 align-middle" delay={row} />
                  </span>
                </div>
              </div>
            ))}
          </div>
          <div data-testid="people-skeleton-invites" className="flex flex-col">
            <span className="block text-xs">
              <Skeleton circle className="inline-block h-2.5 w-20 align-middle" delay={3} />
            </span>
            <div className="flex min-h-11 items-center gap-2.5 py-1">
              <Skeleton circle className="size-7" delay={3} />
              <span className="block text-sm">
                <Skeleton className="inline-block h-3 w-32 align-middle" delay={3} />
              </span>
            </div>
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

      {/* Guests: named travellers with no account (guests spec P1). The list
          rides on the access read above; add, remove and the
          travelling toggle are `mayManageGuests` (owner or editor) — a viewer
          reads the list, and may only claim a record for themselves. */}
      <div className="flex flex-col gap-0.5">
        <div className="flex min-h-7 items-center justify-between gap-3">
          <Text
            as="span"
            id={`${ids}-guests`}
            className="text-xs font-semibold uppercase tracking-wider text-slate"
          >
            {guests === null ? "Guests" : `Guests · ${guests.length}`}
          </Text>
          {canManageGuests && !addingGuest ? (
            <Button variant="secondary" size="sm" onClick={() => setAddingGuest(true)}>
              <Plus className="size-3.5" aria-hidden />
              Add guest
            </Button>
          ) : null}
        </div>
        {addingGuest ? (
          <form
            className="flex flex-col gap-1.5 py-1"
            onSubmit={(e) => {
              e.preventDefault();
              void submitGuest();
            }}
          >
            <Label htmlFor={`${ids}-guest-name`} className="text-xs font-medium text-ink">
              Guest name
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id={`${ids}-guest-name`}
                className="min-w-0 flex-1"
                value={guestName}
                maxLength={120}
                placeholder="e.g. Grandma"
                autoComplete="off"
                onChange={(e) => setGuestName(e.target.value)}
              />
              <Button type="submit" variant="primary" size="sm" disabled={busy} className="shrink-0">
                Add
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="shrink-0"
                onClick={() => {
                  setAddingGuest(false);
                  setGuestName("");
                  setGuestNameError(null);
                }}
              >
                Cancel
              </Button>
            </div>
            {guestNameError !== null ? (
              <Text as="span" role="alert" className="text-xs text-danger-ink">
                {guestNameError}
              </Text>
            ) : null}
          </form>
        ) : null}
        {guests === null && guestError === null ? (
          // The section's own loading line, held like the members' above.
          <span className="block text-xs">
            <Skeleton className="inline-block h-3 w-32 align-middle" />
          </span>
        ) : (
          <ul aria-labelledby={`${ids}-guests`} className="flex flex-col">
            {(guests ?? []).map(renderGuest)}
          </ul>
        )}
        {guests !== null && guests.length === 0 ? (
          <Text as="span" variant="muted">
            No guests yet.
          </Text>
        ) : null}
        {guestError !== null ? (
          <Text as="span" role="alert" className="text-xs text-danger-ink">
            {guestError}
          </Text>
        ) : null}
      </div>

      {revealed !== null && pending.some((i) => i.inviteId === revealed.inviteId) ? (
        <div className="flex flex-col gap-1">
          <Text as="span" variant="muted">
            Couldn&apos;t reach your clipboard — copy this instead:
          </Text>
          <Input readOnly aria-label="Invite link" value={revealed.link} onFocus={(e) => e.target.select()} />
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
      {linkingGuest !== null ? (
        <GuestLinkDialog
          guestName={linkingGuest.name}
          members={members.map((m) => ({ userId: m.userId, name: displayNameFor(m) }))}
          busy={busy}
          onOpenChange={(open) => {
            if (!open) setLinkingGuest(null);
          }}
          onLink={(userId) => void linkGuestToMember(linkingGuest, userId)}
        />
      ) : null}
    </div>
  );
}
