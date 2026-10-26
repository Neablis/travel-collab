import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, it, onTestFinished, vi } from "vitest";
import { SessionUserProvider } from "@/components/account/useSessionUser";
import { LAUNCH_SCRIPT, WELCOME_COOKIE, readWelcomeCue } from "@/lib/welcomeCue";
import { LaunchOverlay, WelcomeCue, WelcomeMoment } from "./WelcomeMoment";

// jsdom loads none of our CSS, and "takes no pointer events" is a fact about
// the cascade. So the `.welcome-moment` rules are lifted out of globals.css as
// written and injected, and the test reads what the browser would compute.
beforeAll(() => {
  const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
  const rules = [...css.matchAll(/^\s*(\.welcome-moment[^{]*\{[^}]*\})/gm)].map((match) => match[1]);
  const style = document.createElement("style");
  style.textContent = rules.join("\n");
  document.head.append(style);
});

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
  // Decision 4: on desktop the moment plays over a page the person can
  // already use, so it may not hold focus, hide the page from assistive tech,
  // or catch the click meant for what is under it.
  it("small never sets inert or a focus trap and takes no pointer events", async () => {
    const { rerender } = render(<button type="button">Behind</button>);
    const behind = screen.getByRole("button", { name: "Behind" });
    behind.focus();

    rerender(
      <>
        <button type="button">Behind</button>
        <WelcomeMoment size="small" name="Ana" />
      </>,
    );

    const moment = screen.getByTestId("welcome-moment");
    expect(getComputedStyle(moment).pointerEvents).toBe("none");
    expect(behind.matches(":focus")).toBe(true);
    expect(behind.matches("[inert], [inert] *")).toBe(false);
    expect(moment.matches("[inert], [inert] *")).toBe(false);
    expect(screen.queryByRole("dialog")).toBeNull();
    // Nothing inside to hold focus: a Tab from the page's last control goes
    // on past the moment, not into it.
    await userEvent.tab();
    expect(moment.matches(":focus-within")).toBe(false);
  });

  // On a timer, not on `animationend`: under reduced motion nothing animates.
  it("leaves on its own", () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    render(<WelcomeMoment size="small" onDone={onDone} />);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("holds while the launch is still loading", () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    render(<WelcomeMoment size="full" phase="breathe" onDone={onDone} />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(onDone).not.toHaveBeenCalled();
  });
});

const ana = { id: "user-ana", name: "Ana", email: "ana@example.com" };

describe("WelcomeCue", () => {
  it("greets a new account by name, once, and spends the cookie", () => {
    document.cookie = `${WELCOME_COOKIE}=signup; Path=/`;
    render(
      <SessionUserProvider initialUser={ana}>
        <WelcomeCue />
      </SessionUserProvider>,
    );
    expect(within(screen.getByTestId("welcome-moment")).getByText("Welcome, Ana")).toBeDefined();
    // Said once, through the live region; the moment itself is decoration.
    const said = screen.getByText("Welcome, Ana", { ignore: "[aria-hidden], [aria-hidden] *" });
    expect(said.getAttribute("aria-live")).toBe("polite");
    expect(readWelcomeCue(document.cookie)).toBeNull();
  });

  // "Welcome, {name}" is signup's alone; every sign-in still gets the mark.
  it("plays the mark without a name for a returning sign-in", () => {
    document.cookie = `${WELCOME_COOKIE}=signin; Path=/`;
    render(
      <SessionUserProvider initialUser={ana}>
        <WelcomeCue />
      </SessionUserProvider>,
    );
    expect(screen.getByTestId("welcome-moment")).toBeDefined();
    expect(screen.queryByText("Welcome, Ana")).toBeNull();
  });

  // ADR-082 decision 2: under reduced motion an overlay unmounts at once. A
  // static full-size sheet would hide the page it landed on while still
  // letting taps through to it.
  // The words are not motion, so a new account is still welcomed by name to a
  // screen reader, with nothing drawn. Once said they go, or the shell would
  // keep them for a browse-mode reader to meet on every page.
  it("plays nothing under reduced motion, says the welcome once, and spends the cookie", () => {
    vi.useFakeTimers();
    stubMedia("(prefers-reduced-motion: reduce)", "(pointer: coarse)");
    document.cookie = `${WELCOME_COOKIE}=signup; Path=/`;
    render(
      <SessionUserProvider initialUser={ana}>
        <WelcomeCue />
      </SessionUserProvider>,
    );
    expect(screen.queryByTestId("welcome-moment")).toBeNull();
    expect(screen.getByText("Welcome, Ana").getAttribute("aria-live")).toBe("polite");
    expect(readWelcomeCue(document.cookie)).toBeNull();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByText("Welcome, Ana")).toBeNull();
  });

  it("plays nothing without the cookie", () => {
    render(
      <SessionUserProvider initialUser={ana}>
        <WelcomeCue />
      </SessionUserProvider>,
    );
    expect(screen.queryByTestId("welcome-moment")).toBeNull();
  });
});

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

  // The gate's "Welcome, {name} after signup": a signup whose first app page
  // is a launch is greeted by the launch overlay, which the shell's cue (inside
  // the session provider) leaves it to. Outside that provider, as in the root
  // layout, the overlay asks the session for the name itself.
  // Both effect orders: the overlay is first in <body>, but an interaction can
  // hydrate the shell's Suspense boundary ahead of it.
  it.each([
    ["the overlay", false],
    ["the shell's cue", true],
  ])("greets a new account by name when the sign-in lands as a launch, %s hydrating first", async (_, cueFirst) => {
    launchedMsAgo(100);
    document.documentElement.setAttribute("data-launch", "");
    document.cookie = `${WELCOME_COOKIE}=signup; Path=/`;
    vi.stubGlobal("fetch", async () => Response.json({ user: ana }));
    const cue = (
      <SessionUserProvider key="cue" initialUser={ana}>
        <WelcomeCue />
      </SessionUserProvider>
    );
    const overlay = <LaunchOverlay key="overlay" />;
    render(<>{cueFirst ? [cue, overlay] : [overlay, cue]}</>);
    const [moment, ...more] = await screen.findAllByTestId("welcome-moment");
    expect(more).toHaveLength(0);
    expect(await within(moment!).findByText("Welcome, Ana")).toBeDefined();
    expect(readWelcomeCue(document.cookie)).toBeNull();
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

  // The overlay sits in the root layout, which client navigation keeps, so
  // the words go once said.
  it("says a new account's welcome once under reduced motion, and draws nothing", async () => {
    vi.useFakeTimers();
    stubMedia("(prefers-reduced-motion: reduce)");
    launchedMsAgo(100);
    document.documentElement.setAttribute("data-launch", "");
    document.cookie = `${WELCOME_COOKIE}=signup; Path=/`;
    sessionAnswersAfter(0);
    render(<LaunchOverlay />);
    await act(() => vi.advanceTimersByTimeAsync(10));
    expect(screen.getByText("Welcome, Ana").getAttribute("aria-live")).toBe("polite");
    expect(screen.queryByTestId("welcome-moment")).toBeNull();
    expect(document.documentElement.hasAttribute("data-launch")).toBe(false);
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(screen.queryByText("Welcome, Ana")).toBeNull();
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
