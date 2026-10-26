import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { LAUNCH_SCRIPT, WELCOME_COOKIE, readWelcomeCue } from "@/lib/welcomeCue";
import { LaunchOverlay, WelcomeMoment } from "./WelcomeMoment";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  document.documentElement.removeAttribute("data-launch");
  document.cookie = `${WELCOME_COOKIE}=; Path=/; Max-Age=0`;
});

// Time since navigation start. Node's clock counts from the worker's start, so
// on a busy runner it is already past the launch fail-safe when a test begins.
function launchedMsAgo(ms: number) {
  vi.spyOn(performance, "now").mockReturnValue(ms);
}

// The session endpoint answering for Ana after `ms`, on the faked clock.
function sessionAnswersAfter(ms: number) {
  vi.stubGlobal("fetch", () => new Promise((resolve) => setTimeout(() => resolve(Response.json({ user: ana })), ms)));
}

// `matchMedia` answering `true` for exactly the queries given.
function stubMedia(...matching: string[]) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: matching.includes(query),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

describe("WelcomeMoment", () => {
  // On a timer, not on `animationend`: under reduced motion nothing animates.
  it("leaves on its own", () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    render(<WelcomeMoment onDone={onDone} />);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("holds while the launch is still loading", () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    render(<WelcomeMoment phase="breathe" onDone={onDone} />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(onDone).not.toHaveBeenCalled();
  });
});

const ana = { id: "user-ana", name: "Ana", email: "ana@example.com" };

describe("LaunchOverlay", () => {
  it("is gone at hydration on any load that is not a home-screen launch", () => {
    render(<LaunchOverlay />);
    expect(screen.queryByTestId("welcome-moment")).toBeNull();
  });

  // A refresh, the sign-out redirect and the return from sign-in are all full
  // loads in the installed app; only the first in a session is a launch.
  it("marks only the first load of a session in the installed app as a launch", () => {
    stubMedia("(display-mode: standalone)");
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- runs the inline <head> script as the browser would
    const runLaunchScript = new Function(LAUNCH_SCRIPT);
    runLaunchScript();
    expect(document.documentElement.hasAttribute("data-launch")).toBe(true);
    document.documentElement.removeAttribute("data-launch");
    runLaunchScript();
    expect(document.documentElement.hasAttribute("data-launch")).toBe(false);
  });

  // Mitchell's walk: a mark over a page already drawn read as unstyled
  // content. So any page a sign-in lands on is held behind the splash from its
  // first frame, at every width, not only in the installed app.
  it.each(["signin", "signup"])("holds the first page after a %s behind the splash", (kind) => {
    stubMedia();
    document.cookie = `${WELCOME_COOKIE}=${kind}; Path=/`;
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- runs the inline <head> script as the browser would
    new Function(LAUNCH_SCRIPT)();
    expect(document.documentElement.hasAttribute("data-launch")).toBe(true);
  });

  // The gate's "Welcome, {name}", after a returning sign-in as well as a
  // signup. The root layout has no session provider, so the overlay asks the
  // session for the name itself, and spends the cue so a refresh is not greeted.
  it.each(["signin", "signup"])("greets the account by name after a %s, and spends the cookie", async (kind) => {
    launchedMsAgo(100);
    document.documentElement.setAttribute("data-launch", "");
    document.cookie = `${WELCOME_COOKIE}=${kind}; Path=/`;
    vi.stubGlobal("fetch", async () => Response.json({ user: ana }));
    render(<LaunchOverlay />);
    const moment = screen.getByTestId("welcome-moment");
    expect(await within(moment).findByText("Welcome, Ana")).toBeDefined();
    // Said once, through the live region; the splash itself is decoration.
    const said = screen.getByText("Welcome, Ana", { ignore: "[aria-hidden], [aria-hidden] *" });
    expect(said.getAttribute("aria-live")).toBe("polite");
    expect(readWelcomeCue(document.cookie)).toBeNull();
  });

  // The gate: the splash leaves within the name-wait cap and the page is
  // usable after it. A name that answers late, inside the 600ms wait, holds
  // the splash longest; it still goes by the wait plus the named welcome
  // (1750ms after hydration), and once it has gone a click reaches the page.
  it("leaves within the name-wait cap and hands the page back usable", async () => {
    vi.useFakeTimers();
    launchedMsAgo(100);
    document.documentElement.setAttribute("data-launch", "");
    document.cookie = `${WELCOME_COOKIE}=signup; Path=/`;
    sessionAnswersAfter(500);
    const pressed = vi.fn();
    render(
      <>
        <LaunchOverlay />
        <button type="button" onClick={pressed}>
          New trip
        </button>
      </>,
    );
    // In steps, as a browser's frames would: a timer an effect starts only
    // exists once React has committed, which one long jump would skip past.
    const elapse = async (ms: number) => {
      for (let step = 0; step < ms; step += 50) await act(() => vi.advanceTimersByTimeAsync(50));
    };
    await elapse(1400);
    const moment = screen.getByTestId("welcome-moment");
    expect(within(moment).getByText("Welcome, Ana")).toBeDefined();
    expect(document.documentElement.hasAttribute("data-launch")).toBe(true);

    await elapse(350);
    expect(screen.queryByTestId("welcome-moment")).toBeNull();
    expect(document.documentElement.hasAttribute("data-launch")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "New trip" }));
    expect(pressed).toHaveBeenCalledTimes(1);
  });

  // Decision 6: `data-named` lengthens the hold, and re-timing a running
  // animation snaps a fading sheet back. So the overlay breathes until the
  // name is known, and the welcome starts at its final length.
  it("breathes until the session answers, then welcomes by name", async () => {
    vi.useFakeTimers();
    launchedMsAgo(100);
    document.documentElement.setAttribute("data-launch", "");
    document.cookie = `${WELCOME_COOKIE}=signup; Path=/`;
    sessionAnswersAfter(300);
    render(<LaunchOverlay />);
    await act(() => vi.advanceTimersByTimeAsync(250));
    expect(screen.getByTestId("welcome-moment").getAttribute("data-phase")).toBe("breathe");
    await act(() => vi.advanceTimersByTimeAsync(100));
    const moment = screen.getByTestId("welcome-moment");
    expect(moment.getAttribute("data-phase")).toBe("welcome");
    expect(within(moment).getByText("Welcome, Ana")).toBeDefined();
  });

  // Past the wait the welcome has begun unnamed, and a name joining it would
  // re-time it; the late name is said instead.
  it("keeps a welcome that began unnamed unnamed, and still says the late name", async () => {
    vi.useFakeTimers();
    launchedMsAgo(100);
    document.documentElement.setAttribute("data-launch", "");
    document.cookie = `${WELCOME_COOKIE}=signup; Path=/`;
    sessionAnswersAfter(700);
    render(<LaunchOverlay />);
    await act(() => vi.advanceTimersByTimeAsync(800));
    const moment = screen.getByTestId("welcome-moment");
    expect(within(moment).queryByText("Welcome, Ana")).toBeNull();
    expect(screen.getByText("Welcome, Ana").getAttribute("aria-live")).toBe("polite");
  });

  // Past the CSS fail-safe the sheet has already faded, and drawing it again
  // would be decision 6's blank-frame flicker.
  it("stands down without a moment when hydration lands past the fail-safe", () => {
    launchedMsAgo(3500);
    document.documentElement.setAttribute("data-launch", "");
    document.cookie = `${WELCOME_COOKIE}=signin; Path=/`;
    render(<LaunchOverlay />);
    expect(screen.queryByTestId("welcome-moment")).toBeNull();
    expect(document.documentElement.hasAttribute("data-launch")).toBe(false);
    expect(readWelcomeCue(document.cookie)).toBeNull();
  });

  // Under reduced motion a sign-in's splash still holds the page, with nothing
  // moving (globals.css animates it only under `no-preference`), for no longer
  // than with motion. The overlay sits in the root layout, which client
  // navigation keeps, so the words go once said.
  it("plays a sign-in's splash still under reduced motion, and says the welcome once", async () => {
    vi.useFakeTimers();
    stubMedia("(prefers-reduced-motion: reduce)");
    launchedMsAgo(100);
    document.documentElement.setAttribute("data-launch", "");
    document.cookie = `${WELCOME_COOKIE}=signup; Path=/`;
    sessionAnswersAfter(0);
    render(<LaunchOverlay />);
    await act(() => vi.advanceTimersByTimeAsync(10));
    expect(within(screen.getByTestId("welcome-moment")).getByText("Welcome, Ana")).toBeDefined();
    expect(screen.getByText("Welcome, Ana", { ignore: "[aria-hidden], [aria-hidden] *" }).getAttribute("aria-live")).toBe(
      "polite",
    );
    await act(() => vi.advanceTimersByTimeAsync(1150));
    expect(screen.queryByTestId("welcome-moment")).toBeNull();
    expect(document.documentElement.hasAttribute("data-launch")).toBe(false);
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(screen.queryByText("Welcome, Ana")).toBeNull();
  });

  // ADR-082 decision 2: a launch with no sign-in to welcome unmounts at once.
  it("draws nothing on a reduced-motion launch with no sign-in", () => {
    stubMedia("(prefers-reduced-motion: reduce)");
    launchedMsAgo(100);
    document.documentElement.setAttribute("data-launch", "");
    render(<LaunchOverlay />);
    expect(screen.queryByTestId("welcome-moment")).toBeNull();
    expect(document.documentElement.hasAttribute("data-launch")).toBe(false);
  });

  // Near the CSS fail-safe the name wait is cut short, so the welcome has
  // started before the CSS fades the sheet out from under it.
  it("cuts the name wait short near the fail-safe", async () => {
    vi.useFakeTimers();
    launchedMsAgo(2800);
    document.documentElement.setAttribute("data-launch", "");
    document.cookie = `${WELCOME_COOKIE}=signup; Path=/`;
    sessionAnswersAfter(400);
    render(<LaunchOverlay />);
    await act(() => vi.advanceTimersByTimeAsync(250));
    const moment = screen.getByTestId("welcome-moment");
    expect(moment.getAttribute("data-phase")).toBe("welcome");
    expect(within(moment).queryByText("Welcome, Ana")).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(screen.getByText("Welcome, Ana").getAttribute("aria-live")).toBe("polite");
  });

  // Decision 6: no seam between the splash and the app. The overlay the
  // server drew is the one that welcomes, so its breathing mark does not
  // restart at hydration.
  it("keeps the server-drawn moment through a signup launch's hydration", async () => {
    vi.useFakeTimers();
    launchedMsAgo(100);
    document.documentElement.setAttribute("data-launch", "");
    document.cookie = `${WELCOME_COOKIE}=signup; Path=/`;
    sessionAnswersAfter(100);
    const host = document.createElement("div");
    host.innerHTML = renderToString(<LaunchOverlay />);
    document.body.append(host);
    const served = screen.getByTestId("welcome-moment");
    const root = await act(async () => hydrateRoot(host, <LaunchOverlay />));
    onTestFinished(() => {
      act(() => root.unmount());
      host.remove();
    });
    await act(() => vi.advanceTimersByTimeAsync(150));
    const moment = screen.getByTestId("welcome-moment");
    expect(moment.getAttribute("data-phase")).toBe("welcome");
    expect(moment).toBe(served);
  });

  // Decision 6: it leaves as soon as the page is ready, and takes the launch
  // mark with it, so nothing is left covering the app.
  it("leaves a home-screen launch once the page has hydrated", () => {
    vi.useFakeTimers();
    launchedMsAgo(100);
    document.documentElement.setAttribute("data-launch", "");
    render(<LaunchOverlay />);
    expect(screen.getByTestId("welcome-moment")).toBeDefined();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByTestId("welcome-moment")).toBeNull();
    expect(document.documentElement.hasAttribute("data-launch")).toBe(false);
  });
});
