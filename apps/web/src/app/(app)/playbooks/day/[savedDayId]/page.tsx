import { SharedDayScreen } from "@/components/playbooks/SharedDayScreen";
import { backTarget } from "@/components/playbooks/backLink";

// A shared day (M11b link 6). Reachable from Discover and from a public
// profile, so the way back is contextual — see `backLink.ts` for why it rides
// the query string rather than browser history.
export default async function SharedDayPage({
  params,
  searchParams,
}: {
  params: Promise<{ savedDayId: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const [{ savedDayId }, { from }] = await Promise.all([params, searchParams]);
  const back = backTarget({ from });
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <SharedDayScreen savedDayId={savedDayId} backHref={back.href} backLabel={back.label} />
    </main>
  );
}
