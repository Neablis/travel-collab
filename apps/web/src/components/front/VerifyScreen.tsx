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
import { recordActivity } from "@/lib/pwaLock";
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
  // Choosing a method unmounts the button that had focus, which would drop it to the
  // page's start. A code field takes focus itself (`autoFocus`); the passkey view's
  // own button is handed it here. Not on arrival: the screen starts on the prompt.
  const passkeyButton = useRef<HTMLButtonElement>(null);
  const switched = useRef(false);

  // `onArrival`: the prompt nobody tapped for. On a slow phone a tap on a code can
  // land before it starts, and it must not be put back on the passkey it just left.
  async function ask(onArrival = false) {
    if (inFlight.current || (onArrival && switched.current)) return;
    inFlight.current = true;
    const from = mode;
    setMode("passkey");
    setOutcome("asking");
    const result = await checkWithPasskey();
    inFlight.current = false;
    setOutcome(result);
    // Asked for from a code, it goes back to that code: the person chose it. A code
    // tapped while the prompt was out is chosen too, so only passkey mode is left.
    if (result === "unavailable") setMode((m) => (m !== "passkey" ? m : from === "passkey" ? "otp" : from));
    if (result === "passed" || result === "not-required") goOn();
    // Nothing on this screen can work without a session behind the cookie. The
    // route clears it, then sends the person to sign in with where they were going.
    else if (result === "signed-out") leaveSession();
  }

  // Signing in is activity. Without it the installed app's lock (M62 D3b) reads a
  // last activity from before the sign-out and locks seconds after this passkey.
  function goOn() {
    recordActivity();
    router.replace(callbackUrl);
  }

  function leaveSession() {
    window.location.assign(`/api/session-expired?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  }

  async function submitCode(kind: CodeKind, code: string) {
    setCodeOutcome("checking");
    const result = await checkWithCode(kind, code);
    setCodeOutcome(result);
    // The same exits as the passkey's: neither has a retry.
    if (result === "passed" || result === "not-required") goOn();
    else if (result === "signed-out") leaveSession();
  }

  function chooseCode(kind: CodeKind) {
    setCodeOutcome(null);
    switched.current = true;
    setMode(kind);
  }

  useEffect(() => {
    if (switched.current && mode === "passkey") passkeyButton.current?.focus();
  }, [mode]);

  useEffect(() => {
    void ask(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival; `ask` is re-made each render and only ever reads state through setters
  }, []);

  const busy = outcome === "asking" || outcome === "passed" || outcome === "not-required" || outcome === "signed-out";
  const hasPasskey = outcome !== "unavailable";
  // Still "asking" with nothing in flight when a code was tapped before the arrival
  // prompt: nobody has learned whether a passkey exists, so the lock promises none.
  const knownPasskey = hasPasskey && outcome !== "asking";
  const codeBusy =
    codeOutcome === "checking" ||
    codeOutcome === "passed" ||
    codeOutcome === "not-required" ||
    codeOutcome === "signed-out";
  // Drawn under the field it is about, which names it (`CodeEntryForm`).
  const codeProblem =
    codeOutcome === "refused"
      ? "That code did not work. Try again."
      : codeOutcome === "locked"
        ? `Too many wrong codes. Try again in 15 minutes${knownPasskey ? ", or use a passkey" : ""}.`
        : null;
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
          {/* Safari refuses the prompt this screen opens on its own (no tap started it) and says so as "cancelled".
              Always rendered: a live region is announced when its text changes, and one that appears with its text is not. */}
          <Text as="p" variant="secondary" role="status" className="empty:hidden">
            {mode === "passkey" && outcome === "cancelled" ? "Tap Use a passkey to continue." : ""}
          </Text>
          <Card raised>
            <div className="flex flex-col gap-3.5">
              {mode === "passkey" ? (
                <Button ref={passkeyButton} type="button" variant="primary" pending={busy} onClick={() => void ask()}>
                  Use a passkey
                </Button>
              ) : (
                <CodeEntryForm
                  key={mode}
                  kind={mode}
                  pending={codeBusy}
                  problem={codeProblem}
                  onSubmit={(code) => void submitCode(mode, code)}
                />
              )}
              <div className="flex flex-col gap-1">
                {mode !== "passkey" && hasPasskey ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      switched.current = true;
                      void ask();
                    }}
                  >
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
