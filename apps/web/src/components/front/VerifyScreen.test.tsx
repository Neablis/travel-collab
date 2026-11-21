import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

    it("opens on the code field when the account has no passkey to ask for", async () => {
      check.mockResolvedValue("unavailable");
      render(<VerifyScreen callbackUrl="/home" />);
      expect(await screen.findByRole("textbox", { name: "Authenticator code" })).toBeDefined();
      expect(screen.queryByRole("button", { name: "Use a passkey" })).toBeNull();
      expect(screen.queryByText("This account has no passkey to use.")).toBeNull();
    });
  });
});
