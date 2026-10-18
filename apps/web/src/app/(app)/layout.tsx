import { AppShell } from "@/components/AppShell";
import { servedForRequest } from "@/server/servedSession";

// The app's surfaces under one chrome (`AppShell`), started from what the
// request's session serves (`server/servedSession.ts`): the reader, their plan
// and their preferences, per request. This file's lint-wall exemption is for
// that read (M45, Mitchell's decision 3 of 2026-10-13).
//
// The public library is not under it any more: it lives in `app/playbooks`,
// whose live layout makes the same read and whose cached copy makes none
// (`lib/playbooksReader.ts`).
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell {...await servedForRequest()}>{children}</AppShell>;
}
