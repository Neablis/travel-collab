import { TripBoardScreen } from "@/components/board/TripBoardScreen";
import { PageContainer } from "@/components/ui/page-container";
import { TripProvider } from "@/components/trip/context/TripProvider";
import { FocusProvider } from "@/components/trip/context/FocusProvider";
import { EditorHost } from "@/components/trip/context/EditorHost";
import { LensRouter } from "@/components/trip/context/LensRouter";

export default async function TripPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  // Task L1: non-full lenses (Board and Schedule — Itinerary/Daily/Trip were
  // retired in KI-20) each own a
  // PageContainer width="content" wrapper in TripBoardScreen's LensOutlet.
  // Keep the page shell's own padding at zero so it doesn't double up
  // against that inner container's px-6 on those lenses; Board/Map render
  // edge-to-edge as before.
  return (
    <PageContainer as="main" width="full" className="px-0">
      <TripProvider tripId={tripId}>
        <FocusProvider>
          <EditorHost>
            <LensRouter>
              <TripBoardScreen tripId={tripId} />
            </LensRouter>
          </EditorHost>
        </FocusProvider>
      </TripProvider>
    </PageContainer>
  );
}
