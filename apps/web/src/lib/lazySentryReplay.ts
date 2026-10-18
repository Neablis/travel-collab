// Session Replay, added after the page has finished loading rather than in
// `Sentry.init` (Mitchell, 2026-10-18). Lighthouse on production put the shared
// client chunk at ~160KB gz, ~2.0s of script evaluation under a 4x CPU
// throttle, on every page, and Replay's rrweb recorder was the largest single
// thing in it. A replay that starts a second late loses that second of
// recording; a page that waits for rrweb before it can respond loses it for
// every visitor, sampled or not.
//
// Errors in that first second are still captured as events. What they miss is
// the replay: `replaysOnErrorSampleRate` buffers only from the moment the
// integration is added.
import { addIntegration } from "@sentry/nextjs";

/** The slice of `window` this needs, so a test can hand it a fake one. */
export type IdleWindow = {
  document: { readyState: DocumentReadyState };
  addEventListener(type: "load", listener: () => void, options: { once: true }): void;
  setTimeout(handler: () => void, timeout: number): unknown;
  requestIdleCallback?: (callback: () => void, options: { timeout: number }) => unknown;
};

// How long an idle callback may be postponed by a busy main thread before it
// runs anyway. Replay must arrive eventually on a page that never goes idle.
const IDLE_DEADLINE_MS = 5_000;
// Safari ships no `requestIdleCallback`. After `load` a short delay is the
// nearest equivalent: it yields to whatever `load` handlers queued first.
const NO_IDLE_CALLBACK_DELAY_MS = 2_000;

/**
 * Run `task` once the page has loaded and the main thread is next idle —
 * `requestIdleCallback` where it exists, a timer where it does not.
 */
export function afterPageIdle(task: () => void, win: IdleWindow): void {
  const whenIdle = () => {
    if (win.requestIdleCallback) win.requestIdleCallback(task, { timeout: IDLE_DEADLINE_MS });
    else win.setTimeout(task, NO_IDLE_CALLBACK_DELAY_MS);
  };
  if (win.document.readyState === "complete") whenIdle();
  else win.addEventListener("load", whenIdle, { once: true });
}

/**
 * Add Session Replay to the running Sentry client once the page is idle, or
 * never when Sentry is off (`sentryEnabled` false: a preview, or a blank DSN).
 * Off means the Replay chunk is not even downloaded.
 */
export function loadSentryReplayWhenIdle(enabled: boolean, win: IdleWindow = window): void {
  if (!enabled) return;
  afterPageIdle(() => {
    // The `import()` is the whole point: it is what makes `sentryReplay.ts`
    // a separate chunk. A chunk that fails to load (a deploy replaced it, the
    // network dropped) costs this session its replay and nothing else, so the
    // rejection is swallowed rather than surfacing as an unhandled error that
    // Sentry would then report about itself.
    import("./sentryReplay").then(
      ({ sentryReplayIntegration }) => addIntegration(sentryReplayIntegration()),
      () => {},
    );
  }, win);
}
