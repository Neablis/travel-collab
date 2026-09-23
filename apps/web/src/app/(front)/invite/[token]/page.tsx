import { InviteLandingScreen } from "@/components/access/InviteLandingScreen";
import { isGoogleSignInAvailable } from "@/lib/googleAuth";

export const metadata = { title: "You're invited" };

// Under `(front)`, not `(app)`, since M27 link 6: an invite link is opened by
// people who may have no account, and the landing (SPEC §35.6) has to tell
// them who asked and what the trip is BEFORE it asks them to make one. It was
// in `(app)` behind a sign-in redirect; `proxy.ts` still matches it, but only
// to bank the token for M11a's gate — it no longer bounces anyone.
//
// `googleAvailable` is read here, on the server, for the reason `signin/page.tsx`
// reads it: `process.env` is not populated in a client component, and *Join
// with Google* must not be offered on a deployment with no Google provider.
/** The invite landing for `/invite/<token>`, public, with the Google flag read server-side. */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <InviteLandingScreen token={token} googleAvailable={isGoogleSignInAvailable()} />;
}
