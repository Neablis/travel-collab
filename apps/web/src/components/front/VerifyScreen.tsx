"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Heading } from "@/components/ui/heading";
import { Text } from "@/components/ui/text";
import { CodeEntryForm, type CodeKind } from "@/components/front/CodeEntryForm";
import { FrontDoorHeader } from "@/components/front/FrontDoorHeader";
import { checkWithCode, checkWithPasskey, type CodeCheck, type PasskeyCheck } from "@/lib/mfaClient";
import { clearSignedInHint } from "@/lib/sessionHint";

// The second step after Google (M62 D3a). It opens with the passkey prompt already
// up, so on a phone the whole step is one Face ID; if the prompt is closed, the
// person is left with a button to bring it back rather than a dead end.
//
// An authenticator code or a recovery code is one tap away. An account with no
// passkey has nothing for the prompt to ask, so it opens on the code field and the
// passkey is not offered. Five wrong codes lock codes, not passkeys (D13), which is
// why the lock message points back at the passkey.
//
// `callbackUrl` arrives already through `safeCallbackUrl` (`signin/verify/page.tsx`).
/** The verify step of sign-in for an account that asks for a second factor. */
export function VerifyScreen({ callbackUrl }: { callbackUrl: string }) {
  const router = useRouter();
  const [outcome, setOutcome] = useState<PasskeyCheck | "asking">("asking");
  const [mode, setMode] = useState<"passkey" | CodeKind>("passkey");
  const [codeOutcome, setCodeOutcome] = useState<CodeCheck | "checking" | null>(null);
  // The ref, not the state, is what stops a second prompt: React runs an effect
  // twice in development, and two prompts at once is one the browser refuses.
  const inFlight = useRef(false);

  async function ask() {
    if (inFlight.current) return;
    inFlight.current = true;
    setMode("passkey");
    setOutcome("asking");
    const result = await checkWithPasskey();
    inFlight.current = false;
    setOutcome(result);
    if (result === "unavailable") setMode("otp");
    if (result === "passed" || result === "not-required") router.replace(callbackUrl);
    // Nothing on this screen can work without a session behind the cookie. The
    // route clears it, then sends the person to sign in with where they were going.
    else if (result === "signed-out") window.location.assign(`/api/session-expired?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  }

  async function submitCode(kind: CodeKind, code: string) {
    setCodeOutcome("checking");
    const result = await checkWithCode(kind, code);
    setCodeOutcome(result);
    if (result === "passed") router.replace(callbackUrl);
  }

  function chooseCode(kind: CodeKind) {
    setCodeOutcome(null);
    setMode(kind);
  }

  useEffect(() => {
    void ask();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival; `ask` is re-made each render and only ever reads state through setters
  }, []);

  const busy = outcome === "asking" || outcome === "passed" || outcome === "not-required" || outcome === "signed-out";
  const hasPasskey = outcome !== "unavailable";
  const codeBusy = codeOutcome === "checking" || codeOutcome === "passed";
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
          {mode === "passkey" && outcome === "refused" ? (
            <Banner variant="danger">That passkey did not work. Try again.</Banner>
          ) : null}
          {mode !== "passkey" && codeOutcome === "refused" ? (
            <Banner variant="danger">That code did not work. Try again.</Banner>
          ) : null}
          {mode !== "passkey" && codeOutcome === "locked" ? (
            <Banner variant="danger">
              Too many wrong codes. Try again in 15 minutes{hasPasskey ? ", or use a passkey" : ""}.
            </Banner>
          ) : null}
          <Card raised className="flex flex-col gap-3.5">
            {mode === "passkey" ? (
              <Button type="button" variant="primary" pending={busy} onClick={() => void ask()}>
                Use a passkey
              </Button>
            ) : (
              <CodeEntryForm key={mode} kind={mode} pending={codeBusy} onSubmit={(code) => void submitCode(mode, code)} />
            )}
            <div className="flex flex-col gap-1">
              {mode !== "passkey" && hasPasskey ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => void ask()}>
                  Use a passkey
                </Button>
              ) : null}
              {mode !== "otp" ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => chooseCode("otp")}>
                  Use authenticator code
                </Button>
              ) : null}
              {mode !== "recovery" ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => chooseCode("recovery")}>
                  Use a recovery code
                </Button>
              ) : null}
            </div>
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
