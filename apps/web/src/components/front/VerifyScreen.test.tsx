import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLayoutEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CodeCheck, PasskeyCheck } from "@/lib/mfaClient";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
const signOutMock = vi.fn();
vi.mock("next-auth/react", () => ({ signOut: (...args: unknown[]) => signOutMock(...args) }));
const check = vi.fn<() => Promise<PasskeyCheck>>();
const checkCode = vi.fn<(kind: "otp" | "recovery", code: string) => Promise<CodeCheck>>();
vi.mock("@/lib/mfaClient", () => ({
  checkWithPasskey: () => check(),
  checkWithCode: (kind: "otp" | "recovery", code: string) => checkCode(kind, code),
}));

import { VerifyScreen } from "./VerifyScreen";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  replace.mockReset();
  signOutMock.mockReset();
  check.mockReset();
  checkCode.mockReset();
});

describe("VerifyScreen", () => {
  it("opens with the passkey prompt already up, and returns to where the person was going once it passes", async () => {
    check.mockResolvedValue("passed");
    render(<VerifyScreen callbackUrl="/trips/abc?tab=days" />);
    // No click: the prompt is the first thing that happens.
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/trips/abc?tab=days"));
    expect(check).toHaveBeenCalledTimes(1);
  });

  // The installed app's lock (M62 D3b) reads this device's last activity; one from
  // before a sign-out would lock the app seconds after the passkey that signed in.
  it("restarts the installed app's idle clock once the second step passes", async () => {
    window.localStorage.setItem("caesura_last_active", String(Date.now() - 24 * 60 * 60_000));
    check.mockResolvedValue("passed");
    render(<VerifyScreen callbackUrl="/home" />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/home"));
    expect(Number(window.localStorage.getItem("caesura_last_active"))).toBeGreaterThan(Date.now() - 60_000);
    window.localStorage.clear();
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

  // Safari refuses a prompt that no tap started, which arrives here as "cancelled": without
  // a word the screen looks stuck.
  it("tells the person to tap the button when the automatic prompt was cancelled", async () => {
    check.mockResolvedValue("cancelled");
    render(<VerifyScreen callbackUrl="/home" />);
    // A live region, so a screen reader says it when the prompt is refused.
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Tap Use a passkey to continue."));
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

  describe("with a code", () => {
    async function openCodeField(name: string, optionName: string) {
      check.mockResolvedValue("cancelled");
      render(<VerifyScreen callbackUrl="/trips/abc" />);
      await userEvent.click(await screen.findByRole("button", { name: optionName }));
      return screen.findByRole("textbox", { name });
    }

    it("signs in with an authenticator code, submitted by Enter", async () => {
      checkCode.mockResolvedValue("passed");
      const field = await openCodeField("Authenticator code", "Use authenticator code");
      await userEvent.type(field, "123456{Enter}");
      await waitFor(() => expect(replace).toHaveBeenCalledWith("/trips/abc"));
      expect(checkCode).toHaveBeenCalledWith("otp", "123456");
    });

    it("signs in with a recovery code", async () => {
      checkCode.mockResolvedValue("passed");
      const field = await openCodeField("Recovery code", "Use a recovery code");
      await userEvent.type(field, "abcde-fghjk{Enter}");
      await waitFor(() => expect(replace).toHaveBeenCalledWith("/trips/abc"));
      expect(checkCode).toHaveBeenCalledWith("recovery", "abcde-fghjk");
    });

    it("says a wrong code did not work and keeps the field", async () => {
      checkCode.mockResolvedValue("refused");
      const field = await openCodeField("Authenticator code", "Use authenticator code");
      await userEvent.type(field, "000000{Enter}");
      expect(await screen.findByText("That code did not work. Try again.")).toBeDefined();
      expect(replace).not.toHaveBeenCalled();
    });

    it("says codes are locked, and points at the passkey that still works", async () => {
      checkCode.mockResolvedValue("locked");
      const field = await openCodeField("Authenticator code", "Use authenticator code");
      await userEvent.type(field, "000000{Enter}");
      expect(await screen.findByText(/Too many wrong codes\. Try again in 15 minutes, or use a passkey\./)).toBeDefined();
      expect(screen.getByRole("button", { name: "Use a passkey" })).toBeDefined();
    });

    it("ties the refusal to the field, so a screen reader reads it with the field", async () => {
      checkCode.mockResolvedValue("refused");
      const field = await openCodeField("Authenticator code", "Use authenticator code");
      await userEvent.type(field, "000000{Enter}");
      const problem = await screen.findByText("That code did not work. Try again.");
      expect(field.getAttribute("aria-describedby")).toBe(problem.id);
      expect(field.getAttribute("aria-invalid")).toBe("true");
    });

    it("leaves through the cookie-clearing route when a code finds no session, as the passkey does", async () => {
      const assign = vi.fn();
      vi.stubGlobal("location", { ...window.location, assign });
      checkCode.mockResolvedValue("signed-out");
      const field = await openCodeField("Authenticator code", "Use authenticator code");
      await userEvent.type(field, "123456{Enter}");
      await waitFor(() => expect(assign).toHaveBeenCalledWith("/api/session-expired?callbackUrl=%2Ftrips%2Fabc"));
      expect(replace).not.toHaveBeenCalled();
    });

    it("moves focus to the passkey button when the person goes back to the passkey", async () => {
      await openCodeField("Authenticator code", "Use authenticator code");
      await userEvent.click(screen.getByRole("button", { name: "Use a passkey" }));
      const passkey = await screen.findByRole("button", { name: "Use a passkey" });
      await waitFor(() => expect(passkey.matches(":focus")).toBe(true));
    });

    // On a slow phone a tap can be replayed after the screen commits and before its
    // arrival effect runs. A layout effect lands it in exactly that gap.
    function TapsBeforeArrival({ option }: { option: string }) {
      useLayoutEffect(() => {
        fireEvent.click(screen.getByRole("button", { name: option }));
      }, [option]);
      return null;
    }

    it("keeps the code field, and asks for no passkey, when the code is chosen before the arrival prompt starts", async () => {
      render(
        <>
          <VerifyScreen callbackUrl="/home" />
          <TapsBeforeArrival option="Use authenticator code" />
        </>,
      );
      expect(await screen.findByRole("textbox", { name: "Authenticator code" })).toBeDefined();
      expect(check).not.toHaveBeenCalled();
    });

    // The skipped arrival prompt was the only thing that would have learned whether
    // a passkey exists, so nothing may promise one until something has asked.
    it("does not point a locked code at a passkey when the early tap meant none was ever asked for", async () => {
      checkCode.mockResolvedValue("locked");
      render(
        <>
          <VerifyScreen callbackUrl="/home" />
          <TapsBeforeArrival option="Use authenticator code" />
        </>,
      );
      await userEvent.type(await screen.findByRole("textbox", { name: "Authenticator code" }), "000000{Enter}");
      expect(await screen.findByText("Too many wrong codes. Try again in 15 minutes.")).toBeDefined();
      expect(check).not.toHaveBeenCalled();
    });

    it("goes back to the recovery code when the passkey asked for from it turns out not to exist", async () => {
      check.mockResolvedValue("unavailable");
      render(
        <>
          <VerifyScreen callbackUrl="/home" />
          <TapsBeforeArrival option="Use a recovery code" />
        </>,
      );
      await screen.findByRole("textbox", { name: "Recovery code" });
      await userEvent.click(screen.getByRole("button", { name: "Use a passkey" }));
      expect(await screen.findByRole("textbox", { name: "Recovery code" })).toBeDefined();
      expect(screen.queryByRole("button", { name: "Use a passkey" })).toBeNull();
    });

    it("opens on the code field when the account has no passkey to ask for", async () => {
      check.mockResolvedValue("unavailable");
      render(<VerifyScreen callbackUrl="/home" />);
      expect(await screen.findByRole("textbox", { name: "Authenticator code" })).toBeDefined();
      expect(screen.queryByRole("button", { name: "Use a passkey" })).toBeNull();
      expect(screen.queryByText("This account has no passkey to use.")).toBeNull();
    });
  });
});
