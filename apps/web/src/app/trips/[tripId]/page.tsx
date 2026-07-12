import { TripBoardScreen } from "@/components/board/TripBoardScreen";

export default async function TripPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  return (
    <div className="mx-auto max-w-none px-6 py-6">
      <TripBoardScreen tripId={tripId} />
    </div>
  );
}
