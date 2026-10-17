import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// **The account page's Stripe test-mode toggle** (ADR-076 §6): the PUT it
// sends, the re-read after it, and the two ways it says nothing changed. The
// route behind it is `test-mode/route.int.test.ts`.

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import { AccountTestMode } from "./AccountTestMode";

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  refresh.mockReset();
  vi.unstubAllGlobals();
});

const toggle = () => screen.getByRole("checkbox", { name: /Stripe test mode/ });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("AccountTestMode", () => {
  it("turns the switch on for this account, then re-reads the page", async () => {
    fetchMock.mockResolvedValue(json({ enabled: true, available: true }));
    const user = userEvent.setup();
    render(<AccountTestMode accountId="dev-mei" initial={{ enabled: false, available: true }} />);

    await user.click(toggle());

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/accounts/dev-mei/test-mode",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ enabled: true }) }),
    );
    expect(await screen.findByText(/Nothing it buys counts as revenue/)).toBeTruthy();
    expect((toggle() as HTMLInputElement).checked).toBe(true);
    expect(refresh).toHaveBeenCalled();
  });

  it("offers nothing to switch to on a deployment with no test keys, and says why", () => {
    render(<AccountTestMode accountId="dev-mei" initial={{ enabled: false, available: false }} />);
    expect((toggle() as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("Stripe test keys are not set up on this deployment, so there is nothing to switch to.")).toBeTruthy();
  });

  // Off reaches new checkouts only: a test subscription bought while it was on
  // keeps its own mode (ADR-076 §6), so "off" must not read as "back to live".
  it("says off leaves a test subscription it already holds running", () => {
    render(<AccountTestMode accountId="dev-mei" initial={{ enabled: false, available: true }} />);
    expect(
      screen.getByText(
        "Off: new checkouts from this account take real cards. A test subscription it already holds keeps running in test mode until it ends.",
      ),
    ).toBeTruthy();
  });

  // A disabled control drops keyboard focus to the page, so the next Tab
  // starts from the top of the console. Busy is announced and ignored instead.
  it("keeps focus on the switch while the change is in flight, and ignores a second press", async () => {
    let answer!: (response: Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => (answer = resolve)));
    const user = userEvent.setup();
    render(<AccountTestMode accountId="dev-mei" initial={{ enabled: false, available: true }} />);

    toggle().focus();
    await user.keyboard(" ");
    expect(toggle().getAttribute("aria-disabled")).toBe("true");
    expect((toggle() as HTMLInputElement).disabled).toBe(false);
    await user.keyboard(" ");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    answer(json({ enabled: true, available: true }));
    expect(await screen.findByText(/Nothing it buys counts as revenue/)).toBeTruthy();
    expect(toggle().getAttribute("aria-disabled")).toBeNull();
    // Focus is proven by where the next press lands: back on the switch.
    fetchMock.mockResolvedValue(json({ enabled: false, available: true }));
    await user.keyboard(" ");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/admin/accounts/dev-mei/test-mode",
      expect.objectContaining({ body: JSON.stringify({ enabled: false }) }),
    );
  });

  // A switch left on after the keys went must still be turnable off.
  it("can still be turned off with no test keys", () => {
    render(<AccountTestMode accountId="dev-mei" initial={{ enabled: true, available: false }} />);
    expect((toggle() as HTMLInputElement).disabled).toBe(false);
  });

  it("keeps the switch where it was when the server refuses", async () => {
    fetchMock.mockResolvedValue(json({ error: "test-mode-unavailable" }, 409));
    const user = userEvent.setup();
    render(<AccountTestMode accountId="dev-mei" initial={{ enabled: false, available: true }} />);

    await user.click(toggle());

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Stripe test keys are no longer set up on this deployment. Nothing changed.",
    );
    expect((toggle() as HTMLInputElement).checked).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("says the session ended on the admin gate's 404", async () => {
    fetchMock.mockResolvedValue(json({ error: "not-found" }, 404));
    const user = userEvent.setup();
    render(<AccountTestMode accountId="dev-mei" initial={{ enabled: false, available: true }} />);
    await user.click(toggle());
    expect((await screen.findByRole("alert")).textContent).toBe("Your session ended. Nothing changed.");
  });
});
