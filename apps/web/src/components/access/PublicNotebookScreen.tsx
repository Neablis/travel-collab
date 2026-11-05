import { FrontDoorHeader } from "@/components/front/FrontDoorHeader";
import { PublicPageDoc } from "@/components/pages/editor/ReadOnlyPageDoc";
import type { PublicDoc } from "@/lib/publicDoc";
import { Heading } from "@/components/ui/heading";
import { PageContainer } from "@/components/ui/page-container";
import { PublicCta } from "./PublicCta";

/** What crosses from the server to this page: a title, a resolved document and its accents. Nothing about the trip. */
export interface PublicNotebookViewProp extends PublicDoc {
  title: string;
}

/**
 * `/n/<token>`, as a stranger reads it (M58, ADR-088): the notebook the
 * publisher chose, then the band that invites them to plan their own trip.
 *
 * The same page for everyone, members included (decision 6): no
 * *Open in the trip*, no join and no invite, because this page has no trip to
 * open. It holds nothing but the view the server resolved, so there is no
 * provider here and no request to make.
 */
export function PublicNotebookScreen({ view }: { view: PublicNotebookViewProp }) {
  return (
    <div className="min-h-screen bg-paper">
      <FrontDoorHeader />
      <PageContainer as="main" className="pt-8 pb-16">
        <Heading level={1} className="mb-4">
          {view.title}
        </Heading>
        {/* Only these two cross to the client component, not `view` whole. */}
        <PublicPageDoc doc={{ content: view.content, accents: view.accents }} />
        <PublicCta />
      </PageContainer>
    </div>
  );
}
