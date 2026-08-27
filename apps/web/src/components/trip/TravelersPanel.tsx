"use client";

import { useCallback, useEffect, useState } from "react";
import type { InviteRole, TripAccess, TripInvite } from "@tc/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Text } from "@/components/ui/text";
import {
  createTripInvite,
  fetchTripAccess,
  inviteLink,
  revokeTripInvite,
} from "@/lib/apiClient";

// SPEC §8 lists "Travelers UI" as DELIBERATELY NOT DESIGNED, and M11 parks
// travelers inside Trip settings until it exists. So this invents as little as
// possible: the member rows are the same list the sheet already rendered, the
// controls are existing primitives on existing tokens (Input, NativeSelect,
// Button, Badge), and there is no new visual language to unpick when the real
// design lands. Expect this to be the surface most likely to be redesigned.

function displayName(member: TripAccess["members"][number]): string {
  return member.name ?? member.email ?? member.userId;
}

function statusLabel(invite: TripInvite): string {
  if (invite.status === "revoked") return "Revoked";
  if (invite.status === "accepted") return "Joined";
  return "Waiting";
}

export function TravelersPanel({ tripId }: { tripId: string }) {
  const [access, setAccess] = useState<TripAccess | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InviteRole>("editor");
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await fetchTripAccess(tripId);
    if (result.ok) setAccess(result.value);
    else setError(result.error.message);
  }, [tripId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleInvite(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const trimmed = email.trim();
    const result = await createTripInvite(tripId, {
      email: trimmed === "" ? null : trimmed,
      role,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setEmail("");
    // Copying is what actually delivers the invite — nothing sends email — so
    // the freshly minted link goes straight onto the clipboard rather than
    // making the owner hunt for it in the list that is about to re-render.
    await copy(result.value);
    await load();
  }

  async function copy(invite: TripInvite) {
    const link = inviteLink(invite.token);
    try {
      await navigator.clipboard.writeText(link);
      setCopied(invite.inviteId);
    } catch {
      // A denied clipboard permission is not an error worth a red banner: the
      // link is still on screen (title attribute) and still works.
      setCopied(null);
    }
  }

  async function handleRevoke(invite: TripInvite) {
    setBusy(true);
    const result = await revokeTripInvite(tripId, invite.inviteId);
    setBusy(false);
    if (!result.ok) setError(result.error.message);
    await load();
  }

  const canInvite = access?.myRole === "owner";
  const pending = (access?.invites ?? []).filter((i) => i.status === "pending");

  return (
    <div className="flex flex-col gap-3" data-testid="travelers-panel">
      <div className="flex flex-col gap-1.5">
        {(access?.members ?? []).map((member) => (
          <div key={member.userId} className="flex items-center justify-between gap-3">
            <Text as="span" className="text-xs text-ink">
              {displayName(member)}
            </Text>
            <Badge variant={member.role === "owner" ? "brand" : "neutral"}>{member.role}</Badge>
          </div>
        ))}
      </div>

      {canInvite && (
        <form className="flex flex-col gap-2" onSubmit={(e) => void handleInvite(e)}>
          <div className="flex items-center gap-2">
            <Input
              aria-label="Invite by email"
              placeholder="name@example.com"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="flex-1"
            />
            <NativeSelect
              aria-label="Invite role"
              value={role}
              onChange={(e) => setRole(e.target.value as InviteRole)}
            >
              <option value="editor">Can edit</option>
              <option value="viewer">Can view</option>
            </NativeSelect>
          </div>
          <Button type="submit" variant="secondary" size="sm" disabled={busy}>
            Invite someone
          </Button>
          {/* Said once, plainly: the link IS the invite. Nothing emails it. */}
          <Text as="span" className="text-xs text-slate">
            Creates a link and copies it — send it however you like.
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

      {error !== null && (
        <Text as="span" className="text-xs text-danger-ink">
          {error}
        </Text>
      )}
    </div>
  );
}
