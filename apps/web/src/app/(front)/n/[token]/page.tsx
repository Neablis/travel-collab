import { cache } from "react";
import { parsePageDoc } from "@tc/contracts";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PublicNotebookScreen } from "@/components/access/PublicNotebookScreen";
import { NOINDEX, pageMetadata } from "@/lib/siteMetadata";
import { liveShareTokensFor, readPageShare } from "@/server/access/pageShares";
import { toPublicNotebookView } from "@/server/access/publicView";
import { listPageEntries } from "@/server/pages";
import { buildTripGlobals } from "@/server/tripGlobals";

// `/n/<token>`: a public notebook (M58, ADR-088), for a reader with no account
// and for a member alike: nobody gets a different page. Under `(front)` and
// out of `proxy.ts`'s matcher for `/s/`'s reason, and `noindex`, no-referrer
// and `no-store` (`next.config.ts`).
//
// **No `loading.tsx`, on purpose.** A loading boundary flushes the shell with a
// 200 before the read has answered, so a dead link would stream its 404 page
// under a 200 (measured). Here the status is decided before any byte is sent.
//
// **Dynamic, and read per request.** `Make private` works on the next request,
// so nothing here may be prerendered or cached. The token is the only thing
// that names the notebook: no id, slug or title is in the URL.
//
// **What reaches the browser is `{title, content, accents}`.** The widgets are
// resolved here, for the public reader, by `toPublicNotebookView`, which is the
// only thing built from the trip and the page. The trip, the document, the
// widgets' params and the members never become a prop.
export const dynamic = "force-dynamic";

// Read once per request: the metadata and the page both need it.
const load = cache(async (token: string) => {
  const read = await readPageShare(token);
  // Unknown, revoked, and a deleted page or trip are all this one answer.
  if (!read.ok) return null;
  const { page, trip } = read.value;
  const [publicTokenFor, notebooks] = await Promise.all([liveShareTokensFor(trip.tripId), listPageEntries(trip.tripId)]);
  const now = new Date();
  return toPublicNotebookView({
    trip,
    globals: buildTripGlobals(trip),
    page: { title: page.title, content: parsePageDoc(page.content), context: page.context },
    external: {
      // A stranger's page makes no call to a weather source on the group's
      // behalf (the trip's places would leave with it), so it reads as down.
      weather: { state: "failed" },
      notebooks: {
        state: "ready",
        value: {
          pages: notebooks.map((entry) => ({
            id: entry.id,
            seedKey: entry.seedKey ?? null,
            title: entry.title,
            firstLine: entry.preview?.firstLine ?? null,
            widgetCount: entry.preview?.widgetCount ?? 0,
          })),
        },
      },
    },
    publicTokenFor,
    // A stranger has no time zone to read the date in: the server's calendar
    // day, and no clock, so nothing is scoped to "now".
    today: now.toISOString().slice(0, 10),
    now: null,
  });
});

/**
 * Metadata for `/n/<token>`: the notebook's title and the card of its title and cover; a dead link names nothing.
 * The title is the page's own, which the publisher chose to share (an Overview page's is the trip's name).
 */
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const view = await load(token);
  if (view === null) return { title: "Not found", robots: NOINDEX };
  return {
    ...pageMetadata({
      title: view.title,
      description: "Shared from Caesura",
      image: { url: `/api/og/notebook/${encodeURIComponent(token)}`, alt: view.title },
    }),
    robots: NOINDEX,
  };
}

/** The public notebook for `/n/<token>`, or the 404 that names nothing. */
export default async function PublicNotebookPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await load(token);
  if (view === null) notFound();
  // The screen restates the view's type (UI cannot import `@/server`); this is the one file that sees both, so a drift fails to compile here.
  return <PublicNotebookScreen view={view} />;
}
