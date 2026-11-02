"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import type { ActivityView } from "@tc/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useOptionalTrip } from "@/components/trip/context/TripProvider";
import { Toast } from "@/components/ui/toast";
import { safeHttpUrl } from "@/lib/bookingLink";

/**
 * **"Booked · Provider" on a stop's card** (M44 decision 1, ADR-086). It shows
 * for anyone who can see the stop; it does something only when there is
 * something to do. An editor's or owner's tap copies the confirmation and, if
 * the booking has a link, offers to open it. Anyone else gets a plain label
 * (decision 1: inert below editor), whatever the booking holds; the server has
 * also taken the code out of what they were sent (part 3). The role is read
 * from the trip rather than passed down through the board: an unknown role
 * (not loaded yet, or outside a trip) is inert too.
 *
 * The notice is portalled to the body: a block's content is
 * `pointer-events-none`, which a child inherits, and the block dims and drags
 * as a whole. Its pointer-downs are stopped at the portal so a tap on
 * "Open link" never reads as a touch-press on the block underneath.
 *
 * The link is offered only if it parses as http: or https: (`safeHttpUrl`):
 * a snapshot read from the log is not re-validated, and `javascript:` is a
 * valid URL.
 */
export function BookingChip({ booking }: { booking: NonNullable<ActivityView["booking"]> }) {
  const myRole = useOptionalTrip()?.myRole;
  const [notice, setNotice] = useState<{ message: string; href: string | null } | null>(null);
  const label = booking.provider == null ? "Booked" : `Booked · ${booking.provider}`;
  const href = safeHttpUrl(booking.url);
  const acts = (myRole === "editor" || myRole === "owner") && (booking.confirmation !== undefined || href !== null);

  async function tap() {
    let message = "Opening the booking link";
    if (booking.confirmation !== undefined) {
      try {
        await navigator.clipboard.writeText(booking.confirmation);
        message = "Confirmation copied";
      } catch {
        message = "Couldn't copy the confirmation";
      }
    }
    setNotice({ message, href });
  }

  return (
    <>
      {acts ? (
        <Button variant="ghost" aria-label={`${label}, copy confirmation`} onClick={() => void tap()} className="pointer-events-auto h-auto min-w-0 shrink-0 rounded-full p-0 hover:bg-transparent fine:min-h-0">
          <Badge variant="success" className="px-1.5 py-0">{label}</Badge>
        </Button>
      ) : (
        <Badge variant="success" className="shrink-0 px-1.5 py-0">{label}</Badge>
      )}
      {notice !== null &&
        createPortal(
          // `contents`: no box of its own, only a place to stop the pointer.
          <div className="contents" onPointerDown={(e) => e.stopPropagation()}>
            <Toast
              message={notice.message}
              actionLabel={notice.href === null ? undefined : "Open link"}
              onAction={notice.href === null ? undefined : () => window.open(notice.href!, "_blank", "noopener,noreferrer")}
              onDismiss={() => setNotice(null)}
            />
          </div>,
          document.body,
        )}
    </>
  );
}
