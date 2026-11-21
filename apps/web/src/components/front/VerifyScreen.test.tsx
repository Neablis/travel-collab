import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PasskeyCheck } from "@/lib/mfaClient";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
const signOutMock = vi.fn();
vi.mock("next-auth/react", () => ({ signOut: (...args: unknown[]) => signOutMock(...args) }));
const check = vi.fn<() => Promise<PasskeyCheck>>();
vi.mock("@/lib/mfaClient", () => ({ checkWithPasskey: () => check() }));

import { VerifyScreen } from "./VerifyScreen";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  replace.mockReset();
  signOutMock.mockReset();
  check.mockReset();
});

describe("VerifyScreen", () => {
  it("opens with the passkey prompt already up, and returns to where the person was going once it passes", async () => {
    check.mockResolvedValue("passed");
    render(<VerifyScreen callbackUrl="/trips/abc?tab=days" />);
    // No click: the prompt is the first thing that happens.
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/trips/abc?tab=days"));
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("leaves a button to try again when the prompt is closed, and does not move on", async () => {
    check.mockResolvedValueOnce("cancelled").mockResolvedValueOnce("passed");
    render(<VerifyScreen callbackUrl="/home" />);
    await waitFor(() => expect(check).toHaveBeenCalledTimes(1));
    const retry = await screen.findByRole("button", { name: "Use a passkey" });
    await waitFor(() => expect(retry.getAttribute("aria-busy")).toBeNull());
    expect(replace).not.toHaveBeenCalled();

    await userEvent.click(retry);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/home"));
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("says so when the passkey is refused, and stays on the screen", async () => {
    check.mockResolvedValue("refused");
    render(<VerifyScreen callbackUrl="/home" />);
    expect(await screen.findByText("That passkey did not work. Try again.")).toBeDefined();
    expect(replace).not.toHaveBeenCalled();
  });

  // The verify route's 401 for "no session behind this cookie" has no retry: the
  // banner and the button would go on offering one for ever.
  it("leaves through the route that clears the cookie when the server no longer knows the session", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    check.mockResolvedValue("signed-out");
    render(<VerifyScreen callbackUrl="/trips/abc?tab=days" />);
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith("/api/session-expired?callbackUrl=%2Ftrips%2Fabc%3Ftab%3Ddays"),
    );
    expect(replace).not.toHaveBeenCalled();
  });

  it("goes on to where the person was going when two-step sign-in has been turned off meanwhile", async () => {
    check.mockResolvedValue("not-required");
    render(<VerifyScreen callbackUrl="/home" />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/home"));
  });

  it("signs out from the foot of the screen", async () => {
    check.mockResolvedValue("cancelled");
    render(<VerifyScreen callbackUrl="/home" />);
    await userEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    expect(signOutMock).toHaveBeenCalledWith({ callbackUrl: "/" });
  });
});
