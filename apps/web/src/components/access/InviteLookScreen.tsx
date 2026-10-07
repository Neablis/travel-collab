"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { InviteLanding, TripPreview } from "@tc/contracts";
import { FrontDoorHeader } from "@/components/front/FrontDoorHeader";
import { Button, buttonVariants } from "@/components/ui/button";
import { PageContainer } from "@/components/ui/page-container";
import { Text } from "@/components/ui/text";
import { fetchInviteLanding, fetchInvitePreview } from "@/lib/apiClient";
import { cn } from "@/lib/cn";
import { firstNameOf } from "@/lib/displayName";
import { useToday } from "@/lib/today";
import { SUGGESTER_APPROVAL } from "@/lib/tripRole";
import { InvitePlanCard, PreviewScope } from "./InvitePlanCard";
import { previewContext } from "./previewContext";
import { useInviteJoin } from "./useInviteJoin";

// *Have a look first* (M27 D12, SPEC §35.6 and §27), for somebody holding a
// pending invite — signed in or not.
//
// **The landing's own plan card, not the board** (M38, canvas open question 1,
// approved 2026-10-07). It used to mount the whole `TripBoardScreen` read-only
// as a synthetic viewer, and the board prints every stop's cost, which D4 hides
// from somebody who has not joined. So there is one pre-accept view of a trip,
// `InvitePlanCard` over the token-scoped preview, and this screen is that card
// under the look banner.

type ValidLanding = Extract<InviteLanding, { state: "valid" }>;

/**
 * *Have a look first*: resolves the invite and its preview, then draws the plan
 * card under the look banner — or returns to the landing when the invite is no
 * longer pending.
 */
export function InviteLookScreen({ token, googleAvailable }: { token: string; googleAvailable: boolean }) {
  const router = useRouter();
  const landingHref = `/invite/${encodeURIComponent(token)}`;
  const [look, setLook] = useState<{ landing: ValidLanding; preview: TripPreview } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    void Promise.all([fetchInviteLanding(token), fetchInvitePreview(token)]).then(([landing, preview]) => {
      if (!live) return;
      if (!landing.ok) {
        setFailed(true);
        return;
      }
      // Anything but a pending invite has nothing to look at — and the landing
      // is the screen that explains why (withdrawn, used, already a member).
      if (landing.value.state !== "valid") {
        router.replace(landingHref);
        return;
      }
      if (!preview.ok) {
        setFailed(true);
        return;
      }
      setLook({ landing: landing.value, preview: preview.value });
    });
    return () => {
      live = false;
    };
  }, [token, landingHref, router]);

  return (
    <>
      <FrontDoorHeader />
      {failed && (
        <PageContainer>
          <Text variant="secondary">
            This trip didn&apos;t open. Check your connection, then{" "}
            <Link href={landingHref}>go back to the invite</Link>.
          </Text>
        </PageContainer>
      )}
      {look !== null && (
        <>
          <LookBanner landing={look.landing} token={token} googleAvailable={googleAvailable} />
          <PageContainer as="main" width="measure" className="py-6 sm:py-8">
            <LookCard preview={look.preview} />
          </PageContainer>
        </>
      )}
    </>
  );
}

/** The plan card, against the reader's own day. */
function LookCard({ preview }: { preview: TripPreview }) {
  const today = useToday();
  const context = useMemo(() => previewContext(preview, today), [preview, today]);
  return (
    <PreviewScope context={context}>
      <InvitePlanCard preview={preview} context={context} />
    </PreviewScope>
  );
}

// What joining gives, by the role on offer. A `Record`, so a new invite role
// does not compile until the banner says what it may do.
const LOOK_LINE: Record<ValidLanding["role"], string> = {
  editor: "You're having a look first. Join and you can add stops, vote and comment alongside everyone else.",
  suggester: `You're having a look first. Join and you can suggest changes ${SUGGESTER_APPROVAL}.`,
  viewer: "You're having a look first. Join and this trip stays in your list as it takes shape.",
};

/** SPEC §35.6's variant of the §27 read-only banner: why you are here, and Join. */
function LookBanner({
  landing,
  token,
  googleAvailable,
}: {
  landing: ValidLanding;
  token: string;
  googleAvailable: boolean;
}) {
  const inviter = firstNameOf(landing.inviterName);
  const { join, joining, error } = useInviteJoin({
    token,
    signedIn: landing.signedIn,
    inviterName: inviter,
    googleAvailable,
  });
  return (
    <div className="flex flex-wrap items-center gap-3.5 border-b border-hairline bg-info-tint px-6.5 py-2.75">
      <span className="flex min-w-60 flex-1 flex-col gap-0.5">
        <Text as="span" className="font-semibold text-info-ink">
          {landing.inviterName} invited you to plan this trip
        </Text>
        <Text as="span" className="text-pretty text-xs text-info-ink opacity-85">
          {LOOK_LINE[landing.role]}
        </Text>
        {error !== null && (
          <Text as="span" role="alert" className="text-xs text-danger-ink">
            {error}
          </Text>
        )}
      </span>
      <span className="flex items-center gap-2">
        <Button variant="secondary" size="sm" disabled={joining} onClick={() => void join()}>
          {joining ? "Joining…" : "Join the trip"}
        </Button>
        <Link
          href={`/invite/${encodeURIComponent(token)}`}
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "no-underline")}
        >
          Back to the invite
        </Link>
      </span>
    </div>
  );
}
