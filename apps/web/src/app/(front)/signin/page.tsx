import { isDevLoginEnabled } from "@/lib/devLogin";
import { AuthScreen } from "@/components/front/AuthScreen";

export const metadata = { title: "Sign in — Caesura" };

// Server component: `isDevLoginEnabled()` reads process.env, which is only
// populated on the server. The boolean crosses to the client island as a prop
// — the same rule AppHeader.tsx documents for `demoResetEnabled`.
export default function SignInPage() {
  return <AuthScreen mode="signin" devLoginEnabled={isDevLoginEnabled()} />;
}
