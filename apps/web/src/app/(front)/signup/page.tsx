import { isDevLoginEnabled } from "@/lib/devLogin";
import { isGoogleSignInAvailable } from "@/lib/googleAuth";
import { AuthScreen } from "@/components/front/AuthScreen";
import { AUTH_COPY } from "@/components/front/authCopy";
import { pageMetadata } from "@/lib/siteMetadata";

// Same rendered <title> as before ("Start planning — Caesura") — the suffix
// now comes from the layout's title template. Description reuses the
// screen's own sub-line rather than inventing meta-only copy.
export const metadata = pageMetadata({
  title: "Start planning",
  description: AUTH_COPY.signup.sub,
});

// Server component: `isDevLoginEnabled()` and `isGoogleSignInAvailable()`
// read process.env, which is only populated on the server. Both booleans
// cross to the client island as props — the same rule AppHeader.tsx
// documents for `demoResetEnabled`.
//
// AuthScreen owns its own Suspense boundary around the one piece that reads
// `useSearchParams()` (the error banner) — see AuthScreen.tsx. Wrapping the
// whole screen here would make Next prerender a blank fallback for the
// entire page instead of just that banner.
export default function SignUpPage() {
  return (
    <AuthScreen
      mode="signup"
      devLoginEnabled={isDevLoginEnabled()}
      googleAvailable={isGoogleSignInAvailable()}
    />
  );
}
