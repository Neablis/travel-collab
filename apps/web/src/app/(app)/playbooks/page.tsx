import { DiscoverScreen } from "@/components/playbooks/DiscoverScreen";

// `/playbooks` — Discover (M11b link 5). This route used to be an 18-line shell
// rendering mock cards inside `<Preview id="playbooks-route">`; that shell is
// deleted, not re-pointed.
//
// Nested routes (`day`, `board`, `profile`) sit under this path so `proxy.ts`'s
// existing `/playbooks/:path*` matcher covers them with no change, and they are
// signed-in surfaces rather than anonymous ones — the exit gate's wording is
// "findable by another signed-in account".
export default async function PlaybooksPage({
  searchParams,
}: {
  searchParams: Promise<{ city?: string | string[] }>;
}) {
  const { city } = await searchParams;
  const initialCities = city === undefined ? [] : Array.isArray(city) ? city : [city];
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <DiscoverScreen initialCities={initialCities} />
    </main>
  );
}
