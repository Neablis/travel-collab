"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Heading } from "@/components/ui/heading";
import { Text } from "@/components/ui/text";
import { FrontDoorHeader } from "@/components/front/FrontDoorHeader";
import { checkWithPasskey, type PasskeyCheck } from "@/lib/mfaClient";
import { clearSignedInHint } from "@/lib/sessionHint";

// The second step after Google (M62 D3a). It opens with the passkey prompt already
// up, so on a phone the whole step is one Face ID; if the prompt is closed, the
// person is left with a button to bring it back rather than a dead end.
//
// Authenticator codes and recovery codes are part 3: their buttons are left out
// until the routes behind them exist, rather than shown disabled, because an
// account can only hold a passkey until then and a greyed option would suggest
// otherwise.
//
// `callbackUrl` arrives already through `safeCallbackUrl` (`signin/verify/page.tsx`).
/** The verify step of sign-in for an account that asks for a second factor. */
export function VerifyScreen({ callbackUrl }: { callbackUrl: string }) {
  const router = useRouter();
  const [outcome, setOutcome] = useState<PasskeyCheck | "asking">("asking");
  // The ref, not the state, is what stops a second prompt: React runs an effect
  // twice in development, and two prompts at once is one the browser refuses.
  const inFlight = useRef(false);

  async function ask() {
    if (inFlight.current) return;
    inFlight.current = true;
    setOutcome("asking");
    const result = await checkWithPasskey();
    inFlight.current = false;
    setOutcome(result);
    if (result === "passed" || result === "not-required") router.replace(callbackUrl);
    // Nothing on this screen can work without a session behind the cookie. The
    // route clears it, then sends the person to sign in with where they were going.
    else if (result === "signed-out") window.location.assign(`/api/session-expired?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  }

  useEffect(() => {
    void ask();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival; `ask` is re-made each render and only ever reads state through setters
  }, []);

  const busy = outcome === "asking" || outcome === "passed" || outcome === "not-required" || outcome === "signed-out";
  return (
    <div className="flex min-h-screen flex-col bg-paper text-ink">
      <FrontDoorHeader />
      <main className="grid flex-1 place-items-center px-6 pt-3 pb-20">
        <div className="flex w-full max-w-101 flex-col gap-4.5">
          <div className="flex flex-col gap-2">
            <Heading level={1}>Confirm it&rsquo;s you</Heading>
            <Text as="p" variant="secondary" className="text-pretty">
              Your account asks for a second step after Google.
            </Text>
          </div>
          {outcome === "refused" ? (
            <Banner variant="danger">That passkey did not work. Try again.</Banner>
          ) : null}
          {outcome === "cancelled" ? (
            // Safari refuses the prompt this screen opens on its own (no tap started it) and says so as "cancelled".
            <Text as="p" variant="secondary">
              Tap Use a passkey to continue.
            </Text>
          ) : null}
          {outcome === "unavailable" ? (
            <Banner variant="danger">This account has no passkey to use.</Banner>
          ) : null}
          <Card raised className="flex flex-col gap-3.5">
            <Button type="button" variant="primary" pending={busy} onClick={() => void ask()}>
              Use a passkey
            </Button>
          </Card>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="self-center"
            onClick={() => {
              clearSignedInHint();
              void signOut({ callbackUrl: "/" });
            }}
          >
            Sign out
          </Button>
        </div>
      </main>
    </div>
  );
}
