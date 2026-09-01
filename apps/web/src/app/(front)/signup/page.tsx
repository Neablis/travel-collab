import { cookies, headers } from "next/headers";
import { isDevLoginEnabled } from "@/lib/devLogin";
import { isGoogleSignInAvailable } from "@/lib/googleAuth";
import { AuthScreen } from "@/components/front/AuthScreen";
import { AUTH_COPY } from "@/components/front/authCopy";
import { pageMetadata } from "@/lib/siteMetadata";
import { safeCallbackUrl } from "@/lib/safeCallbackUrl";
import {
  PENDING_ADMISSION_COOKIE,
  normalizePendingAdmission,
  pendingAdmissionCookieOptions,
} from "@/lib/pendingAdmission";

// Same rendered <title> as before ("Start planning — Caesura") — the suffix
// now comes from the layout's title template. Description reuses the
// screen's own sub-line rather than inventing meta-only copy.
export const metadata = pageMetadata({
  title: "Start planning",
  description: AUTH_COPY.signup.sub,
});

// M11a link 5, and the one genuinely fiddly part of this milestone: the
// invite code has to be inside the `pending_admission` cookie *before* the
// browser leaves for Google, because by the time the OAuth callback runs the
// browser has been to Google and back and this form no longer exists.
//
// The cookie the gate reads is httpOnly, which is a security property the
// milestone's exit gate asserts by name — and `document.cookie` cannot write
// an httpOnly cookie, by definition. So the client-side write the shape of
// this problem first suggests is not available at all, and the write has to
// come from the server. This is that server write: a Server Action, awaited
// by the form before it calls `signIn()`, so the `Set-Cookie` on the action's
// response is in the jar before the navigation starts.
//
// It lives here rather than in a `src/app/api/**` route handler for one
// concrete reason: the lint wall forbids page files importing `@/server/*`,
// so neither form can validate the code here anyway — this seam only needs
// to *store* a string, exactly as `proxy.ts` does for a trip-invite token
// (it stores; it never validates). A route handler would be a second public
// endpoint and a second thing to test for behaviour this page already owns.
// Validation stays where the milestone puts it, in `server/admission.ts`,
// reached from `recordSignIn`. This is the repo's first Server Action.
//
// `code` is untrusted — a Server Action is a public POST endpoint — so it is
// bounded and trimmed by `normalizePendingAdmission` before it reaches a
// response header, and a blank submit writes nothing at all rather than
// clobbering a token `proxy.ts` may already have stored.
async function storeAdmissionCode(code: string) {
  "use server";
  const pending = normalizePendingAdmission(code);
  if (!pending) return;
  const host = (await headers()).get("host");
  const jar = await cookies();
  jar.set(PENDING_ADMISSION_COOKIE, pending, pendingAdmissionCookieOptions(host));
}

// Server component: `isDevLoginEnabled()` and `isGoogleSignInAvailable()`
// read process.env, which is only populated on the server. Both booleans
// cross to the client island as props — the same rule AppHeader.tsx
// documents for `demoResetEnabled`.
//
// AuthScreen owns its own Suspense boundary around the one piece that reads
// `useSearchParams()` (the error banner) — see AuthScreen.tsx. Wrapping the
// whole screen here would make Next prerender a blank fallback for the
// entire page instead of just that banner. That boundary is unrelated to,
// and unaffected by, the `searchParams` read below — it protects the shell
// *inside* whatever this page's own rendering strategy produces, not the
// strategy itself.
//
// `searchParams` is new here (CodeRabbit, pull request 104): `initialCallbackUrl` lets
// AuthScreen seed its swap-link state with the real, already-`safeCallbackUrl`
// -normalised value instead of "/", so the sign-in ⇄ sign-up swap link is
// correct in the server-rendered HTML itself and a click that beats
// `AuthSearchParams`' hydration-time effect doesn't drop the destination —
// exactly the loss `/demo`'s "Make this trip mine" hit on this exact hop.
//
// The cost: reading `searchParams` opts a route out of static generation
// (Next can no longer prerender this page once at build time — every request
// runs the server component fresh, the same trade `signin/page.tsx` already
// made for its `generateMetadata`). Before this change `/signup` had no
// dynamic API and was a static, cacheable shell; after it, it is not. Same
// call as signin's: this is the auth screen, not a hot path, and a wrong or
// stale swap-link destination is a worse user-facing cost than a page that
// can't be served from a static cache.
export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { callbackUrl } = await searchParams;
  const initialCallbackUrl = safeCallbackUrl(typeof callbackUrl === "string" ? callbackUrl : null);
  return (
    <AuthScreen
      mode="signup"
      devLoginEnabled={isDevLoginEnabled()}
      googleAvailable={isGoogleSignInAvailable()}
      storeAdmissionCode={storeAdmissionCode}
      initialCallbackUrl={initialCallbackUrl}
    />
  );
}
