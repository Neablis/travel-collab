"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Heading } from "@/components/ui/heading";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { FrontDoorHeader } from "@/components/front/FrontDoorHeader";
import { AUTH_COPY, GOOGLE_UNAVAILABLE_MESSAGE, errorMessage, type AuthMode } from "@/components/front/authCopy";
import { safeCallbackUrl } from "@/lib/safeCallbackUrl";

// `useSearchParams()` is the only piece of this screen that needs a
// Suspense boundary during static prerender — isolating it in its own leaf
// component means the boundary wraps just this banner, not the whole
// screen. Wrapping the whole `<AuthScreen/>` (as an earlier version of this
// file did) makes Next prerender the *fallback* — i.e. nothing — into the
// shipped HTML, so the header, heading, Google button and footnote would
// all disappear until client JS hydrates. Scoping the boundary here keeps
// that static shell intact; only the error banner (which has nothing to
// show before hydration anyway) waits.
//
// I3 (final review): `?callbackUrl=` is read here too, for the same reason —
// it's a second piece of `useSearchParams()`-derived state, so it rides the
// same boundary rather than adding a second one. It can't drive the
// Google/dev-login buttons' `onClick` directly (those live outside this
// Suspense boundary, in the static shell), so it's lifted to the parent via
// `onCallbackUrl` and applied through an effect — the buttons read the
// resulting `callbackUrl` state instead of calling `useSearchParams()`
// themselves.
function AuthSearchParams({ onCallbackUrl }: { onCallbackUrl: (url: string) => void }) {
  const params = useSearchParams();
  const failure = errorMessage(params.get("error"));

  useEffect(() => {
    onCallbackUrl(safeCallbackUrl(params.get("callbackUrl")));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `onCallbackUrl` is `setCallbackUrl` from useState, which React guarantees is stable across renders; including it would just be a no-op dependency.
  }, [params]);

  if (!failure) return null;
  return <Banner variant="danger">{failure}</Banner>;
}

// `dc.html:1584-1628`: sign-in and sign-up are the same screen with different
// copy (M15 scope item 2), so this is one component with a mode, not two
// near-identical files.
//
// `googleAvailable` mirrors `server/auth.ts`'s own check for
// `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` (via `isGoogleSignInAvailable()` in
// src/lib/googleAuth.ts, read server-side and passed down as a prop — see
// signin/page.tsx and signup/page.tsx). It's required, not defaulted: this
// prop exists specifically so a misconfigured deployment fails loudly
// (disabled button, visible banner) instead of silently — a default of
// `true` would make a caller that forgets the prop silently render the
// working-path UI over a broken provider, which is exactly the bug this
// prop exists to catch. When it's `false`, next-auth/react's
// `signIn("google", ...)` would silently bounce the browser through
// `/api/auth/providers` -> `/api/auth/signin` -> back to this page with no
// `?error=` at all (that round trip is client-side, before Auth.js's error
// redirect ever fires) — so the button must never be clickable, and the
// explanation has to come from this prop, not from `errorMessage()`.
export function AuthScreen({
  mode,
  devLoginEnabled,
  googleAvailable,
}: {
  mode: AuthMode;
  devLoginEnabled: boolean;
  googleAvailable: boolean;
}) {
  const copy = AUTH_COPY[mode];
  // Both of the design's Google-presuming strings, suppressed only in the
  // states the design never drew: `scopeLine` (both modes) describes what
  // signing in with Google asks for, and `signin`'s `footnote` promises an
  // invite-matched account is "waiting" at the address the invite went to —
  // a guarantee this app can only keep via Google's email-verified OAuth,
  // not the dev-login form (which takes an arbitrary username, not a
  // verified address). `signup`'s footnote is generic terms/privacy
  // language that holds regardless of which provider is active, so it's
  // unaffected. This isn't new copy — see authCopy.ts's "do not reword"
  // note — just withholding a design-sourced line in a state the design
  // never drew, where the line would otherwise assert something false.
  const showFootnote = googleAvailable || mode !== "signin";
  const [username, setUsername] = useState("");
  // Defaults to "/" until AuthSearchParams' effect resolves the real
  // `?callbackUrl=` (or confirms there isn't one) — same default `signIn`
  // calls hardcoded before this fix, so a click that somehow beats the
  // effect still lands somewhere safe rather than on `undefined`.
  const [callbackUrl, setCallbackUrl] = useState("/");

  return (
    <div className="flex min-h-screen flex-col bg-paper text-ink">
      <FrontDoorHeader />
      <main className="grid flex-1 place-items-center px-6 pt-3 pb-20">
        <div className="flex w-full max-w-101 flex-col gap-4.5">
          <div className="flex flex-col gap-2">
            <Heading level={1}>{copy.title}</Heading>
            <Text as="p" variant="secondary" className="text-pretty">{copy.sub}</Text>
          </div>

          {!googleAvailable && (
            // This banner is prop-driven (known at render time on the
            // server), not `?error=`-driven, so it renders straight into
            // the static prerendered shell — it doesn't need (and must not
            // be given) its own Suspense boundary. Also covers the
            // dev-login-disabled case: with no provider registered at all,
            // this is the only explanation the screen has, and it already
            // says the deployment itself isn't configured rather than
            // implying there's a form to fill out.
            <Banner variant="danger">{GOOGLE_UNAVAILABLE_MESSAGE}</Banner>
          )}

          <Suspense fallback={null}>
            <AuthSearchParams onCallbackUrl={setCallbackUrl} />
          </Suspense>

          <Card raised className="flex flex-col gap-3.5">
            <Button
              type="button"
              variant="secondary"
              className="h-11.5 w-full text-md font-semibold"
              disabled={!googleAvailable}
              onClick={() => {
                if (!googleAvailable) return;
                void signIn("google", { callbackUrl });
              }}
            >
              Continue with Google
            </Button>

            {googleAvailable && (
              <Text variant="secondary" className="text-xs text-pretty">{copy.scopeLine}</Text>
            )}

            {devLoginEnabled && (
              <form
                className="flex flex-col gap-2 border-t border-hairline pt-3.5"
                onSubmit={(event) => {
                  event.preventDefault();
                  void signIn("dev-login", { username, callbackUrl });
                }}
              >
                <FormField id="dev-login-username" label="Username" hint="Preview and local only">
                  <Input
                    id="dev-login-username"
                    name="username"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                  />
                </FormField>
                <Button type="submit" variant="ghost">Sign in with dev login</Button>
              </form>
            )}

            <div className="border-t border-hairline pt-3.5">
              <Text variant="secondary" className="text-sm">
                {copy.swapPrompt}{" "}
                <Link href={copy.swapHref} className="font-semibold text-brand underline">
                  {copy.swapCta}
                </Link>
              </Text>
            </div>
          </Card>

          {showFootnote && (
            <Text as="p" variant="secondary" className="text-xs text-pretty">{copy.footnote}</Text>
          )}
        </div>
      </main>
    </div>
  );
}
