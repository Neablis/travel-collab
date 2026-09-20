import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountScreen, accountTabFrom } from "./AccountScreen";

// The tab is the route (SPEC §34.4, DRIFT §6 build-check 4), so the thing under
// test is the relationship between `?tab=` and what is on the page. The router
// is stubbed at the boundary: what matters is the URL this screen asks for, not
// that Next honours it.
let params = new URLSearchParams();
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: (href: string) => push(href) }),
  useSearchParams: () => params,
}));

vi.mock("./useSessionUser", () => ({ useSessionUser: () => ({ email: "sam@example.com" }) }));

const signOutMock = vi.fn();
vi.mock("next-auth/react", () => ({ signOut: (...args: unknown[]) => signOutMock(...args) }));

// The three panels self-fetch and have their own suites; stubbing them keeps
// this file about the tabs. Each renders a marker so "which panel is mounted"
// is observable.
vi.mock("./ProfileSection", () => ({
  ProfileSection: ({ email }: { email: string }) => <div data-testid="profile-panel">{email}</div>,
}));
vi.mock("./PlanSection", () => ({ PlanSection: () => <div data-testid="plan-panel" /> }));
vi.mock("./TokensSection", () => ({ TokensSection: () => <div data-testid="tokens-panel" /> }));

function mount(tab?: string) {
  params = new URLSearchParams(tab === undefined ? "" : `tab=${tab}`);
  return render(<AccountScreen />);
}

beforeEach(() => push.mockClear());
afterEach(cleanup);

describe("accountTabFrom", () => {
  it("reads the three real tabs", () => {
    expect(accountTabFrom("profile")).toBe("profile");
    expect(accountTabFrom("plan")).toBe("plan");
    expect(accountTabFrom("tokens")).toBe("tokens");
  });

  // A settings URL somebody bookmarked must not be able to rot into a blank
  // screen when a tab is renamed.
  it("falls back to Profile for anything it does not recognise", () => {
    expect(accountTabFrom(null)).toBe("profile");
    expect(accountTabFrom("")).toBe("profile");
    expect(accountTabFrom("billing")).toBe("profile");
    expect(accountTabFrom("PROFILE")).toBe("profile");
  });
});

describe("AccountScreen", () => {
  it("is a page with three tabs, Profile first", () => {
    mount();
    expect(screen.getByRole("heading", { name: "Account", level: 1 })).toBeTruthy();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "Profile",
      "Plan & usage",
      "API tokens",
    ]);
    expect(screen.getByTestId("profile-panel")).toBeTruthy();
  });

  it.each([
    ["plan", "plan-panel"],
    ["tokens", "tokens-panel"],
    ["profile", "profile-panel"],
  ])("renders the panel the ?tab= names: %s", (tab, panel) => {
    mount(tab);
    expect(screen.getByTestId(panel)).toBeTruthy();
  });

  // One mounted panel, not three hidden ones: `PlanSection` and `TokensSection`
  // both self-fetch on mount, so rendering all three would fire every request
  // on arrival to show one — and the token list is the one surface here whose
  // contents are credentials.
  it("mounts only the selected panel", () => {
    mount("plan");
    expect(screen.queryByTestId("profile-panel")).toBeNull();
    expect(screen.queryByTestId("tokens-panel")).toBeNull();
  });

  // The whole reason the tab is in the URL rather than in component state.
  it("navigates to a URL when a tab is taken, so the back button walks them", () => {
    mount();
    fireEvent.click(screen.getByRole("tab", { name: "API tokens" }));
    expect(push).toHaveBeenCalledWith("/account?tab=tokens");
  });

  // `/account` and `/account?tab=profile` are the same page, and the bare path
  // is the one to leave in the address bar.
  it("drops the parameter for the default tab rather than writing ?tab=profile", () => {
    mount("tokens");
    fireEvent.click(screen.getByRole("tab", { name: "Profile" }));
    expect(push).toHaveBeenCalledWith("/account");
  });

  it("passes the signed-in address to Profile", () => {
    mount();
    expect(screen.getByTestId("profile-panel").textContent).toBe("sam@example.com");
  });

  // §34.4: a tab's label IS the section's heading, so the panel takes its
  // accessible name from the tab. Without the wiring the panel is an unlabelled
  // region and the heading it replaced is simply gone.
  it("labels the panel with its tab", () => {
    mount("plan");
    const panel = screen.getByRole("tabpanel");
    const tab = screen.getByRole("tab", { name: "Plan & usage" });
    expect(panel.getAttribute("aria-labelledby")).toBe(tab.id);
    expect(tab.getAttribute("aria-controls")).toBe(panel.id);
  });

  // **This asserted no sign out at all, and Wave 2's link 11 added one — for
  // the phone only.** Link 1's decision has two halves and this file now holds
  // both: the desktop's sign out stays in the avatar popover (the artboard has
  // none on `/account`), and the phone screen carries its own because §34.3
  // makes it a task the tab bar steps aside for, leaving no popover to hold it.
  //
  // Asserted as `md:hidden` rather than by resizing: jsdom has no layout and no
  // media queries, so the breakpoint is the only honest thing to check here.
  // The `phone` Playwright project is where a real 411px walk belongs (link 16).
  it("carries sign out for the phone only, never for both surfaces", () => {
    mount();
    const signOut = screen.getByTestId("account-sign-out");
    expect(signOut.textContent).toBe("Sign out");
    expect(signOut.parentElement?.className).toContain("md:hidden");
    // And there is exactly one — a second, always-visible one would be the
    // rule-4 duplication the decision exists to avoid.
    expect(screen.getAllByRole("button", { name: /sign out/i })).toHaveLength(1);
  });

  it("signs out to /welcome, not /", () => {
    mount();
    fireEvent.click(screen.getByTestId("account-sign-out"));
    // `/` depends on the proxy bouncing a signed-out visitor onward, and the
    // navigation can outrun the Set-Cookie that clears the session —
    // `AccountMenu` measured that on Next 16. `/welcome` is public either way.
    expect(signOutMock).toHaveBeenCalledWith({ callbackUrl: "/welcome" });
  });

  // §34.3: *"Done returns you to Trips."* The tab bar steps aside for this
  // screen, so without a way out the only one left is the browser's own
  // gesture — on the surface that has just removed the app's navigation.
  it("gives the phone a way back to Trips, and the desktop none", () => {
    mount();
    const done = screen.getByTestId("account-done");
    expect(done.getAttribute("href")).toBe("/");
    expect(done.className).toContain("md:hidden");
    // 44px, per §13.1 — the reason it is a `touch`-sized control.
    expect(done.className).toContain("min-h-11");
  });
});
