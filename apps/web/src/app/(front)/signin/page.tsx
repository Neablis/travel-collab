import { isDevLoginEnabled } from "@/lib/devLogin";
import { isGoogleSignInAvailable } from "@/lib/googleAuth";
import { AuthScreen } from "@/components/front/AuthScreen";
import { AUTH_COPY } from "@/components/front/authCopy";
import { pageMetadata } from "@/lib/siteMetadata";
import { safeCallbackUrl } from "@/lib/safeCallbackUrl";

// This is the page a link-unfurl scraper actually sees when someone pastes a
// trip URL into a chat: `/trips/:id` is auth-gated, so middleware.ts 307s
// the anonymous scraper to `/signin?callbackUrl=/trips/...` and the card is
// built from *this* page's tags. Trip pages can't carry trip-specific
// OpenGraph themselves — the scraper never reaches them, the lint wall
// keeps `@/server/*` (and so trip data) out of page files, and leaking a
// private trip's title to anyone holding the URL would be wrong anyway
// until M11's share links make read access deliberate. So: when the
// callbackUrl points at a trip, say "a trip was shared with you" instead of
// a generic sign-in card, and say nothing about the trip itself.
//
// Reading `searchParams` makes this route request-rendered rather than
// prerendered — the price of the card, and it's the auth screen, not a
// hot path. `safeCallbackUrl` normalises hostile input to "/" first, the
// same guard AuthScreen applies before redirecting to the value.
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { callbackUrl } = await searchParams;
  const target = safeCallbackUrl(typeof callbackUrl === "string" ? callbackUrl : null);
  if (target.startsWith("/trips/")) {
    return pageMetadata({
      title: "A trip shared with you",
      description:
        "Someone sent you their trip plan on Caesura. Sign in and the plan — days, stops, costs and map — is waiting.",
    });
  }
  // Same rendered <title> as before ("Sign in — Caesura") — the suffix now
  // comes from the layout's title template.
  return pageMetadata({ title: "Sign in", description: AUTH_COPY.signin.sub });
}

// Server component: `isDevLoginEnabled()` and `isGoogleSignInAvailable()`
// read process.env, which is only populated on the server. Both booleans
// cross to the client island as props — the same rule AppHeader.tsx
// documents for `demoResetEnabled`.
//
// AuthScreen owns its own Suspense boundary around the one piece that reads
// `useSearchParams()` (the error banner) — see AuthScreen.tsx. Wrapping the
// whole screen here would make Next prerender a blank fallback for the
// entire page instead of just that banner.
export default function SignInPage() {
  return (
    <AuthScreen
      mode="signin"
      devLoginEnabled={isDevLoginEnabled()}
      googleAvailable={isGoogleSignInAvailable()}
    />
  );
}
