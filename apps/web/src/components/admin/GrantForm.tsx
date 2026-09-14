"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Text } from "@/components/ui/text";

// **Granting is the only write on the operator surface** (M20 link 7, and the
// 2026-09-02 amendment is explicit that it stays while publishing and
// migrating leave). Plan versions are a committed file and the tier panel
// above this is read-only over them; grants are ACCOUNT STATE, not plan
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
// **Every field carries an explicit width, and that is not decoration.** The
// row below is `flex-wrap` and always was, but `Input` is `w-full` by design —
// which is right for a stacked form and wrong here: a `w-full` flex item takes
// a 100% basis, so each of the three inputs claimed a whole line and wrapped
// the next one under it. The markup said "row" and the widths said "column",
// and the widths win. Reported by Mitchell on the PR #174 preview at 1728px,
// where nothing about the JSX suggests it — the same class of defect as KI-16
// and KI-19, which is why the e2e walk now asserts the controls share a row by
// comparing their positions rather than by reading their classes.

export function GrantForm({ plans }: { plans: readonly string[] }) {
  const [userId, setUserId] = useState("");
  const [planId, setPlanId] = useState(plans[0] ?? "");
  const [expiresAt, setExpiresAt] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

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
      setMessage(
        res.ok
          ? "Granted. It applies on this account's next request — no sign-out, no token refresh."
          : `Refused (${res.status}).`,
      );
      // **Re-read the server-rendered overview.** Without this the page still
      // shows the account's pre-grant row — its plan, its grant history, its
      // entitlements — while the message above says the grant landed. An
      // operator would reasonably read that as the grant having failed, and
      // reissue it. Caught by CodeRabbit on PR #174.
      if (res.ok) router.refresh();
    } catch {
      setMessage("The grant did not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="flex flex-col gap-2" onSubmit={(event) => void submit(event)}>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Account id"
          placeholder="Account id"
          // Wide enough for an Auth.js subject, which is what an account id is
          // here (ADR-025) — it is pasted, not typed, and a box that truncates
          // it invites pasting half of one.
          className="w-64"
          value={userId}
          onChange={(event) => setUserId(event.target.value)}
        />
        <NativeSelect
          aria-label="Plan"
          value={planId}
          onChange={(event) => setPlanId(event.target.value)}
        >
          {plans.map((plan) => (
            <option key={plan} value={plan}>
              {plan}
            </option>
          ))}
        </NativeSelect>
        <Input
          aria-label="Expires"
          type="date"
          className="w-40"
          value={expiresAt}
          onChange={(event) => setExpiresAt(event.target.value)}
        />
        <Input
          aria-label="Reason"
          placeholder="Why"
          // The one field that should absorb the leftover width: it holds a
          // sentence, and it is the grant's audit trail. `min-w-0` so it can
          // shrink below its content instead of forcing a wrap.
          className="min-w-0 flex-1"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
        <Button type="submit" variant="secondary" size="sm" disabled={busy}>
          Grant
        </Button>
      </div>
      {/* The copy the design asks for: **the grant pins that version**, and it
          applies on the account's next request with no sign-out — which is what
          resolving per request from the database buys, and the property M20's
          gate box checks. */}
      <Text as="span" className="text-xs text-slate">
        The grant pins the version that is live now; publishing a newer one later does not move it.
        Leave the date empty for a permanent grant.
      </Text>
      {message !== null && (
        <Text as="span" role="status" className="text-xs text-ink">
          {message}
        </Text>
      )}
    </form>
  );
}
