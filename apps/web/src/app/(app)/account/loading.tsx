import { PageContainer } from "@/components/ui/page-container";
import { Heading } from "@/components/ui/heading";
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";

// **Account's first frame on a client navigation** (M54 part 4): the heading
// is the page's own, as in its Suspense fallback, so chrome is real from the
// first frame; the settings below it are outlines until the page answers.
/** `/account` while its page is on the way. */
export default function AccountLoading() {
  return (
    <PageContainer as="main" width="content" className="flex flex-col gap-6">
      <Heading level={1}>Account</Heading>
      <SkeletonRegion label="Loading your account" className="flex flex-col gap-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-12 w-full" delay={2} />
        <Skeleton className="h-12 w-full" delay={3} />
      </SkeletonRegion>
    </PageContainer>
  );
}
