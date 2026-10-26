import { PageContainer } from "@/components/ui/page-container";
import { Heading } from "@/components/ui/heading";
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";

// **Plans' first frame on a client navigation** (M54 part 4): the heading is
// the page's own, as in its Suspense fallback, so chrome is real from the
// first frame; the list below it is outlines until the page answers.
/** `/plans` while its page is on the way. */
export default function PlansLoading() {
  return (
    <PageContainer as="main" className="flex flex-col gap-6">
      <Heading level={1}>Plans</Heading>
      <SkeletonRegion label="Loading your plans" className="flex flex-col gap-3">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" delay={2} />
        <Skeleton className="h-16 w-full" delay={3} />
      </SkeletonRegion>
    </PageContainer>
  );
}
