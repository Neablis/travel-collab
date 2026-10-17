"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AdminTestMode } from "@tc/contracts";
import { CheckboxField } from "@/components/ui/checkbox";
import { Text } from "@/components/ui/text";

// **Stripe test mode, per account** (ADR-076 §6), on the account page. On, the
// account's new checkouts and its portal use Stripe's test keys, so an
// operator can walk a paid flow on production with a test card.
//
// The first state comes from the server render, as the grants' does; the PUT
// answers with what is now stored, and the page re-reads so the history agrees.
// A refusal leaves the box where it was and says which way it missed, as
// `AccountGrants` does for a revoke.

const ON = "Checkouts from this account use Stripe test mode. Nothing it buys counts as revenue.";
// Off reaches new checkouts only: a test subscription keeps its own mode until
// it ends (ADR-076 §6), and an operator back from a walk must not read "live".
const OFF =
  "Off: new checkouts from this account take real cards. A test subscription it already holds keeps running in test mode until it ends.";
// Unavailable is either no test pair or a broken one (PR 476), so this names
// neither.
const UNAVAILABLE = "Stripe test keys are not set up on this deployment, so there is nothing to switch to.";

/** What the operator is told when a PUT did not land. */
function refusalOf(status: number, code: string | null): string {
  if (status === 409 && code === "test-mode-unavailable") {
    return "Stripe test keys are no longer set up on this deployment. Nothing changed.";
  }
  if (status === 404 && code === "not-found") return "Your session ended. Nothing changed.";
  return `The server refused the change (${status}). Nothing changed.`;
}

/** The account's test-mode switch, as a labelled checkbox. */
export function AccountTestMode({ accountId, initial }: { accountId: string; initial: AdminTestMode }) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  async function change(enabled: boolean) {
    setBusy(true);
    setFailed(null);
    try {
      // eslint-disable-next-line no-restricted-globals -- an app API call with no client helper yet; moves onto the client with the collapse still open in KI-2026-09-05-q
      const res = await fetch(`/api/admin/accounts/${encodeURIComponent(accountId)}/test-mode`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const body: unknown = await res.json().catch(() => null);
      const stored = res.ok ? AdminTestMode.safeParse(body) : null;
      if (stored?.success !== true) {
        const code = typeof body === "object" && body !== null ? (body as { error?: unknown }).error : null;
        setFailed(refusalOf(res.status, typeof code === "string" ? code : null));
        return;
      }
      setState(stored.data);
      router.refresh();
    } catch {
      setFailed("The change didn't reach the server. Nothing changed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5 border-t border-hairline pt-3">
      <CheckboxField
        title="Stripe test mode"
        description={state.enabled ? ON : state.available ? OFF : UNAVAILABLE}
        checked={state.enabled}
        // Off stays reachable with no test keys: a switch left on after they
        // were removed must not be stuck on.
        disabled={!state.available && !state.enabled}
        // Busy is announced, not `disabled`: disabling the focused box drops
        // keyboard focus to the page while the request is in flight.
        aria-disabled={busy || undefined}
        onCheckedChange={(enabled) => {
          if (!busy) void change(enabled);
        }}
      />
      {failed !== null && (
        <Text as="span" role="alert" className="text-sm text-danger-ink">
          {failed}
        </Text>
      )}
    </div>
  );
}
