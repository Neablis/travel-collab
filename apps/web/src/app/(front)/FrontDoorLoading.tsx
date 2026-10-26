import { PageContainer } from "@/components/ui/page-container";
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";

// **The front door's first frame on a client navigation** (M54 part 4).
// Sign-in, sign-up, an invite, a shared trip and the demo each read on the
// server before they answer, and without a boundary a link to one held the
// page it came from until then. Their pages differ, so this is one neutral
// column rather than five copies of shapes that would each be wrong
// somewhere; every route's `loading.tsx` is this.
/** A front-door route while its page is on the way. */
export function FrontDoorLoading() {
  return (
    <PageContainer as="main" width="measure" className="py-16">
      <SkeletonRegion label="Loading the page" className="flex flex-col gap-4">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-4 w-full" delay={2} />
        <Skeleton className="h-4 w-4/5" delay={2} />
        <Skeleton className="mt-4 h-11 w-full" delay={3} />
      </SkeletonRegion>
    </PageContainer>
  );
}
