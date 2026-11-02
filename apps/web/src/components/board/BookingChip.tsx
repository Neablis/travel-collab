"use client";

import { useState } from "react";
import type { Booking } from "@tc/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Toast } from "@/components/ui/toast";
import { safeHttpUrl } from "@/lib/bookingLink";

/**
 * **"Booked · Provider" on a stop's card** (M44 decision 1, ADR-086). It shows
 * for anyone who can see the stop; it does something only when there is
 * something to do. An editor's tap copies the confirmation and, if the booking
 * has a link, offers to open it. A reader's booking arrives from the server as
 * the provider alone (part 3), so with nothing to copy or open the chip is a
 * plain label rather than a button that does nothing.
 *
 * The link is offered only if it parses as http: or https: (`safeHttpUrl`):
 * a snapshot read from the log is not re-validated, and `javascript:` is a
 * valid URL.
 */
export function BookingChip({ booking, readOnly }: { booking: Pick<Booking, "confirmation" | "url"> & { provider?: string | null }; readOnly: boolean }) {
  const [notice, setNotice] = useState<{ message: string; href: string | null } | null>(null);
  const label = booking.provider == null ? "Booked" : `Booked · ${booking.provider}`;
  const href = safeHttpUrl(booking.url);
  const acts = !readOnly && (booking.confirmation !== undefined || href !== null);

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
        <Button variant="ghost" aria-label={label} onClick={() => void tap()} className="pointer-events-auto h-auto min-w-0 shrink-0 rounded-full p-0 hover:bg-transparent fine:min-h-0">
          <Badge variant="success" className="px-1.5 py-0">{label}</Badge>
        </Button>
      ) : (
        <Badge variant="success" className="shrink-0 px-1.5 py-0">{label}</Badge>
      )}
      {notice !== null && (
        <Toast
          message={notice.message}
          actionLabel={notice.href === null ? undefined : "Open link"}
          onAction={notice.href === null ? undefined : () => window.open(notice.href!, "_blank", "noopener,noreferrer")}
          onDismiss={() => setNotice(null)}
        />
      )}
    </>
  );
}
