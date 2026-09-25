"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import type { AdminGrantRow } from "@/lib/adminOverview";

// One account's active grants, with the console's second write: **revoke**
// (M20 link 7 — *"grant a plan's entitlements to an account with an expiry;
// revoke a grant"*).
//
// **Revoking marks, it never deletes.** The row is what answers *"has this
// account ever held a trial"*, and removing it would hand the trial back to
// whoever had it revoked. The endpoint stamps `revoked_at` and `revoked_by`;
// this list simply stops showing the row, because an inactive grant has
// nothing left to revoke and a button for one would do nothing.
export function GrantList({ grants }: { grants: readonly AdminGrantRow[] }) {
  const [revoked, setRevoked] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const router = useRouter();

  async function revoke(grantId: string) {
    setBusy(grantId);
    try {
      // eslint-disable-next-line no-restricted-globals -- an app API call with no client helper yet; moves onto the client with the collapse still open in KI-2026-09-05-q
      const res = await fetch("/api/admin/grants", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ grantId }),
      });
      if (res.ok) {
        // Hidden locally AND re-read from the server. The local set is what
        // makes the row disappear immediately; the refresh is what makes every
        // OTHER cell agree with it — revoking a grant changes that account's
        // effective entitlements, and leaving those stale shows an account that
        // can still do something it no longer can. Caught by CodeRabbit on
        // PR #174.
        setRevoked((current) => new Set(current).add(grantId));
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  }

  const live = grants.filter((grant) => !revoked.has(grant.id));
  if (live.length === 0) return <Text as="span" className="text-xs text-slate">—</Text>;

  return (
    <ul className="flex flex-col gap-1">
      {live.map((grant) => (
        <li key={grant.id} className="flex items-center gap-2">
          <Text as="span" className="text-xs text-ink">
            {grant.source} · {grant.planVersionRef} ·{" "}
            {/* Null is PERMANENT, which is what a founder grant is — said in a
                word rather than shown as a blank cell. */}
            {grant.expiresAt === null ? "permanent" : grant.expiresAt.slice(0, 10)}
          </Text>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy === grant.id}
            onClick={() => void revoke(grant.id)}
          >
            Revoke
          </Button>
        </li>
      ))}
    </ul>
  );
}
