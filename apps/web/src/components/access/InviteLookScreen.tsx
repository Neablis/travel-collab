"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { InviteLanding } from "@tc/contracts";
import { TripBoardScreen } from "@/components/board/TripBoardScreen";
import { FrontDoorHeader } from "@/components/front/FrontDoorHeader";
import { EditorHost } from "@/components/trip/context/EditorHost";
import { FocusProvider } from "@/components/trip/context/FocusProvider";
import { LensRouter } from "@/components/trip/context/LensRouter";
import { TripProvider } from "@/components/trip/context/TripProvider";
import { Button, buttonVariants } from "@/components/ui/button";
import { PageContainer } from "@/components/ui/page-container";
import { Text } from "@/components/ui/text";
import { fetchInviteLanding } from "@/lib/apiClient";
import { cn } from "@/lib/cn";
import { beginInviteLook } from "@/lib/inviteLook";
import { invalidate } from "@/lib/queryCache";
import { tripKeys } from "@/lib/queryKeys";
import { useInviteJoin } from "./useInviteJoin";

// *Have a look first* (M27 D12, SPEC §35.6 and §27): the real trip, read-only,
// for somebody holding a pending invite — signed in or not.
//
// The same provider stack `/demo` and `/trips/:id` mount, around the same
// board (`DemoTripScreen.tsx` is the template). Read-only is not enforced in
// this file, for the reason it is not enforced in the demo's: the server
// answers these reads as a synthetic VIEWER (`requireTripAccess`'s
// `inviteToken`), and `TripProvider` already withholds a viewer's writes. The
// only things this screen adds are the banner and the scope that makes the
// board's reads carry the token.

type ValidLanding = Extract<InviteLanding, { state: "valid" }>;

/**
 * *Have a look first*: resolves the invite, then mounts the ordinary board
 * read-only under the look banner — or returns to the landing when the invite
 * is no longer pending.
 */
export function InviteLookScreen({ token, googleAvailable }: { token: string; googleAvailable: boolean }) {
  const router = useRouter();
  const landingHref = `/invite/${encodeURIComponent(token)}`;
  const [landing, setLanding] = useState<ValidLanding | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    void fetchInviteLanding(token).then((result) => {
      if (!live) return;
      if (!result.ok) {
        setFailed(true);
        return;
      }
      // Anything but a pending invite has nothing to look at — and the landing
      // is the screen that explains why (withdrawn, used, already a member).
      if (result.value.state !== "valid") {
        router.replace(landingHref);
        return;
      }
      setLanding(result.value);
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
      {landing !== null && (
        <>
          <LookBanner landing={landing} token={token} googleAvailable={googleAvailable} />
          <PageContainer as="main" width="full" className="px-0">
            <InviteLookScope tripId={landing.tripId} token={token}>
              {/* `LensRouter` reads `useSearchParams()`; see DemoTripScreen for why
                  that needs a Suspense boundary. */}
              <Suspense fallback={null}>
                <TripProvider tripId={landing.tripId}>
                  <FocusProvider>
                    <EditorHost>
                      <LensRouter>
                        <TripBoardScreen tripId={landing.tripId} />
                      </LensRouter>
                    </EditorHost>
                  </FocusProvider>
                </TripProvider>
              </Suspense>
            </InviteLookScope>
          </PageContainer>
        </>
      )}
    </>
  );
}

/**
 * Makes this trip's reads carry the invite token, for exactly as long as the
 * board is mounted — and renders nothing until that is true.
 *
 * The gate is the point. A child's effects run BEFORE its parent's, so
 * registering in an effect here while rendering `TripProvider` alongside would
 * let the provider's first reads leave without the header and come back 401.
 *
 * The trip's cache is dropped on the way in and on the way out. In, because a
 * member's cached reads of this trip (an editor's `access`, say) must not
 * answer a surface built to be read-only; out, because the viewer role cached
 * here must not answer the writable board this person lands on after joining.
 */
function InviteLookScope({ tripId, token, children }: { tripId: string; token: string; children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    invalidate(tripKeys.all(tripId));
    const end = beginInviteLook(tripId, token);
    setReady(true);
    return () => {
      end();
      invalidate(tripKeys.all(tripId));
    };
  }, [tripId, token]);
  return ready ? <>{children}</> : null;
}

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
  const inviter = landing.inviterName.trim().split(/\s+/)[0] ?? landing.inviterName;
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
          {landing.role === "editor"
            ? "You're having a look first. Join and you can add stops, vote and comment alongside everyone else."
            : "You're having a look first. Join and this trip stays in your list as it takes shape."}
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
