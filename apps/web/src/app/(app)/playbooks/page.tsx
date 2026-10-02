import { DiscoverScreen } from "@/components/playbooks/DiscoverScreen";
import { parseDiscoverUrl } from "@/components/playbooks/discoverUrl";
import { linkPreviewMetadata } from "@/lib/linkPreview";
import { playbooksPageMetadata } from "@/lib/playbooksPreview";

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
  if (cities.length !== 1 || countries.length > 0) return fallback;
  return linkPreviewMetadata(`/api/og/playbooks/city/${encodeURIComponent(cities[0]!)}`, fallback);
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
// spelling, and `DiscoverScreen` writes it back as the state changes.
export default async function PlaybooksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const initial = parseDiscoverUrl(await searchParams);
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <DiscoverScreen initial={initial} />
    </main>
  );
}
