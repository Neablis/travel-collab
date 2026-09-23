import { InviteLookScreen } from "@/components/access/InviteLookScreen";
import { isGoogleSignInAvailable } from "@/lib/googleAuth";

export const metadata = { title: "Having a look" };

// *Have a look first* (M27 D12): the real trip, read-only, for the holder of a
// pending invite. Public for the same reason the landing above it is, and
// under the same `/invite/:path*` matcher, which re-banks the token for M11a's
// gate so a Join pressed from here still admits a brand-new account.
/** The look screen for `/invite/<token>/look`, public, with the Google flag read server-side. */
export default async function InviteLookPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <InviteLookScreen token={token} googleAvailable={isGoogleSignInAvailable()} />;
}
