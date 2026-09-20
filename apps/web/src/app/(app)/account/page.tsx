import { Suspense } from "react";
import { PageContainer } from "@/components/ui/page-container";
import { Heading } from "@/components/ui/heading";
import { AccountScreen } from "@/components/account/AccountScreen";

// **Account is a route** (SPEC §34.4), replacing `AccountSettingsSheet`.
//
// **The Suspense boundary is Next's requirement, not a loading state**, and it
// is the same one `(app)/plans/page.tsx` and `(app)/layout.tsx` explain:
// `AccountScreen` reads `useSearchParams()` — the `?tab=` that makes each tab a
// URL — and an unwrapped `useSearchParams` fails the PRODUCTION BUILD outright,
// not just static optimisation. That failure is invisible in `pnpm dev`, which
// compiles a route on first hit and never prerenders it, and is exactly what
// `test:e2e:ci-like` exists to catch (CLAUDE.md rule 1).
//
// The fallback is the page's own frame rather than `null`, because Next renders
// it on the server and the component on the client: `null` would leave the
// route's heading out of first-paint HTML, which is a blank page on a slow
// connection where a title costs nothing.
export default function AccountPage() {
  return (
    <Suspense
      fallback={
        <PageContainer width="content">
          <Heading level={1}>Account</Heading>
        </PageContainer>
      }
    >
      <AccountScreen />
    </Suspense>
  );
}
