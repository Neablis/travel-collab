import { PlaybookAskButton } from "@/components/assistant/BeyondTripAssistant";
import { DiscoverLoading } from "@/components/playbooks/DiscoverSkeleton";

// The cached copy's first frame (`../../live/(discover)/loading.tsx` says why
// there is one). Only a reader with no session is sent here, so no scope tabs.
/** `/playbooks` while its cached page is on the way. */
export default function CachedDiscoverRouteLoading() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <DiscoverLoading scopeTabs={false} action={<PlaybookAskButton />} />
    </main>
  );
}
