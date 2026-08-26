import { isDevLoginEnabled } from "@/lib/devLogin";
import { AuthScreen } from "@/components/front/AuthScreen";

export const metadata = { title: "Start planning — Caesura" };

// Server component: `isDevLoginEnabled()` reads process.env, which is only
// populated on the server. The boolean crosses to the client island as a prop
// — the same rule AppHeader.tsx documents for `demoResetEnabled`.
export default function SignUpPage() {
  return <AuthScreen mode="signup" devLoginEnabled={isDevLoginEnabled()} />;
}
