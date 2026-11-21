"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/checkbox";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Text } from "@/components/ui/text";
import { Textarea } from "@/components/ui/textarea";
import type { AdminAccountDetail } from "@/lib/adminAccount";
import { dayLabel } from "./accountFormat";

// **Reset two-step sign-in** (M62 D9, D15), on the account page: the one way back
// for an account that lost every factor and every recovery code. Reset stays
// shut until there is a reason and the tick that the account's own email asked
// for it, since those two are the whole record of why it was done. Every reset
// is listed under it with who did it, so the next operator can see it happened.

/** What the operator is told when the POST did not land. */
function refusalOf(status: number, code: string | null): string {
  if (status === 409 && code === "mfa-not-enabled") return "Two-step sign-in is already off. Nothing changed.";
  if (status === 409 && code === "no-email-on-account") {
    return "This account has no email address to have confirmed with. Nothing changed.";
  }
  if (status === 404 && code === "not-found") return "Your session ended. Nothing changed.";
  return `The server refused the reset (${status}). Nothing changed.`;
}

/** The account's two-step state, its resets, and the Reset dialog. */
export function AccountMfaReset({
  accountId,
  account,
  mfa,
  now,
}: {
  accountId: string;
  /** The address the page heads with; the dialog names it so the reset lands where meant. */
  account: string;
  mfa: AdminAccountDetail["mfa"];
  /** ISO, from the server render. */
  now: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  async function reset() {
    setBusy(true);
    setFailed(null);
    try {
      // eslint-disable-next-line no-restricted-globals -- an app API call with no client helper yet; moves onto the client with the collapse still open in KI-2026-09-05-q
      const res = await fetch(`/api/admin/accounts/${encodeURIComponent(accountId)}/mfa-reset`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: reason.trim(), confirmed }),
      });
      if (!res.ok) {
        const body: unknown = await res.json().catch(() => null);
        const code = typeof body === "object" && body !== null ? (body as { error?: unknown }).error : null;
        setFailed(refusalOf(res.status, typeof code === "string" ? code : null));
        return;
      }
      setOpen(false);
      setReason("");
      setConfirmed(false);
      router.refresh();
    } catch {
      setFailed("The reset didn't reach the server. Nothing changed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Text className="text-sm text-ink">
          {mfa.enabled ? `On · ${mfa.factors} ${mfa.factors === 1 ? "factor" : "factors"}` : "Off"}
        </Text>
        {mfa.enabled && (
          <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
            Reset two-step sign-in
          </Button>
        )}
      </div>

      {mfa.resets.length > 0 && (
        <ol aria-label="Resets" className="flex flex-col">
          {mfa.resets.map((entry, index) => (
            <li key={`${entry.at}-${index}`} className="flex items-baseline gap-2.5 border-t border-hairline py-1.5">
              <span className="w-18 shrink-0 font-mono text-xs text-slate">{dayLabel(entry.at, now)}</span>
              <span className="text-sm text-ink">
                {entry.reason} <span className="text-slate">· by {entry.operator}</span>
              </span>
            </li>
          ))}
        </ol>
      )}

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setFailed(null);
        }}
        title="Reset two-step sign-in"
        description={`Removes every passkey, authenticator app and recovery code on ${account}, turns two-step sign-in off and signs out all of its sessions. The account is emailed.`}
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy) void reset();
          }}
        >
          <FormField id="mfa-reset-reason" label="Reason">
            <Textarea id="mfa-reset-reason" value={reason} onChange={(event) => setReason(event.target.value)} />
          </FormField>
          <CheckboxField
            title="I confirmed this by email with the account’s Google address"
            description={account}
            checked={confirmed}
            onCheckedChange={setConfirmed}
          />
          {failed !== null && (
            <Text as="span" role="alert" className="text-sm text-danger-ink">
              {failed}
            </Text>
          )}
          <DialogFooter>
            <Button type="submit" variant="destructive" disabled={busy || reason.trim() === "" || !confirmed}>
              Reset
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
    </div>
  );
}
