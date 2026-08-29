"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { InvitePreview } from "@tc/contracts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Heading } from "@/components/ui/heading";
import { PageContainer } from "@/components/ui/page-container";
import { Text } from "@/components/ui/text";
import { acceptInvite, fetchInvitePreview } from "@/lib/apiClient";

// What a person sees when they follow an invite link. Deliberately one card
// and one button: the decision is binary, and every other affordance on this
// screen would be a way to not make it.

const ROLE_COPY: Record<InvitePreview["role"], string> = {
  editor: "You'll be able to change the plan.",
  viewer: "You'll be able to look, but not change anything.",
};

export function InviteAcceptScreen({ token }: { token: string }) {
  const router = useRouter();
  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const result = await fetchInvitePreview(token);
    if (result.ok) {
      setInvite(result.value);
      return;
    }
    // Clear the invite as well as setting the error. A refused preview is the
    // authoritative answer that this link offers nothing, and the re-read in
    // `join()` below is the case that makes it matter: the server now refuses
    // a spent or revoked token outright (PR #71 review §7), so a lost race
    // comes back `!ok` rather than as a preview whose status changed. Leaving
    // the previous preview in place would keep "Join this trip" on screen with
    // an error line under it, offering a button that cannot work.
    setInvite(null);
    setError(result.error.message);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function join() {
    setBusy(true);
    setError(null);
    const result = await acceptInvite(token);
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      // Re-read: "already used" and "revoked" both change what this screen
      // should be offering, and the preview is what knows which.
      await load();
      return;
    }
    router.push(`/trips/${result.value.tripId}`);
  }

  if (error !== null && invite === null) {
    return (
      <PageContainer>
        <Card className="flex flex-col gap-3 p-6">
          <Heading level={1}>This invite doesn&apos;t work</Heading>
          <Text variant="secondary">{error}</Text>
          <div>
            <Button variant="secondary" onClick={() => router.push("/")}>
              Go to your trips
            </Button>
          </div>
        </Card>
      </PageContainer>
    );
  }

  if (invite === null) {
    return (
      <PageContainer>
        <Text variant="secondary">Checking this invite…</Text>
      </PageContainer>
    );
  }

  // Belt and braces. `previewInvite` refuses a non-pending token before it
  // reaches this screen unless the viewer is already a member, so with the
  // current server this is unreachable — it stays as the fallback for a
  // preview that reports a status the server did not gate on.
  const spent = invite.status !== "pending" && !invite.alreadyMember;

  return (
    <PageContainer>
      <Card className="flex flex-col gap-3 p-6">
        <Heading level={1}>{invite.tripName}</Heading>
        <Text variant="secondary">
          {invite.invitedByName === null
            ? "You've been invited to this trip."
            : `${invite.invitedByName} invited you to this trip.`}
        </Text>
        <Text variant="secondary">{ROLE_COPY[invite.role]}</Text>

        {invite.alreadyMember ? (
          <div>
            <Button variant="primary" onClick={() => router.push(`/trips/${invite.tripId}`)}>
              Open the trip
            </Button>
          </div>
        ) : spent ? (
          <Text variant="secondary">
            {invite.status === "revoked"
              ? "This invite has been revoked."
              : "This invite has already been used."}
          </Text>
        ) : (
          <div>
            <Button variant="primary" disabled={busy} onClick={() => void join()}>
              Join this trip
            </Button>
          </div>
        )}

        {error !== null && (
          <Text as="span" className="text-xs text-danger-ink">
            {error}
          </Text>
        )}
      </Card>
    </PageContainer>
  );
}
