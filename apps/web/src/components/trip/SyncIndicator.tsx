import { DataText } from "@/components/ui/data-text";
import { cn } from "@/lib/cn";

// KI-5: the optimistic send queue drops still-queued commands with no error
// on abrupt navigation. This is the visible half of the recorded fix — it
// doesn't block navigation, it just makes "something hasn't saved yet" true
// to the eye instead of silent.
//
// Task 8b.3: the design (dc.html:3106-3120) has a third, "error" state
// ("Couldn't save — retrying") that this component deliberately does not
// ship. `optimistic.ts`'s `failHead` discards the whole pending queue on a
// failed send rather than recording a failure — there's no retry, no
// persisted count, nothing to render truthfully as "retrying". `pending`
// stays `boolean | number`, matching the queue's actual two states.
export function SyncIndicator({ pending, className }: { pending: boolean | number; className?: string }) {
  const saving = Boolean(pending);
  const label = saving ? "Saving…" : "All changes saved";
  // The saved state renders a bare dot — no text label (dc.html:3106-3120's
  // `sc-if value="{{ syncBusy }}"` gates the label to saving/error only).
  // `title`/`aria-label` carry the accessible name either way, so a screen
  // reader still gets "All changes saved" with nothing drawn to read it from.
  return (
    <span role="status" title={label} aria-label={label} className={cn("inline-flex items-center gap-[7px]", className)}>
      <span
        aria-hidden
        className="relative grid place-items-center"
        // eslint-disable-next-line no-restricted-syntax -- 22px indicator square (handoff dc.html:3106) has no token equivalent, matching AssistantRail's computed-geometry pattern
        style={{ width: "22px", height: "22px" }}
      >
        {saving && (
          <>
            <span
              aria-hidden
              className="sync-halo absolute rounded-full bg-brand"
              // eslint-disable-next-line no-restricted-syntax -- 12px halo (handoff dc.html:3109) has no token equivalent
              style={{ width: "12px", height: "12px" }}
            />
            <span
              aria-hidden
              className="sync-halo sync-halo-delayed absolute rounded-full bg-brand"
              // eslint-disable-next-line no-restricted-syntax -- second 12px halo, 0.7s animation-delay (handoff dc.html:3109) has no token equivalent
              style={{ width: "12px", height: "12px" }}
            />
          </>
        )}
        <span
          aria-hidden
          className={cn("absolute rounded-full", saving ? "bg-brand" : "bg-success-ink")}
          // eslint-disable-next-line no-restricted-syntax -- 11px dot (handoff dc.html:3110) has no token equivalent
          style={{ width: "11px", height: "11px" }}
        />
      </span>
      {saving && (
        <DataText as="span" size="xs" className="font-medium text-brand">
          {label}
        </DataText>
      )}
    </span>
  );
}
