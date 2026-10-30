import { PlaybookAskButton } from "@/components/assistant/BeyondTripAssistant";
import { DiscoverLoading } from "@/components/playbooks/DiscoverSkeleton";

// **Discover's first frame on a client navigation** (Mitchell, 2026-10-30:
// "It should swap instantly, then load in data"). The page reads the library
// on the server before it answers, and without a boundary a link here held
// the page it came from until that read was done, which is `home/loading.tsx`'s
// reason too. In a route group of its own so it stands in for Discover alone:
// at `live/` it would also be the first frame of every day, profile and place
// page under it.
//
// The live copy is the signed-in reader's (`lib/playbooksReader.ts`), so the
// frame keeps room for the scope tabs they get.
/** `/playbooks` while its page is on the way. */
export default function DiscoverRouteLoading() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <DiscoverLoading scopeTabs action={<PlaybookAskButton />} />
    </main>
  );
}
