import { TripBoardScreen } from "@/components/board/TripBoardScreen";
import { PageContainer } from "@/components/ui/page-container";
import { TripProvider } from "@/components/trip/context/TripProvider";
import { EditorHost } from "@/components/trip/context/EditorHost";
import { LensRouter } from "@/components/trip/context/LensRouter";

export default async function TripPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  return (
    <PageContainer as="main" width="full">
      <TripProvider tripId={tripId}>
        <EditorHost>
          <LensRouter>
            <TripBoardScreen tripId={tripId} />
          </LensRouter>
        </EditorHost>
      </TripProvider>
    </PageContainer>
  );
}
