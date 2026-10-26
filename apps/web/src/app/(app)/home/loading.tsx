import { PageContainer } from "@/components/ui/page-container";
import { NextTripHeroSkeleton, TripGridSkeleton } from "@/components/home/HomeSkeletons";

// **Home's first frame on a client navigation** (M54 part 4). Home reads the
// trip list on the server before it answers, and without a boundary a link
// here held the page it came from until that read was done. These are the
// skeletons `HomeScreen` draws while it reads the list itself, in its own
// `<main>` and `.home-stack`, so the hand-over moves as little as it can.
/** `/home` while its page is on the way: the hero's and the grid's skeletons. */
export default function HomeLoading() {
  return (
    <PageContainer as="main" width="content" className="home-rhythm min-w-0 flex-1">
      <div className="home-stack">
        <NextTripHeroSkeleton />
        <TripGridSkeleton />
      </div>
    </PageContainer>
  );
}
