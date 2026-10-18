import { AppShell } from "@/components/AppShell";
import { readerOf } from "@/lib/playbooksPageReader";

// The public library's cached copy (`lib/playbooksReader.ts`). Only a reader
// with no session is sent here, so the shell is the signed-out one with nothing
// served: what the `(app)` layout drew for a request with no session cookie.
// It reads no cookies, which is what lets Next render each page once and the
// CDN keep it.
//
// Its pages are the live ones (`../live`), re-exported. Two things make it a
// tree of its own rather than one tree with a segment for the copy:
//
// - A route with `generateStaticParams` renders every value of its segments in
//   ISR mode, and the live copy's `cookies()` then fails the render
//   (`DYNAMIC_SERVER_USAGE`, seen under `next start`). So `live` is a plain
//   folder that renders per request.
// - The cached copy is a segment, `[copy]`, with an empty
//   `generateStaticParams` here and in each page below it, so each URL is
//   rendered on its first visit and kept. A plain folder would be prerendered
//   at `next build`, which runs without a database in CI (`app/sitemap.ts`
//   says the same), and every cached list is cleared by any publish
//   (`LIBRARY_TAG`), so a page built at deploy would be thrown away at the
//   next one anyway.
/** No URL built ahead: each is rendered on its first visit and kept (see above). */
export function generateStaticParams(): { copy: string }[] {
  return [];
}

/** The library's chrome for a cached page: the signed-out shell, with no session read. */
export default async function CachedPlaybooksLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ copy: string }>;
}) {
  await readerOf(params);
  return (
    <AppShell noSessionCookie served={null}>
      {children}
    </AppShell>
  );
}
