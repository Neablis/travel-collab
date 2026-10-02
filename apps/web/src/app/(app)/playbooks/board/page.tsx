import { LeaderboardScreen } from "@/components/playbooks/LeaderboardScreen";
import { PLAYBOOKS_BOARD, PLAYBOOKS_CARD_PATH, playbooksPageMetadata } from "@/lib/playbooksPreview";

// Spec 2026-10-02 §2.7: the static Playbooks card, with the board's heading.
export const metadata = playbooksPageMetadata(
  PLAYBOOKS_BOARD.title,
  PLAYBOOKS_BOARD,
  `${PLAYBOOKS_CARD_PATH}?board=1`,
);

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
