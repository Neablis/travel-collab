import { PublicCta } from "@/components/access/PublicCta";
import { FrontDoorHeader } from "@/components/front/FrontDoorHeader";
import { Heading } from "@/components/ui/heading";
import { PageContainer } from "@/components/ui/page-container";
import { Text } from "@/components/ui/text";

// One body for a link that is unknown, turned off, or whose notebook or trip is
// gone (ADR-088 §3): "this was made private" would confirm the notebook
// exists, so this names no title, no trip and no reason. It does keep the way
// in to a trip of the reader's own.
/** The 404 for `/n/<token>`. */
export default function PublicNotebookNotFound() {
  return (
    <div className="min-h-screen bg-paper">
      <FrontDoorHeader />
      <PageContainer as="main" className="pt-14 pb-16">
        <Heading level={1}>This page is not here</Heading>
        <Text variant="secondary">The link may have been turned off, or it may never have been shared.</Text>
        <PublicCta />
      </PageContainer>
    </div>
  );
}
