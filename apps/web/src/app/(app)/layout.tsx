import { AppShell } from "@/components/AppShell";
import { PwaLockGate } from "@/components/PwaLockGate";
import { EARLY_LOCK_SCRIPT } from "@/lib/pwaLock";
import { servedForApp } from "@/server/servedSession";

// The app's surfaces under one chrome (`AppShell`), started from what the
// request's session serves (`server/servedSession.ts`): the reader, their plan
// and their preferences, per request. This file's lint-wall exemption is for
// that read (M45, Mitchell's decision 3 of 2026-10-13).
//
// The public library is not under it any more: it lives in `app/playbooks`,
// whose live layout makes the same read and whose cached copy makes none
// (`lib/playbooksReader.ts`).
//
// The installed app's idle lock goes over all of it (M62 D3b). A request with no
// session cookie has no account to lock; the user id is for Sign out on the lock.
// Its script goes ahead of the app's HTML so a reopened app past its idle time
// does not show the server's paint while it hydrates (`EARLY_LOCK_SCRIPT`).
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const served = await servedForApp();
  const signedIn = !served.noSessionCookie;
  return (
    <>
      {signedIn ? <script dangerouslySetInnerHTML={{ __html: EARLY_LOCK_SCRIPT }} /> : null}
      <PwaLockGate signedIn={signedIn} userId={served.served?.user?.id ?? null}>
        <AppShell {...served}>{children}</AppShell>
      </PwaLockGate>
    </>
  );
}
