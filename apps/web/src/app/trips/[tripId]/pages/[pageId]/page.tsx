import { PageScreen } from "@/components/pages/PageScreen";

export default async function NotebookPagePage({
  params,
}: {
  params: Promise<{ tripId: string; pageId: string }>;
}) {
  const { tripId, pageId } = await params;
  return <PageScreen tripId={tripId} pageId={pageId} />;
}
