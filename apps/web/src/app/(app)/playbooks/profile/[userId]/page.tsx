import { ProfileScreen } from "@/components/playbooks/ProfileScreen";
import { backTarget } from "@/components/playbooks/backLink";

// A public profile (M11b link 8). Reachable three ways — from a shared day,
// from the board and from Discover — so the back link is contextual.
export default async function PublicProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ from?: string; day?: string }>;
}) {
  const [{ userId }, { from, day }] = await Promise.all([params, searchParams]);
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <ProfileScreen userId={decodeURIComponent(userId)} back={backTarget({ from, day })} />
    </main>
  );
}
