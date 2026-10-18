import * as Sentry from "@sentry/nextjs";
import { cookies } from "next/headers";
import type { ServedSession } from "@/components/AppShell";
import { hasSessionCookie } from "@/lib/sessionHint";
import { auth } from "@/server/auth";
import { readAccountPreferences } from "@/server/accountPreferences";
import { entitlementsFor } from "@/server/entitlements/resolver";

// **The cookie, read here, decides the first paint.** With no session cookie at
// all the provider starts at `null`, so the server renders the signed-out shell
// — Sign in in the header, no account tab bar, no Yours/Saved — instead of the
// signed-in skeleton that then changed its mind. A cookie only means "ask"
// (`lib/sessionHint.ts`). The cost: reading cookies makes a layout render per
// request, so the shells under `(app)` that were prerendered (Home, `/account`,
// `/plans`) no longer are. They fetch their data on the client either way; what
// moved is one server render of a shell. The public library pays it only for a
// reader with a session (`lib/playbooksReader.ts`).
//
// **And the plan goes with the page** (Mitchell, 2026-10-13, M45 decision 3).
// What the reader's account is conferred is resolved here, per request, and
// sent down, so a surface that offers the assistant only to a plan with it
// (the playbook pages' Ask, ⌘K's *Ask:*) draws it in the server HTML rather
// than after a read. Through the entitlements module, never a JWT claim
// (ADR-045 rule 2); the layouts' lint-wall exemptions say the same.
//
// The preferences ride the same exemption, read beside the plan rather than
// after it, through the function the endpoint itself answers with.
/** The request's session cookie and, when there is one, what it serves: the props `AppShell` takes. */
export async function servedForRequest(): Promise<{ noSessionCookie: boolean; served: ServedSession | null }> {
  const noSessionCookie = !hasSessionCookie((await cookies()).getAll().map((cookie) => cookie.name));
  return { noSessionCookie, served: noSessionCookie ? null : await servedSession() };
}

/**
 * Who is reading, what their account is conferred, and their preferences, from
 * one `auth()`.
 *
 * **The user goes down too**, so `SessionUserProvider` starts at the answer
 * instead of asking `/api/auth/session` the same question from the client on
 * every full load. `null` for a cookie with no live session behind it, which is
 * an answer; `undefined` when the read threw, which leaves the client to ask
 * for itself, as it always did. Only the three fields `SessionUser` names are
 * passed: this lands in the page's payload.
 *
 * The entitlements are `null` to leave each surface to ask for itself: a
 * cookie with no live session behind it, or a read that failed. A failure must
 * not take the whole app down with it, and `null` is the answer every caller
 * already treats as entitled; the route's 402 is the gate either way. It is
 * still reported: a version reference that no longer resolves must fail loudly
 * (ADR-045 rule 3), and the fallback alone would hide it.
 *
 * The preferences are `undefined` on the same terms, which leaves
 * `PreferencesProvider` to fetch them as it did before they were served. Each
 * read fails alone: a broken plan does not cost the preferences, nor the
 * reverse.
 */
export async function servedSession(): Promise<ServedSession> {
  let user: ServedSession["user"];
  try {
    const session = await auth();
    user = session?.user ? { id: session.user.id ?? null, name: session.user.name ?? null, email: session.user.email ?? null } : null;
    const userId = session?.user?.id;
    if (userId === undefined) return { user, entitlements: null, preferences: undefined };
    // In parallel, so serving the preferences adds no sequential read to the
    // render. Each catches its own failure (see the docstring).
    const [entitlements, preferences] = await Promise.all([
      entitlementsFor(userId).then(
        (resolved) => [...resolved.entitlements],
        (error: unknown) => {
          Sentry.captureException(error);
          return null;
        },
      ),
      readAccountPreferences(userId).catch((error: unknown) => {
        Sentry.captureException(error);
        return undefined;
      }),
    ]);
    return { user, entitlements, preferences };
  } catch (error) {
    Sentry.captureException(error);
    return { user, entitlements: null, preferences: undefined };
  }
}
