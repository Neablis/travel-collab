import { signOut } from "next-auth/react";
import { forgetAskConversationsOf } from "@/lib/askOwnership";
import { clearSignedInHint } from "@/lib/sessionHint";

/**
 * Signs this browser out: the account menu's Sign out, and the installed app's
 * lock screen, which is the only Sign out on offer while the menu is under it.
 *
 * What this account asked on this browser goes with it (PR 426 review). Then to
 * the landing at `/`. This used to be `/welcome`, because `/` was Home for a
 * signed-in request and `signOut`'s navigation could outrun the Set-Cookie that
 * clears the session (`GET /` answered Home in 4 of 16 runs of
 * e2e/m15-front-door.spec.ts on Next 16). Since ADR-078 `/` is a static page
 * with no session check, so there is nothing left to race, provided the
 * signed-in hint goes first, or the landing's script would send the visitor to
 * `/home`, and from there to sign in.
 */
export function signOutHere(userId: string | null | undefined): void {
  if (userId) forgetAskConversationsOf(userId);
  clearSignedInHint();
  void signOut({ callbackUrl: "/" });
}
