// **The one gate on the operator surface**, used by the route group's layout
// and by every admin endpoint (M20 link 7).
//
// The gate box is explicit that hiding is not enough: *"a non-admin reaches no
// admin route **and no admin endpoint** — checked server-side, and a test
// proves the route group is not merely hidden."* So this function exists once
// and both halves call it; there is no version of this check that lives in a
// component's render.
//
// **404, not 403**, for an unauthorised caller. A 403 confirms the route
// exists, and an operator console whose existence is confirmable is a list of
// endpoints worth attacking. `/api/trips/:id` takes the same position for a
// trip the caller may not see, for the same reason.
import { auth } from "@/server/auth";
import { callerIsAdmin } from "./admin";

export type AdminGuard = { userId: string } | { error: Response };

/** The endpoint half. `{ error }` is a Response the caller returns as-is. */
export async function requireAdminApi(): Promise<AdminGuard> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { error: notFound() };
  if (!(await callerIsAdmin(userId))) return { error: notFound() };
  return { userId };
}

/**
 * The page half. `null` means "not an operator" and the caller calls Next's
 * `notFound()`, which renders the same 404 a missing route would.
 *
 * Separate from the endpoint half only because a page cannot return a
 * `Response`; the DECISION is one function, `callerIsAdmin`, and both go
 * through it — the stored `users.is_admin`, or the `admin-console` flag
 * targeted at this caller (M20 link 7, 2026-09-14).
 */
export async function adminUserId(): Promise<string | null> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;
  return (await callerIsAdmin(userId)) ? userId : null;
}

function notFound(): Response {
  return Response.json({ error: "not-found" }, { status: 404 });
}
