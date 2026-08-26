import { isDevLoginEnabled } from "@/lib/devLogin";
import { isGoogleSignInAvailable } from "@/lib/googleAuth";
import { AuthScreen } from "@/components/front/AuthScreen";

export const metadata = { title: "Start planning — Caesura" };

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
