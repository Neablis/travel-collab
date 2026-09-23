import { DiscoverScreen } from "@/components/playbooks/DiscoverScreen";
import { parseDiscoverUrl } from "@/components/playbooks/discoverUrl";

// `/playbooks` — Discover (M11b link 5). This route used to be an 18-line shell
// rendering mock cards inside `<Preview id="playbooks-route">`; that shell is
// deleted, not re-pointed.
//
// Nested routes (`day`, `board`, `profile`) sit under this path so `proxy.ts`'s
// existing `/playbooks/:path*` matcher covers them with no change, and they are
// signed-in surfaces rather than anonymous ones — the exit gate's wording is
// "findable by another signed-in account".
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
