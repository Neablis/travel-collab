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
    expect(screen.getByText(/no Stripe test keys/)).toBeTruthy();
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
      "This deployment has no Stripe test keys any more. Nothing changed.",
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
