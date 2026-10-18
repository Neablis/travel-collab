// Sentry in the browser: loaded on every page load, before the app renders.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/
//
// No browser profiling (Mitchell, 2026-10-18; ADR-032's amendment of that
// date): it cost every visitor its code in the every-page chunk to sample
// Chromium alone. The server still profiles: `sentry.server.config.ts`.
import * as Sentry from "@sentry/nextjs";
import { sampleRate, scrubReplayRecordingEvent, scrubSentryPayload, sharedSentryOptions } from "../sentry.shared";

Sentry.init({
  ...sharedSentryOptions,

  integrations: [
    Sentry.replayIntegration({
      // Session Replay is the one signal `sharedSentryOptions`' `beforeSend`
      // cannot reach, and it is the signal most likely to hold a share token:
      // it records `location.href` for every navigation. The recording payload
      // is not an event at all — it is a stream of rrweb frames, and the
      // navigation breadcrumbs and `performanceSpan` descriptions inside it
      // carry the URL. This is the only callback the SDK offers on that path.
      beforeAddRecordingEvent: scrubReplayRecordingEvent,
    }),
  ],

  // Replay: 10% of sessions, and every session that hit an error. Unchanged
  // from the wizard's values, now reading the environment so they can be
  // turned down without a deploy.
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
// SDK routes around `beforeSend`.
Sentry.addEventProcessor(scrubSentryPayload);

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
