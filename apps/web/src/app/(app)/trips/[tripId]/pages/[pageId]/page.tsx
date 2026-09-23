import { PageScreen } from "@/components/pages/PageScreen";

export default async function NotebookPagePage({
  params,
  searchParams,
}: {
  params: Promise<{ tripId: string; pageId: string }>;
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const { tripId, pageId } = await params;
  // Narrowed here, at the edge: `?from=` is whatever a URL says, and the one
  // value PageScreen acts on is Overview's Edit (M27 D6).
  const { from } = await searchParams;
  return <PageScreen tripId={tripId} pageId={pageId} from={from === "overview" ? "overview" : null} />;
}
