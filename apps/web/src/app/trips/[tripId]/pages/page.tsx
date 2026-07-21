import { NotebookScreen } from "@/components/pages/NotebookScreen";

export default async function NotebookPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  return <NotebookScreen tripId={tripId} />;
}
