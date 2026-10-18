// The Session Replay half of the browser SDK, in a module of its own so it can
// be its own chunk. Nothing imports this file statically: `lazySentryReplay.ts`
// reaches it through `import()` once the page is idle, and that is the only
// reason Replay (rrweb, ~a third of the old every-page chunk) is not parsed and
// evaluated on every page load. A static import of this file from anywhere on
// the client would quietly put it back.
import { replayIntegration } from "@sentry/nextjs";
import { scrubReplayRecordingEvent } from "../../sentry.shared";

/**
 * The Replay integration this app runs, scrubber attached, ready for
 * `Sentry.addIntegration`. The sample rates are not here: Replay reads
 * `replaysSessionSampleRate` / `replaysOnErrorSampleRate` off the client's
 * options when it is added, so they stay in `instrumentation-client.ts`'s
 * `Sentry.init`.
 */
export function sentryReplayIntegration(): ReturnType<typeof replayIntegration> {
  return replayIntegration({
    // Session Replay is the one signal `sharedSentryOptions`' `beforeSend`
    // cannot reach, and it is the signal most likely to hold a share token:
    // it records `location.href` for every navigation. The recording payload
    // is not an event at all — it is a stream of rrweb frames, and the
    // navigation breadcrumbs and `performanceSpan` descriptions inside it
    // carry the URL. This is the only callback the SDK offers on that path.
    beforeAddRecordingEvent: scrubReplayRecordingEvent,
  });
}
