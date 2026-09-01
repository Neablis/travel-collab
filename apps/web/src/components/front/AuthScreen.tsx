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
import {
  ADMISSION_FIELD_COPY,
  AUTH_COPY,
  GOOGLE_UNAVAILABLE_MESSAGE,
  errorMessage,
  type AuthMode,
} from "@/components/front/authCopy";
import { safeCallbackUrl } from "@/lib/safeCallbackUrl";
import { submitOnEnter } from "@/lib/submitOnEnter";
import { PENDING_ADMISSION_MAX_LENGTH, normalizePendingAdmission } from "@/lib/pendingAdmission";

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
//
// M11a: `storeAdmissionCode` is the Server Action `signup/page.tsx` hands
// down, and it is the whole reason the invite-code field can exist on a
// client component at all. The gate reads its code out of an **httpOnly**
// `pending_admission` cookie, which `document.cookie` cannot write by
// definition — so the write has to happen server-side, and it has to have
// happened *before* `signIn()` navigates away, because the OAuth callback
// comes back from Google with no memory of this form (the milestone's link
// 5). Awaiting the action is what orders those two: its `Set-Cookie` is in
// the jar before the browser leaves. Optional, because `/signin` has no code
// field and passes nothing.
export function AuthScreen({
  mode,
  devLoginEnabled,
  googleAvailable,
  storeAdmissionCode,
  initialCallbackUrl = "/",
}: {
  mode: AuthMode;
  devLoginEnabled: boolean;
  googleAvailable: boolean;
  storeAdmissionCode?: (code: string) => Promise<void>;
  // The request-rendered value of `safeCallbackUrl(searchParams.callbackUrl)`,
  // read server-side by `signin/page.tsx` / `signup/page.tsx` and handed down
  // already normalised — this file does not re-normalise it (one
  // `safeCallbackUrl`, not two). Exists so the mode-swap link is right in the
  // server-rendered HTML itself (CodeRabbit, PR #104): `next/link` renders a
  // real anchor before hydration, and `AuthSearchParams` below only learns the
  // real callbackUrl from a post-render effect — a click that beats that
  // effect used to land on a bare `/signup` or `/signin`, dropping exactly the
  // destination "Make this trip mine" on `/demo` depends on. Defaults to "/"
  // so every existing caller (tests included) that doesn't pass it keeps the
  // old effect-only behaviour.
  initialCallbackUrl?: string;
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
  // The dev-login form's only submit path is `signIn()`, which is
  // client-side — so between this server-rendered HTML painting and React
  // hydrating it, the form is a plain `<form>` with no `action`. Pressing
  // Enter in the username field then triggers the browser's *native*
  // implicit submission: a GET to this same URL, which reloads /signin,
  // wipes the typed username out of the controlled input, and (because the
  // input has `name="username"`) writes what was typed into the address bar
  // as `?username=…`, where it lands in history and server logs. On screen
  // that reads as "Enter does nothing" — reported from a cold preview
  // deployment on 2026-08-30, where the hydration gap is widest.
  //
  // Gating the submit button on hydration closes it: HTML's implicit
  // submission does nothing when the form's default button is disabled, so
  // Enter is inert until the handler that gives it meaning actually exists,
  // instead of firing a navigation that destroys the user's input. After
  // hydration Enter and a click run the identical path.
  //
  // This is deliberately not "make the form work without JS" — that would
  // mean a server action posting to Auth.js, which is a real change to the
  // auth flow rather than a fix to this defect.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  // Seeded from `initialCallbackUrl` — the server-rendered, already-safe
  // value — rather than a hardcoded "/", so the mode-swap `<Link>` below is
  // correct in the HTML the server sends, not just after `AuthSearchParams`'
  // effect runs (CodeRabbit, PR #104; see the prop's own comment above).
  // `AuthSearchParams` still owns reconciling this on the client: it's the
  // only piece of this screen that has to be inside a Suspense boundary
  // (`useSearchParams()`), so it stays the source of truth for anything that
  // changes after first paint (e.g. `back`/`forward` navigating this same
  // route with a different `?callbackUrl=`).
  const [callbackUrl, setCallbackUrl] = useState(initialCallbackUrl);
  // Signup only. Someone on `/signin` either already has a `users` row (the
  // gate waves them through untouched) or arrived on a trip invite link,
  // which `proxy.ts` has already banked in the same cookie — neither has a
  // code to type, and a field asking for one would read as a requirement.
  const [admissionCode, setAdmissionCode] = useState("");
  const showAdmissionCode = mode === "signup";

  // The swap link has to carry `?callbackUrl=` across, and this is not a
  // nicety: it is one of the three places the "Make this trip mine" intent was
  // being dropped (Mitchell, 2026-09-01 — you press it on `/demo`, land on
  // `/signin?callbackUrl=/demo`, follow "Create an account" because you
  // have none, and arrive at a bare `/signup` that has forgotten where you were
  // going). Someone who has no account is exactly the person the demo's CTA
  // sends here, so the hop that loses their destination is the common path, not
  // the edge case.
  //
  // `callbackUrl` is already `safeCallbackUrl`-normalised (AuthSearchParams
  // above), so the value re-encoded here is a same-origin relative path and
  // nothing else. "/" is the default-for-absent, and appending it would put a
  // pointless parameter on every ordinary visit to this screen.
  const swapHref =
    callbackUrl === "/"
      ? copy.swapHref
      : `${copy.swapHref}?callbackUrl=${encodeURIComponent(callbackUrl)}`;

  // What the Google button does, lifted out so the invite-code field's Enter
  // key can do the identical thing rather than a near-copy of it.
  const continueWithGoogle = () => {
    if (!googleAvailable) return;
    void startSignIn(() => void signIn("google", { callbackUrl }));
  };

  // Every sign-in dispatch on this screen goes through here, including dev
  // login: the build plan's decision 3 routes dev login through the same
  // admission path rather than exempting it, so it needs the same cookie.
  async function startSignIn(dispatch: () => void) {
    // `normalizePendingAdmission` returning null for blank is load-bearing,
    // not defensive tidiness: writing an empty cookie would still be a write,
    // and it would overwrite the trip-invite token `proxy.ts` stored for
    // someone who opened `/invite/<token>` and then walked to `/signup`.
    const code = showAdmissionCode ? normalizePendingAdmission(admissionCode) : null;
    if (code && storeAdmissionCode) {
      try {
        await storeAdmissionCode(code);
      } catch {
        // Sign in anyway. The two outcomes of a failed cookie write are a
        // button that visibly does nothing, or a refusal on the designed
        // `?error=` screen that says to try the code again — and this screen
        // has no surface for the first one (its banner is `?error=`-driven,
        // and there is no handoff copy for "your browser and our server
        // disagreed"). The refusal names a slightly wrong cause but it is a
        // designed screen with a next action, which is the whole point of
        // link 6; a dead button is the blank state the gate says can't happen.
      }
    }
    dispatch();
  }

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
            {showAdmissionCode && (
              // Above the Google button, because it has to be filled in before
              // the button is pressed — pressing it is what leaves the site.
              //
              // The note and hint come from `ADMISSION_FIELD_COPY`, which is
              // build-side copy awaiting design sign-off, kept separate from
              // the verbatim `AUTH_COPY` on purpose (see that block). The
              // hint carries the "may be empty" case: someone arriving from a
              // trip invite link is admitted by the token the proxy stored, so
              // the field is genuinely optional and nothing else says so.
              <>
                <Text variant="muted">{ADMISSION_FIELD_COPY.note}</Text>
                <FormField
                  id="admission-code"
                  label="Invite code"
                  hint={ADMISSION_FIELD_COPY.hint}
                >
                  {/* Enter continues, because this is the only field on the
                      screen and the button under it is the only thing to do
                      with what you typed (Mitchell, 2026-09-01: "Pressing enter
                      in many fields doesnt submit — Signin (input from code)").
                      A keydown handler rather than a `<form>` on purpose: see
                      `submitOnEnter`, and the dev-login form below, for what a
                      pre-hydration native submit does to a typed value. */}
                  <Input
                    id="admission-code"
                    name="inviteCode"
                    value={admissionCode}
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={PENDING_ADMISSION_MAX_LENGTH}
                    onChange={(event) => setAdmissionCode(event.target.value)}
                    onKeyDown={submitOnEnter(continueWithGoogle)}
                  />
                </FormField>
              </>
            )}

            <Button
              type="button"
              variant="secondary"
              className="h-11.5 w-full text-md font-semibold"
              disabled={!googleAvailable}
              onClick={continueWithGoogle}
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
                  void startSignIn(() => void signIn("dev-login", { username, callbackUrl }));
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
                <Button type="submit" variant="ghost" disabled={!hydrated}>Sign in with dev login</Button>
              </form>
            )}

            <div className="border-t border-hairline pt-3.5">
              <Text variant="secondary" className="text-sm">
                {copy.swapPrompt}{" "}
                <Link href={swapHref} className="font-semibold text-brand underline">
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
