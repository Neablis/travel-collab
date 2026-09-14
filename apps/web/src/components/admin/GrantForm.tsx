"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Text } from "@/components/ui/text";

// **Granting is the only write on the operator surface** (M20 link 7, and the
// 2026-09-02 amendment is explicit that it stays while publishing and
// migrating leave). Plan versions are a committed file and the tier panel on
// the page is read-only over them; grants are ACCOUNT STATE, not plan
// definition, and they are the entire reason this milestone is provable
// without Stripe.
//
// **No version field.** A grant pins the version that is live when it is
// issued, resolved server-side — an operator typing a version number is an
// operator who can type one that does not exist, and the failure would be a
// silent entitlement hole rather than a 400.
//
// **No price field either.** M20 never learns what a plan costs.
//
// The plan list is passed in rather than imported: this is a client component
// and the plan file is server-side. Disabled plans are not offered — `enabled`
// bounds what an operator may hand out, which is what lets the fourth-plan
// proof ship without anyone being able to receive it.
//
// **This lives in a dialog now, opened from an account's row** (Mitchell, on
// the #174 preview: *"Grants are spose to be a modal that is triggered off a
// button here"*). Two consequences, and the second is the one that matters:
//
//   * **Stacked, not a row.** It was a single `flex-wrap` row on the page,
//     which needed explicit widths to stop `Input`'s `w-full` wrapping every
//     field onto its own line. Inside a `max-w-md` dialog the column IS the
//     right shape and `w-full` is right again, so those widths are gone rather
//     than carried over — a fix for a layout that no longer exists is a
//     constraint nobody can explain later.
//   * **The account id is not typed.** Opened from a row, the account is
//     already known, so it is shown and not editable. That deletes the field an
//     operator was most likely to get wrong: a mistyped id is a valid-looking
//     grant handed to nobody, or to somebody else, and neither reports an
//     error. `userId` is still optional so a caller with no row context can ask
//     for it.
export function GrantForm({
  plans,
  userId: fixedUserId,
  onGranted,
}: {
  plans: readonly string[];
  userId?: string;
  onGranted?: () => void;
}) {
  const [typedUserId, setTypedUserId] = useState("");
  const [planId, setPlanId] = useState(plans[0] ?? "");
  const [expiresAt, setExpiresAt] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  // `useId` rather than hand-written ids: several of these can be mounted at
  // once (one dialog per account row), and duplicate ids would point every
  // label at the first row's field.
  const ids = useId();

  const userId = fixedUserId ?? typedUserId;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/grants", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: userId.trim(),
          planId,
          // An empty date means PERMANENT, and the copy below says so. The
          // wire field is nullable rather than optional because "forever" is a
          // decision an operator makes, and an omitted field would let one be
          // made by accident.
          expiresAt: expiresAt === "" ? null : new Date(expiresAt).toISOString(),
          reason: reason.trim(),
        }),
      });
      if (res.ok) {
        // **Re-read the server-rendered overview, then close.** Without the
        // refresh the page still shows the account's pre-grant row — its plan,
        // its grant history, its entitlements — and an operator would
        // reasonably read that as the grant having failed, and reissue it.
        // Caught by CodeRabbit on PR #174.
        //
        // Closing on success is deliberate: the refreshed row IS the
        // confirmation, and it is a better one than a sentence, because it is
        // the state rather than a claim about it. A refusal keeps the dialog
        // open, because a message nobody sees is the failure mode that matters.
        router.refresh();
        onGranted?.();
        return;
      }
      setMessage(`Refused (${res.status}).`);
    } catch {
      setMessage("The grant did not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="flex flex-col gap-3" onSubmit={(event) => void submit(event)}>
      {fixedUserId === undefined ? (
        <FormField id={`${ids}-user`} label="Account id">
          <Input
            id={`${ids}-user`}
            aria-label="Account id"
            placeholder="Account id"
            value={typedUserId}
            onChange={(event) => setTypedUserId(event.target.value)}
          />
        </FormField>
      ) : (
        <FormField id={`${ids}-user`} label="Account">
          {/* Shown, not editable. `break-all` because this is an Auth.js
              subject (ADR-025) and it is long enough to push the dialog wider
              than its cap if it is allowed to stay on one line. */}
          <Text as="span" id={`${ids}-user`} className="text-xs break-all text-ink">
            {fixedUserId}
          </Text>
        </FormField>
      )}

      <FormField id={`${ids}-plan`} label="Plan">
        <NativeSelect
          id={`${ids}-plan`}
          aria-label="Plan"
          className="w-full"
          value={planId}
          onChange={(event) => setPlanId(event.target.value)}
        >
          {plans.map((plan) => (
            <option key={plan} value={plan}>
              {plan}
            </option>
          ))}
        </NativeSelect>
      </FormField>

      <FormField
        id={`${ids}-expires`}
        label="Expires"
        hint="Leave empty for a permanent grant."
      >
        <Input
          id={`${ids}-expires`}
          aria-label="Expires"
          type="date"
          value={expiresAt}
          onChange={(event) => setExpiresAt(event.target.value)}
        />
      </FormField>

      <FormField
        id={`${ids}-reason`}
        label="Reason"
        hint="Recorded on the grant. A blank one is not an audit trail."
      >
        <Input
          id={`${ids}-reason`}
          aria-label="Reason"
          placeholder="Why"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </FormField>

      {/* The copy the design asks for: **the grant pins that version**, and it
          applies on the account's next request with no sign-out — which is what
          resolving per request from the database buys, and the property M20's
          gate box checks. */}
      <Text as="span" className="text-xs text-slate">
        The grant pins the version that is live now; publishing a newer one later does not move it.
        It applies on this account&apos;s next request — no sign-out, no token refresh.
      </Text>

      {message !== null && (
        <Text as="span" role="status" className="text-xs text-ink">
          {message}
        </Text>
      )}

      <div className="flex justify-end">
        <Button type="submit" variant="secondary" size="sm" disabled={busy}>
          Grant
        </Button>
      </div>
    </form>
  );
}
