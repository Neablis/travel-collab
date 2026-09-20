"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";

// **A trip comes back from a file** (M25 link 2, the upload half).
//
// **It posts to `POST /api/v1/trips/import` — the same endpoint an API caller
// uses.** A session cookie satisfies every scope on a `v1` route
// (`public-api/actor.ts`), so the browser needs no token and there is no second
// route to keep in step. And because it is not `apiClient`, it costs no MSW
// handler: M22's one named exception to "endpoint N+1 is free" is an endpoint
// the frontend adopts through that client, and this is a `fetch` of a file.
//
// **Free to every plan, and nothing here enforces it.** The absence is the
// point: `api.tokens` gates minting and verifying a TOKEN, never a session, so
// a `free` account meets no paywall between this control and their trip.
//
// **The file's own bytes are posted, not a re-serialisation of them.** Reading
// it to text and sending that text means the server measures the same bytes the
// person chose, so the limit it names in a refusal is the limit they can act on
// — `JSON.parse` then `JSON.stringify` would quietly reshape the size it is
// measured against.

/** Anything the server said, or anything that stopped us reaching it. */
type Failure = { message: string };

export function ImportTripButton({
  disabled = false,
  size,
  className,
}: {
  disabled?: boolean;
  /** `sm` on the first-run card, where it sits beside the other routes in. */
  size?: "sm" | "md";
  className?: string;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);

  async function importFile(file: File) {
    setBusy(true);
    setFailure(null);
    try {
      const response = await fetch("/api/v1/trips/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: await file.text(),
      });
      if (!response.ok) {
        // **The server's own words, and its envelope is the only shape `v1`
        // has.** Its refusals are already written for a person to act on —
        // which file is too large and what the limit is, that a bundle holds
        // two trips — so restating them here would be a second copy that
        // drifts. The fallback is for a response that never reached the route
        // at all (a proxy, a signed-out redirect).
        const body = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        setFailure({
          message: body?.error?.message ?? "That file could not be imported. Try again.",
        });
        return;
      }
      const trip = (await response.json()) as { tripId: string };
      router.push(`/trips/${trip.tripId}`);
    } catch {
      setFailure({ message: "That file could not be imported. Try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        {...(size ? { size } : {})}
        {...(className ? { className } : {})}
        disabled={disabled || busy}
        onClick={() => input.current?.click()}
      >
        {busy ? "Importing…" : "Import a file"}
      </Button>
      {/* Hidden rather than styled, because a file input cannot be restyled
          across browsers and a visible one here would be the only control on
          this page that does not look like the others. The button above is the
          accessible name; the input is reached only through it.

          `accept` is a hint a person can override in their own file picker, so
          it narrows what they are offered and never what the server takes —
          the refusal for a file that is not a bundle is the endpoint's 400,
          which says what is wrong with it. */}
      {/* eslint-disable-next-line no-restricted-syntax -- a `display:none` file
          picker has no design surface to render through: it draws nothing, and
          `Input` exists to apply a height, a border and a background that this
          element by definition never shows. Same escape hatch, and same kind of
          reasoning, as ActivityCard's tag chip. */}
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        // Rung 3 of the locator ladder (`docs/guidelines/testing.md`): this
        // element deliberately has no accessible identity — the button above is
        // the one control in the a11y tree — so a testid is how a test reaches
        // it. It names structure, not content.
        data-testid="trip-file-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Cleared so that choosing the SAME file twice fires `change` again —
          // otherwise a failed import cannot be retried without picking a
          // different file, which looks like the button being dead.
          event.target.value = "";
          if (file !== undefined) void importFile(file);
        }}
      />
      {/* **A refusal is the server's own words in a BANNER** (§34.2, M26 link
          9c). It was a line of danger-coloured text — which reads as a field
          error beside a control, not as "the file you chose was turned away".
          The words are unchanged; `v1`'s refusals are already written for a
          person to act on (which file is too large and what the limit is, that
          a bundle holds two trips), and restating them here would be a second
          copy that drifts.

          `role="alert"` overrides `Banner`'s default `role="status"`: this
          lands after the reader has chosen a file and looked away from the
          button, which is worth interrupting for. */}
      {failure !== null && (
        <Banner variant="danger" role="alert" className="w-full">
          {failure.message}
        </Banner>
      )}
    </>
  );
}
