import { Suspense } from "react";
import { isDevLoginEnabled } from "@/lib/devLogin";
import { AuthScreen } from "@/components/front/AuthScreen";

export const metadata = { title: "Sign in — Caesura" };

// Server component: `isDevLoginEnabled()` reads process.env, which is only
// populated on the server. The boolean crosses to the client island as a prop
// — the same rule AppHeader.tsx documents for `demoResetEnabled`.
//
// AuthScreen reads `useSearchParams()` (for `?error=`), which requires a
// Suspense boundary during static prerender — Next.js otherwise bails the
// build with "useSearchParams() should be wrapped in a suspense boundary".
export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <AuthScreen mode="signin" devLoginEnabled={isDevLoginEnabled()} />
    </Suspense>
  );
}
