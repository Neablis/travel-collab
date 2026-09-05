// Sentry in the browser: loaded on every page load, before the app renders.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/
import * as Sentry from "@sentry/nextjs";
import {
  profileSessionSampleRate,
  sampleRate,
  scrubReplayRecordingEvent,
  scrubSentryPayload,
  sharedSentryOptions,
} from "../sentry.shared";

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
    // Browser profiling uses the JS Self-Profiling API, which a page may only
    // call if the response carried `Document-Policy: js-profiling`. That
    // header is set in `next.config.ts`, and the pairing is the whole feature:
    // without it this integration initialises, fails to construct a
    // `Profiler`, and disables itself for the session with nothing in the
    // console outside a debug build. `next.config.test.ts` asserts the header
    // so the two cannot drift apart.
    //
    // Chromium-only today (Firefox and Safari ship no Self-Profiling API), so
    // this is a sample of the traffic rather than all of it, by construction.
    Sentry.browserProfilingIntegration(),
  ],

  // Same deal as the server: profile only while a sampled root span is open,
  // which in the browser means a page load or a route transition rather than
  // the whole time a tab sits open.
  profileLifecycle: "trace",
  profileSessionSampleRate,

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
