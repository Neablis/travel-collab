import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/nextjs";
import { scrubReplayRecordingEvent } from "../../sentry.shared";
import { type IdleWindow, loadSentryReplayWhenIdle } from "./lazySentryReplay";

// Both halves of the SDK this touches. `replayIntegration` returns a marker so
// the assertions can tell the integration `sentryReplay.ts` built from any
// other object reaching `addIntegration`.
vi.mock("@sentry/nextjs", () => ({
  addIntegration: vi.fn(),
  replayIntegration: vi.fn((options: unknown) => ({ name: "Replay", options })),
}));

/**
 * A window whose `load` event, idle callbacks and timers run only when the
 * test says so — the three moments `loadSentryReplayWhenIdle` waits on.
 */
function fakeWindow(readyState: DocumentReadyState, { idleCallback }: { idleCallback: boolean }) {
  const onLoad: Array<() => void> = [];
  const idle: Array<() => void> = [];
  const timers: Array<() => void> = [];
  const win: IdleWindow = {
    document: { readyState },
    addEventListener: (_type, listener) => void onLoad.push(listener),
    setTimeout: (handler) => timers.push(handler),
    ...(idleCallback ? { requestIdleCallback: (callback: () => void) => idle.push(callback) } : {}),
  };
  const drain = (queue: Array<() => void>) => queue.splice(0).forEach((run) => run());
  return {
    win,
    fireLoad: () => drain(onLoad),
    runIdle: () => drain(idle),
    runTimers: () => drain(timers),
  };
}

/** Run every queued moment, then wait for the `import()` it started. */
async function runEverything(page: ReturnType<typeof fakeWindow>) {
  page.fireLoad();
  page.runIdle();
  page.runTimers();
  await vi.dynamicImportSettled();
}

beforeEach(() => {
  vi.mocked(Sentry.addIntegration).mockClear();
});

describe("loadSentryReplayWhenIdle", () => {
  it("adds the scrubbing Replay integration only after the page has loaded and gone idle", async () => {
    const page = fakeWindow("loading", { idleCallback: true });
    loadSentryReplayWhenIdle(true, page.win);

    page.runIdle();
    await vi.dynamicImportSettled();
    expect(Sentry.addIntegration).not.toHaveBeenCalled();

    page.fireLoad();
    await vi.dynamicImportSettled();
    expect(Sentry.addIntegration).not.toHaveBeenCalled();

    page.runIdle();
    await vi.dynamicImportSettled();
    expect(Sentry.addIntegration).toHaveBeenCalledTimes(1);
    expect(Sentry.addIntegration).toHaveBeenCalledWith({
      name: "Replay",
      options: { beforeAddRecordingEvent: scrubReplayRecordingEvent },
    });
  });

  // Safari has no `requestIdleCallback`; a page that finished loading before
  // Sentry initialised never fires `load` again. Both at once is the case
  // where a missing fallback would mean Replay never arrives at all.
  it("falls back to a timer where there is no idle callback, on a page that has already loaded", async () => {
    const page = fakeWindow("complete", { idleCallback: false });
    loadSentryReplayWhenIdle(true, page.win);
    expect(Sentry.addIntegration).not.toHaveBeenCalled();

    page.runTimers();
    await vi.dynamicImportSettled();
    expect(Sentry.addIntegration).toHaveBeenCalledTimes(1);
  });

  it("never adds Replay when Sentry is off", async () => {
    const page = fakeWindow("loading", { idleCallback: true });
    loadSentryReplayWhenIdle(false, page.win);

    await runEverything(page);
    expect(Sentry.addIntegration).not.toHaveBeenCalled();
  });
});
