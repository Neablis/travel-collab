import { AppShell } from "@/components/AppShell";
import { servedForRequest } from "@/server/servedSession";

// The public library's live copy (`lib/playbooksReader.ts`): the app's chrome,
// read from the session exactly as `(app)/layout.tsx` reads it, per request. A
// signed-in reader gets their plan in the first HTML, so the pages' Ask is
// drawn by the server (M45 decision 3), and their preferences with it. This
// file's lint-wall exemption is for that read.
//
// The cached copy does not come through here: `../[copy]/layout.tsx` draws the
// signed-out shell with nothing read, which is what lets it be cached.
/** The library's chrome for a live page: the session's reader, plan and preferences, per request. */
export default async function PlaybooksLayout({ children }: { children: React.ReactNode }) {
  return <AppShell {...await servedForRequest()}>{children}</AppShell>;
}
