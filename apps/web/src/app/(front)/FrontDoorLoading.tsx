import { FrontDoorHeader } from "@/components/front/FrontDoorHeader";
import { PageContainer } from "@/components/ui/page-container";
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";

// **The front door's first frame on a client navigation** (M54 part 4).
// Sign-in, sign-up, an invite and a shared trip are dynamic routes, so a link
// to one waits on a server round-trip (sign-up with `?code=` and the invite
// also fetch a link preview for their metadata), and without a boundary it
// held the page it came from until then. Their pages differ, so this is one
// neutral column rather than copies of shapes that would each be wrong
// somewhere, under the header each of them draws. `/demo` and its trips have
// none: they are prerendered and prefetched whole, so one would never show.
/** A front-door route while its page is on the way. */
export function FrontDoorLoading() {
  return (
    <>
      <FrontDoorHeader />
      <PageContainer as="main" width="measure" className="py-16">
        <SkeletonRegion label="Loading the page" className="flex flex-col gap-4">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-4 w-full" delay={2} />
          <Skeleton className="h-4 w-4/5" delay={2} />
          <Skeleton className="mt-4 h-11 w-full" delay={3} />
        </SkeletonRegion>
      </PageContainer>
    </>
  );
}
