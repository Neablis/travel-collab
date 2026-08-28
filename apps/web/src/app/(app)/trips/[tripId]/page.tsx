import { TripBoardScreen } from "@/components/board/TripBoardScreen";
import { PageContainer } from "@/components/ui/page-container";
import { TripProvider } from "@/components/trip/context/TripProvider";
import { FocusProvider } from "@/components/trip/context/FocusProvider";
import { EditorHost } from "@/components/trip/context/EditorHost";
import { LensRouter } from "@/components/trip/context/LensRouter";

// "Trip plan — Caesura" via the layout's title template. Deliberately not a
// per-trip generateMetadata: the lint wall keeps `@/server/*` out of page
// files, this route is auth-gated so an unfurl scraper never reaches it
// (middleware 307s it to /signin, whose generateMetadata carries the
// shared-trip card — see that file), and a private trip's name shouldn't be
// in anonymous <head> output anyway. Real per-trip OpenGraph belongs to
// M11's share links, where read access becomes deliberate.
export const metadata = { title: "Trip plan" };

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
