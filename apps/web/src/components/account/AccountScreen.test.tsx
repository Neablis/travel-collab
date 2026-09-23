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
  ProfileSection: ({ email, onOpenTokens }: { email: string; onOpenTokens: () => void }) => (
    <div data-testid="profile-panel">
      <span data-testid="profile-email">{email}</span>
      <button type="button" onClick={onOpenTokens}>
        API tokens →
      </button>
    </div>
  ),
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
  // `tokens` is a sub-view now, not a tab (SPEC §35.4, M27 D7) — but its URL
  // is unchanged, so links from when it was a tab still land on it.
  it("reads the two tabs and the tokens sub-view", () => {
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
  it("is a page with two tabs, Profile first", () => {
    mount();
    expect(screen.getByRole("heading", { name: "Account", level: 1 })).toBeTruthy();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Profile", "Plan & usage"]);
    expect(screen.getByTestId("profile-panel")).toBeTruthy();
  });

  // §35.4 removed the heading's explanatory paragraph.
  it("does not explain itself under the heading", () => {
    mount();
    expect(screen.queryByText(/Everything true of you across every trip/)).toBeNull();
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
    fireEvent.click(screen.getByRole("tab", { name: "Plan & usage" }));
    expect(push).toHaveBeenCalledWith("/account?tab=plan");
  });

  // `/account` and `/account?tab=profile` are the same page, and the bare path
  // is the one to leave in the address bar.
  it("drops the parameter for the default tab rather than writing ?tab=profile", () => {
    mount("plan");
    fireEvent.click(screen.getByRole("tab", { name: "Profile" }));
    expect(push).toHaveBeenCalledWith("/account");
  });

  // §35.4: Profile's "API tokens →" is the way in, and it is a URL for the
  // same reason the tabs are.
  it("opens the tokens sub-view from Profile's link, as a URL", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "API tokens →" }));
    expect(push).toHaveBeenCalledWith("/account?tab=tokens");
  });

  describe("the tokens sub-view", () => {
    it("selects neither tab, and keeps the strip one tab stop", () => {
      mount("tokens");
      const tabs = screen.getAllByRole("tab");
      expect(tabs.filter((t) => t.getAttribute("aria-selected") === "true")).toEqual([]);
      expect(tabs.filter((t) => t.getAttribute("tabindex") === "0").map((t) => t.textContent)).toEqual(["Profile"]);
    });

    it("has its own way back to Profile and its own heading", () => {
      mount("tokens");
      expect(screen.getByRole("heading", { name: "API tokens", level: 3 })).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "← Profile" }));
      expect(push).toHaveBeenCalledWith("/account");
    });

    // No tab controls it, so it must not claim to be a tab's panel or point at
    // a tab for its name. The heading is there from the first paint — it is
    // not inside `TokensSection`, which renders nothing until it has fetched.
    it("is a region named by its heading", () => {
      mount("tokens");
      expect(screen.queryByRole("tabpanel")).toBeNull();
      const region = screen.getByRole("region", { name: "API tokens" });
      const heading = screen.getByRole("heading", { name: "API tokens", level: 3 });
      expect(region.getAttribute("aria-labelledby")).toBe(heading.id);
      expect(region.contains(screen.getByTestId("tokens-panel"))).toBe(true);
    });
  });

  it("passes the signed-in address to Profile", () => {
    mount();
    expect(screen.getByTestId("profile-email").textContent).toBe("sam@example.com");
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
  // **Which surface it renders on is NOT asserted here, and that is the lint
  // wall being right.** `md:hidden` is a class, jsdom has no media queries, and
  // this file is not a `components/ui/**` primitive — so "phone only" is a
  // claim this layer cannot honestly make. It belongs to the `phone` Playwright
  // project at 411px, which is link 16's work.
  //
  // What IS testable here is the half that would break the decision: that the
  // screen grows exactly one sign out. A second, always-visible one would be
  // the rule-4 duplication link 1 decided against, and it would be a real
  // regression a unit test can see.
  it("grows exactly one sign out, never a second alongside the popover's", () => {
    mount();
    expect(screen.getByTestId("account-sign-out").textContent).toBe("Sign out");
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
  // §34.3: *"Done returns you to Trips."* The tab bar steps aside for this
  // screen, so without a way out the only one left is the browser's own
  // gesture — on the surface that has just removed the app's navigation.
  //
  // The destination is the testable half. That it is phone-only and 44px are
  // both class claims this layer cannot hold; link 16 walks them at 411px.
  it("gives the screen a way back to Trips", () => {
    mount();
    expect(screen.getByTestId("account-done").getAttribute("href")).toBe("/");
  });
});
