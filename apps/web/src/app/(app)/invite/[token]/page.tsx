import { InviteAcceptScreen } from "@/components/access/InviteAcceptScreen";

// Inside the `(app)` route group so it carries the signed-in chrome, and
// covered by `proxy.ts`'s matcher so a signed-out visitor is bounced to
// /signin?callbackUrl=/invite/<token> and lands back here after signing in —
// the same machinery M15 already built for every other authenticated route.
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <InviteAcceptScreen token={token} />;
}
