import { TripBoardScreen } from "@/components/board/TripBoardScreen";

export default async function TripPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  return <TripBoardScreen tripId={tripId} />;
}
