import { LeaderboardScreen } from "@/components/playbooks/LeaderboardScreen";

// The leaderboard (M11b link 7). Entered from Discover's "Who shares the most"
// and from nowhere else — it is trip-independent but not account scope, so
// project rule 1 keeps it out of the top bar.
export default function LeaderboardPage() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <LeaderboardScreen />
    </main>
  );
}
