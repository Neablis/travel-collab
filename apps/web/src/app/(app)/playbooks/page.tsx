import { DiscoverScreen } from "@/components/playbooks/DiscoverScreen";
import { parseDiscoverUrl } from "@/components/playbooks/discoverUrl";
import { linkPreviewMetadata } from "@/lib/linkPreview";
import { playbooksPageMetadata } from "@/lib/playbooksPreview";
import { auth } from "@/server/auth";
import { discoverFor } from "@/server/playbooks";

// Spec 2026-10-02 §2.7. A Discover link for exactly one city, and no country,
// gets that city's card ("Kyoto playbooks"); any other search is not one
// place a card can name, and gets the static Playbooks card. Parsed by the
// same function the page seeds its search from, so the card names the city
// the page searches for.
/** Metadata for `/playbooks`: one city's card for `?city=<one>`, the Playbooks card otherwise. */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { cities, countries } = parseDiscoverUrl(await searchParams);
  const fallback = playbooksPageMetadata("Playbooks");
  const meta =
    cities.length !== 1 || countries.length > 0
      ? fallback
      : await linkPreviewMetadata(`/api/og/playbooks/city/${encodeURIComponent(cities[0]!)}`, fallback);
  // Discover is one page whatever its filters.
  return { ...meta, alternates: { canonical: "/playbooks" } };
}

// `/playbooks` — Discover (M11b link 5). This route used to be an 18-line shell
// rendering mock cards inside `<Preview id="playbooks-route">`; that shell is
// deleted, not re-pointed.
//
// Nested routes (`day`, `board`, `profile`) sit under this path. All four are
// public since ADR-061: `proxy.ts` no longer matches `/playbooks`, so a shared
// link opens for somebody with no account, and the screens hide what only an
// account can do. They stay in `(app)` so a signed-in reader sees the same page.
//
// The query string seeds the search — `?city=` (a profile's "Knows" chip),
// `?country=`, `?sort=`, `?rating=` and the rest. `discoverUrl.ts` owns the
// spelling, and `DiscoverScreen` writes it back as the state changes. The
// page also reads that search on the server (SEO pass, D5), so the HTML lists
// the days rather than a skeleton.
export default async function PlaybooksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  // A reader with no account reads Everyone whatever the URL says, so the
  // screen is seeded with that too: the first render, the server's HTML and
  // the hook then agree, and no Saved tab is drawn over an Everyone list.
  const parsed = parseDiscoverUrl(await searchParams);
  const initial = session?.user?.id ? parsed : { ...parsed, scope: "everyone" as const };
  // The call `GET /api/playbooks` makes, with the URL's own filters and the
  // budget band off (it is not in the URL), so this is exactly the answer the
  // screen's first search would have fetched. A signed-out reader's scope is
  // forced to Everyone inside `discoverFor`, as the screen does for itself.
  const initialData = await discoverFor({ ...initial, budget: "any" }, session?.user?.id ?? null);
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <DiscoverScreen initial={initial} initialData={initialData} />
    </main>
  );
}
