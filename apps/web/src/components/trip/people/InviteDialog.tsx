"use client";

import { useState } from "react";
import Link from "next/link";
import type { InviteRole, TripInvite } from "@tc/contracts";
import { Button, buttonVariants } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/checkbox";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { createTripInvite, inviteLink } from "@/lib/apiClient";
import { RolePicker } from "./RoleDialog";

// D3: an editor is usually coming; a suggester or a viewer is usually advising
// from home — #314's suggester doubled every per-person total by joining. The
// owner can flip it before sending.
const travelsByDefault = (role: InviteRole) => role === "editor";

/**
 * `+ Invite` (spec §4): an optional address, a role, whether they are coming,
 * and **Create invite**. On success it shows the link with a Copy, having
 * already copied it — the link is the invite, and an email can fail or be
 * unconfigured.
 *
 * `gated` is an owner without `trip.collaborators`: the form stays on screen,
 * disabled, and the way to upgrade takes Create invite's place (Mitchell,
 * 2026-09-15: *"keep the ui but have it greyed out, and have a CTA"*).
 */
export function InviteDialog({
  tripId,
  open,
  onOpenChange,
  gated,
  onCreated,
}: {
  tripId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  gated: boolean;
  onCreated: (invite: TripInvite) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Invite someone">
      {/* Inside the dialog's content, which Radix unmounts on close, so the
          next invite starts from an empty form rather than the last one's
          address and link. */}
      <InviteForm tripId={tripId} gated={gated} onCreated={onCreated} onDone={() => onOpenChange(false)} />
    </Dialog>
  );
}

function InviteForm({
  tripId,
  gated,
  onCreated,
  onDone,
}: {
  tripId: string;
  gated: boolean;
  onCreated: (invite: TripInvite) => void;
  onDone: () => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InviteRole>("editor");
  const [travelling, setTravelling] = useState(travelsByDefault("editor"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ invite: TripInvite; link: string } | null>(null);
  const [copy, setCopy] = useState<"copied" | "denied" | null>(null);

  function chooseRole(next: InviteRole) {
    setRole(next);
    setTravelling(travelsByDefault(next));
  }

  async function copyLink(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopy("copied");
    } catch {
      // A denied clipboard permission is not an error worth a red banner. The
      // link is already on screen as selectable text; this says to use it.
      setCopy("denied");
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    // The gated form cannot submit — its controls are disabled and it has no
    // submit button — but the rule belongs where the send happens. The
    // endpoint refuses with 402 regardless.
    if (gated) return;
    setBusy(true);
    setError(null);
    const trimmed = email.trim();
    // `busy` is released in `finally`, after the copy — a second click while
    // the first was still copying minted a second invite (CodeRabbit, PR #70).
    try {
      const result = await createTripInvite(tripId, { email: trimmed === "" ? null : trimmed, role, travelling });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      const link = inviteLink(result.value.token);
      setCreated({ invite: result.value, link });
      onCreated(result.value);
      await copyLink(link);
    } finally {
      setBusy(false);
    }
  }

  if (created !== null) {
    return (
      <div className="flex flex-col gap-3">
        {created.invite.email !== null ? (
          <Text variant="secondary">Emailed to {created.invite.email}.</Text>
        ) : null}
        <Text variant="muted">
          {copy === "denied"
            ? "Couldn’t reach your clipboard — copy this instead:"
            : "Anyone with this link can join the trip until you revoke it."}
        </Text>
        <div className="flex items-center gap-2">
          <Input
            readOnly
            aria-label="Invite link"
            value={created.link}
            onFocus={(e) => e.target.select()}
            className="flex-1"
          />
          <Button
            variant="secondary"
            size="sm"
            aria-label="Copy invite link"
            onClick={() => void copyLink(created.link)}
          >
            {copy === "copied" ? "Copied" : "Copy"}
          </Button>
        </div>
        <DialogFooter>
          <Button variant="primary" size="sm" onClick={onDone}>
            Done
          </Button>
        </DialogFooter>
      </div>
    );
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => void handleSubmit(e)}>
      {/* A native `fieldset disabled` reaches every control inside, the
          segmented control's buttons included — the precedent is
          `TripMoneySettings`. */}
      <fieldset disabled={gated} className="flex flex-col gap-4 border-0 p-0">
        <FormField id="invite-email" label="Email (optional)" hint="We’ll send the link there too.">
          <Input
            id="invite-email"
            type="email"
            placeholder="name@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </FormField>
        <RolePicker value={role} onChange={chooseRole} />
        <CheckboxField
          checked={travelling}
          onCheckedChange={setTravelling}
          title="Coming on the trip"
          description="Travellers are who costs are split across."
        />
      </fieldset>
      {error !== null ? (
        <Text as="span" className="text-xs text-danger-ink">
          {error}
        </Text>
      ) : null}
      {gated ? (
        // **Still no price here.** §29 puts prices on `plans` and nowhere else.
        <div className="flex flex-col gap-2 rounded-lg border border-brand bg-brand-tint p-3">
          <Text as="span" className="text-sm text-brand-pressed">
            Inviting people to a trip is part of Premium.
          </Text>
          <Link href="/plans" className={buttonVariants({ variant: "primary", size: "sm" }) + " self-start"}>
            See plans
          </Link>
        </div>
      ) : (
        <DialogFooter>
          <Button type="submit" variant="primary" size="sm" disabled={busy}>
            Create invite
          </Button>
        </DialogFooter>
      )}
    </form>
  );
}
