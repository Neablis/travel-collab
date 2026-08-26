import { Button } from "@/components/ui/button";
import { DataText } from "@/components/ui/data-text";
import { cn } from "@/lib/cn";
import type { SendFailure } from "@/components/trip/context/optimistic";

// KI-5: the optimistic send queue drops still-queued commands with no error
// on abrupt navigation. This is the visible half of the recorded fix — it
// doesn't block navigation, it just makes "something hasn't saved yet" true
// to the eye instead of silent.
//
// Task 8b.3 / KI-36: the design's third state (dc.html:3106-3120) now ships,
// with different copy. The design labels it `Couldn't save — retrying`; we
// retry only when the user asks, so "retrying" would be a lie the moment it
// rendered. What ships is `Couldn't save` plus a real Retry button — the
// divergence is deliberate and is the whole reason KI-36 existed: the state
// was held back rather than shipping copy the behaviour could not back up.
//
// Everything this renders is something the state can actually supply:
// `unsent` is the live length of the retained pending queue (KI-36 stopped
// discarding it), and the failure is a recorded event, not an inference. The
// failure timestamp (`failure.at`) is deliberately NOT rendered here: an
// honest "(since 3 minutes ago)" needs a ticking clock this component does
// not have, and the trip chrome has no room for an absolute one. It is
// exposed on the trip context for the sync-failure banner (Task 8b.4, still
// descoped) to render when that ships.
export function SyncIndicator({
  unsent,
  failure,
  onRetry,
  className,
}: {
  unsent: number;
  failure?: SendFailure | null;
  // Required alongside `failure` by construction — the failed state always
  // offers a way out, so it can never render as a dead end.
  onRetry: () => void;
  className?: string;
}) {
  const failed = Boolean(failure);
  const saving = !failed && unsent > 0;
  const changes = `${unsent} ${unsent === 1 ? "change" : "changes"}`;
  const label = failed ? "Couldn't save" : saving ? "Saving…" : "All changes saved";
  // The accessible name carries the count the visible chip has no room for.
  const name = failed ? `Couldn't save — ${changes} not sent` : label;
  // The saved state renders a bare dot — no text label (dc.html:3106-3120's
  // `sc-if value="{{ syncBusy }}"` gates the label to saving/error only).
  // `title`/`aria-label` carry the accessible name either way, so a screen
  // reader still gets "All changes saved" with nothing drawn to read it from.
  //
  // a11y: this stays `role="status"` (polite) even when failed, rather than
  // flipping to `role="alert"`. Two reasons — the page already raises the
  // server's rejection message in its own `role="alert"` (TripBoardScreen),
  // so an assertive second announcement of one event would just talk over
  // itself; and swapping a live region's role on a mounted node is unreliable
  // in assistive tech, which registers the region when it mounts. The failed
  // state does have visible text (unlike the saved state), so the existing
  // polite region announces it on change, and the Retry control is a real
  // focusable button with its own descriptive name.
  return (
    <span role="status" title={name} aria-label={name} className={cn("inline-flex items-center gap-[7px]", className)}>
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
          className={cn("absolute rounded-full", failed ? "bg-danger" : saving ? "bg-brand" : "bg-success-ink")}
          // eslint-disable-next-line no-restricted-syntax -- 11px dot (handoff dc.html:3110) has no token equivalent
          style={{ width: "11px", height: "11px" }}
        />
      </span>
      {(saving || failed) && (
        <DataText as="span" size="xs" className={cn("font-medium", failed ? "text-danger" : "text-brand")}>
          {label}
        </DataText>
      )}
      {failed && (
        <Button variant="ghost" size="sm" aria-label={`Retry saving ${changes}`} onClick={onRetry}>
          Retry
        </Button>
      )}
    </span>
  );
}
