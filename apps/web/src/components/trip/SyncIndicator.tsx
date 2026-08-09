import { DataText } from "@/components/ui/data-text";

// KI-5: the optimistic send queue drops still-queued commands with no error
// on abrupt navigation. This is the visible half of the recorded fix — it
// doesn't block navigation, it just makes "something hasn't saved yet" true
// to the eye instead of silent.
export function SyncIndicator({ pending, className }: { pending: boolean | number; className?: string }) {
  return (
    <DataText as="span" role="status" size="xs" className={className}>
      {pending ? "Saving…" : "All changes saved"}
    </DataText>
  );
}
