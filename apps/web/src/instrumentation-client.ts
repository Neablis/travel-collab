// Sentry in the browser: loaded on every page load, before the app renders.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/
//
// Everything imported here lands in the chunk every page parses before it can
// respond, so this file holds only what has to be on from the first frame:
// errors and tracing. Session Replay is added once the page is idle
// (`lib/lazySentryReplay.ts`), and browser profiling is gone altogether
// (Mitchell, 2026-10-18; ADR-032's amendment of that date). The server still
// profiles: `sentry.server.config.ts`.
import * as Sentry from "@sentry/nextjs";
import { sampleRate, scrubSentryPayload, sentryEnabled, sharedSentryOptions } from "../sentry.shared";
import { loadSentryReplayWhenIdle } from "./lib/lazySentryReplay";

Sentry.init({
  ...sharedSentryOptions,

  // Replay: 10% of sessions, and every session that hit an error. Unchanged
  // from the wizard's values, now reading the environment so they can be
  // turned down without a deploy. Set here at init even though the
  // integration arrives later: Replay reads both off the client's options
  // when it is added.
  replaysSessionSampleRate: sampleRate(process.env.NEXT_PUBLIC_SENTRY_REPLAYS_SESSION_SAMPLE_RATE, 0.1),
  replaysOnErrorSampleRate: sampleRate(process.env.NEXT_PUBLIC_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE, 1.0),

  dataCollection: {
    // Same reasoning as the server config: stated, not defaulted.
    genAI: { inputs: false, outputs: false },
  },
});

// The replay *envelope* — the `replay_event` carrying `urls`, one entry per
// page the session visited — skips `beforeSend` too: `prepareReplayEvent` in
// `@sentry/replay` calls `prepareEvent` and sends, never `_processEvent`, which
// is where `beforeSend` lives. Event processors DO run inside `prepareEvent`,
// so this is the hook that covers it. Applied to every event rather than only
// to `replay_event`: `scrubSentryPayload` is idempotent, so the overlap with
// `beforeSend` costs one extra walk and buys cover for the next event type the
// SDK routes around `beforeSend`. Registered before Replay is added, so no
// replay envelope can be sent without it.
Sentry.addEventProcessor(scrubSentryPayload);

loadSentryReplayWhenIdle(sentryEnabled);

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
