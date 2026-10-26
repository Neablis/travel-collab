import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SessionUserProvider } from "@/components/account/useSessionUser";
import { WELCOME_COOKIE, readWelcomeCue } from "@/lib/welcomeCue";
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
  document.cookie = `${WELCOME_COOKIE}=; Path=/; Max-Age=0`;
});

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

describe("WelcomeCue", () => {
  const ana = { id: "user-ana", name: "Ana", email: "ana@example.com" };

  it("greets a new account by name, once, and spends the cookie", () => {
    document.cookie = `${WELCOME_COOKIE}=signup; Path=/`;
    render(
      <SessionUserProvider initialUser={ana}>
        <WelcomeCue />
      </SessionUserProvider>,
    );
    expect(screen.getByText("Welcome, Ana")).toBeDefined();
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
  afterEach(() => document.documentElement.removeAttribute("data-launch"));

  it("is gone at hydration on any load that is not a home-screen launch", () => {
    render(<LaunchOverlay />);
    expect(screen.queryByTestId("welcome-moment")).toBeNull();
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
