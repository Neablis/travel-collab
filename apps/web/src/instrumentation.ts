import * as Sentry from "@sentry/nextjs";
import type { Instrumentation } from "next";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

// KI-2026-10-03-a. React's Node renderers (Fizz and Flight) abort a render with
// exactly this Error when the stream they are piping into closes before they
// finish, which is what happens when the browser cancels the request: a
// `<Link>` prefetch abandoned by navigating away, a tab closed mid-load.
// Next filters its own aborts by name (`AbortError`, `ResponseAborted`) and
// this one is a plain `Error`, so where React's error is what Next sees it
// reaches us as an unhandled request error, with nothing anyone could fix.
//
// Matched on the whole message, not a substring, and nothing else is dropped:
// "The destination stream errored while writing data." is React's other cancel
// message and still reported, because a write error is not known to be a
// client leaving. `instrumentation.test.ts` makes both renderers produce the
// real error (react-dom's Fizz, and the Flight server Next bundles), so a
// reworded message in a React or Next upgrade turns that test red instead of
// quietly reopening the noise.
const CLIENT_CLOSED_STREAM = "The destination stream closed early.";

function isClientClosedStream(err: unknown): boolean {
  return err instanceof Error && err.message === CLIENT_CLOSED_STREAM;
}

// This filters what reaches Sentry and nothing else. Under next@16.3 Next also
// printed its own `⨯ Error: The destination stream closed early.` line after
// this hook returned. Since next@16.4 its Flight wrapper (every traced case: an
// RSC prefetch) aborts with `ResponseAborted` first, which Next drops before
// either this hook or that line; `instrumentation.test.ts` pins that. The
// filter stays for any renderer that still hands over React's plain error.
/**
 * Next's request-error hook: reports a server error to Sentry, except a
 * render the client abandoned mid-stream, which is dropped.
 */
export const onRequestError: Instrumentation.onRequestError = (err, request, context) => {
  if (isClientClosedStream(err)) return;
  Sentry.captureRequestError(err, request, context);
};
