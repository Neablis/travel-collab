import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
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
  vi.unstubAllGlobals();
  sessionStorage.clear();
  document.documentElement.removeAttribute("data-launch");
  document.cookie = `${WELCOME_COOKIE}=; Path=/; Max-Age=0`;
});

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
  it("plays nothing under reduced motion, and still spends the cookie", () => {
    stubMedia("(prefers-reduced-motion: reduce)", "(pointer: coarse)");
    document.cookie = `${WELCOME_COOKIE}=signup; Path=/`;
    render(
      <SessionUserProvider initialUser={ana}>
        <WelcomeCue />
      </SessionUserProvider>,
    );
    expect(screen.queryByTestId("welcome-moment")).toBeNull();
    expect(readWelcomeCue(document.cookie)).toBeNull();
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
  it("greets a new account by name when the sign-in lands as a launch", async () => {
    document.documentElement.setAttribute("data-launch", "");
    document.cookie = `${WELCOME_COOKIE}=signup; Path=/`;
    vi.stubGlobal("fetch", async () => Response.json({ user: ana }));
    render(
      <>
        <LaunchOverlay />
        <SessionUserProvider initialUser={ana}>
          <WelcomeCue />
        </SessionUserProvider>
      </>,
    );
    const [moment, ...more] = screen.getAllByTestId("welcome-moment");
    expect(more).toHaveLength(0);
    expect(await within(moment!).findByText("Welcome, Ana")).toBeDefined();
    expect(readWelcomeCue(document.cookie)).toBeNull();
  });

  // Decision 6: it leaves as soon as the page is ready, and takes the launch
  // mark with it, so nothing is left covering the app.
  it("leaves a home-screen launch once the page has hydrated", () => {
    vi.useFakeTimers();
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
