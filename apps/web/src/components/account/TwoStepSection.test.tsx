import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AddPasskeyResult,
  ChangeResult,
  CodeCheck,
  ConfirmAuthenticatorResult,
  PasskeyCheck,
  RegenerateResult,
  StartAuthenticatorResult,
} from "@/lib/mfaClient";
import type { MfaStatusResponse } from "@/lib/mfaWire";

const add = vi.fn<() => Promise<AddPasskeyResult>>();
const check = vi.fn<() => Promise<PasskeyCheck>>();
const checkCode = vi.fn<(kind: "otp" | "recovery", code: string) => Promise<CodeCheck>>();
const regenerate = vi.fn<() => Promise<RegenerateResult>>();
const removeOne = vi.fn<(factorId: string) => Promise<ChangeResult>>();
const turnOff = vi.fn<() => Promise<ChangeResult>>();
const revokeAll = vi.fn<() => Promise<"revoked" | "fresh-check-required" | "failed">>();
const startApp = vi.fn<() => Promise<StartAuthenticatorResult>>();
const confirmApp = vi.fn<(ticket: string, code: string) => Promise<ConfirmAuthenticatorResult>>();
vi.mock("@/lib/mfaClient", () => ({
  addPasskey: () => add(),
  checkWithPasskey: () => check(),
  checkWithCode: (kind: "otp" | "recovery", code: string) => checkCode(kind, code),
  regenerateRecoveryCodes: () => regenerate(),
  removeFactor: (factorId: string) => removeOne(factorId),
  turnOffTwoStep: () => turnOff(),
  revokeAllCredentials: () => revokeAll(),
  startAuthenticator: () => startApp(),
  confirmAuthenticator: (ticket: string, code: string) => confirmApp(ticket, code),
}));
const signInMock = vi.fn();
vi.mock("next-auth/react", () => ({ signIn: (...args: unknown[]) => signInMock(...args) }));

import { TwoStepSection } from "./TwoStepSection";

const OFF: MfaStatusResponse = { enabled: false, factors: [], recoveryCodesLeft: 0 };
const phone = { id: "f1", name: "Device passkey", kind: "passkey" as const, createdAt: "2026-11-01T00:00:00Z", lastUsedAt: null };
const ON: MfaStatusResponse = { enabled: true, factors: [phone], recoveryCodesLeft: 9 };

let status: MfaStatusResponse = OFF;
const renamed: { url: string; body: unknown }[] = [];

function serve() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      if (href === "/api/account/mfa/factors") return new Response(JSON.stringify(status), { status: 200 });
      if (init?.method === "PATCH") {
        const body = JSON.parse(String(init.body)) as { name: string };
        renamed.push({ url: href, body });
        status = { ...status, factors: status.factors.map((f) => ({ ...f, name: body.name })) };
        return new Response("{}", { status: 200 });
      }
      return new Response("{}", { status: 404 });
    }),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  add.mockReset();
  check.mockReset();
  signInMock.mockReset();
  checkCode.mockReset();
  regenerate.mockReset();
  removeOne.mockReset();
  turnOff.mockReset();
  revokeAll.mockReset();
  startApp.mockReset();
  confirmApp.mockReset();
  renamed.length = 0;
  status = OFF;
});

const CODES = Array.from({ length: 10 }, (_, i) => `code${i}-code${i}`);

describe("TwoStepSection", () => {
  it("turns two-step sign-in on with the first passkey and shows the codes before it is done", async () => {
    serve();
    add.mockImplementation(async () => {
      status = ON;
      return { status: "added", recoveryCodes: CODES, signedIn: true };
    });
    render(<TwoStepSection />);
    await userEvent.click(await screen.findByRole("button", { name: "Add a passkey" }));

    const sheet = await screen.findByRole("dialog", { name: "Save your recovery codes" });
    expect(within(sheet).getAllByRole("listitem")).toHaveLength(10);
    expect(within(sheet).getByRole("button", { name: "Done" }).hasAttribute("disabled")).toBe(true);
    // The list behind it already reads on.
    expect(await screen.findByText("Passkey · never used")).toBeTruthy();

    await userEvent.click(within(sheet).getByRole("checkbox", { name: "I saved these" }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("asks for the passkey first when two-step sign-in is on, then adds the new one", async () => {
    status = ON;
    serve();
    add.mockResolvedValueOnce({ status: "fresh-check-required" }).mockResolvedValueOnce({ status: "added", recoveryCodes: null, signedIn: true });
    check.mockResolvedValue("passed");
    render(<TwoStepSection />);
    await userEvent.click(await screen.findByRole("button", { name: "Add a passkey" }));

    const dialog = await screen.findByRole("dialog", { name: "Confirm it’s you" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Use a passkey" }));
    await waitFor(() => expect(add).toHaveBeenCalledTimes(2));
    // No codes the second time, and the dialog has gone.
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  // Safari refuses the create() that follows the check, since the tap was on the check.
  it("tells the person to tap again when the add that follows the check is cancelled", async () => {
    status = ON;
    serve();
    add.mockResolvedValueOnce({ status: "fresh-check-required" }).mockResolvedValueOnce({ status: "cancelled" });
    check.mockResolvedValue("passed");
    render(<TwoStepSection />);
    await userEvent.click(await screen.findByRole("button", { name: "Add a passkey" }));
    const dialog = await screen.findByRole("dialog", { name: "Confirm it’s you" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Use a passkey" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Tap Add a passkey to continue.");
  });

  it("names what the dialog is for, and its Close works", async () => {
    status = ON;
    serve();
    add.mockResolvedValue({ status: "fresh-check-required" });
    render(<TwoStepSection />);
    await userEvent.click(await screen.findByRole("button", { name: "Add a passkey" }));

    const dialog = await screen.findByRole("dialog", { name: "Confirm it’s you" });
    expect(dialog.getAttribute("aria-describedby")).not.toBeNull();
    expect(dialog.textContent).toContain("Changing how you sign in needs your passkey first.");
    await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not add a passkey after the check was closed while the prompt was up", async () => {
    status = ON;
    serve();
    add.mockResolvedValue({ status: "fresh-check-required" });
    let answer: (result: PasskeyCheck) => void = () => undefined;
    check.mockReturnValue(new Promise<PasskeyCheck>((resolve) => (answer = resolve)));
    render(<TwoStepSection />);
    await userEvent.click(await screen.findByRole("button", { name: "Add a passkey" }));
    const dialog = await screen.findByRole("dialog", { name: "Confirm it’s you" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Use a passkey" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));

    answer("passed");
    await waitFor(() => expect(check).toHaveBeenCalledTimes(1));
    expect(add).toHaveBeenCalledTimes(1);
  });

  it("has no Close on the codes sheet until the tick lets it work", async () => {
    serve();
    add.mockImplementation(async () => {
      status = ON;
      return { status: "added", recoveryCodes: CODES, signedIn: true };
    });
    render(<TwoStepSection />);
    await userEvent.click(await screen.findByRole("button", { name: "Add a passkey" }));
    const sheet = await screen.findByRole("dialog", { name: "Save your recovery codes" });
    expect(within(sheet).queryByRole("button", { name: "Close" })).toBeNull();
    await userEvent.click(within(sheet).getByRole("checkbox", { name: "I saved these" }));
    expect(within(sheet).getByRole("button", { name: "Close" })).toBeTruthy();
  });

  it("sends the person to sign in again, after the codes, when the session could not be told", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    serve();
    add.mockImplementation(async () => {
      status = ON;
      return { status: "added", recoveryCodes: CODES, signedIn: false };
    });
    render(<TwoStepSection />);
    await userEvent.click(await screen.findByRole("button", { name: "Add a passkey" }));
    const sheet = await screen.findByRole("dialog", { name: "Save your recovery codes" });
    expect(within(sheet).getByRole("alert").textContent).toContain("sign in again");
    expect(assign).not.toHaveBeenCalled();

    await userEvent.click(within(sheet).getByRole("checkbox", { name: "I saved these" }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Done" }));
    expect(assign).toHaveBeenCalledWith("/api/session-expired?callbackUrl=%2Faccount%3Ftab%3Dsecurity");
  });

  it("asks for a fresh Google sign-in instead while two-step sign-in is off", async () => {
    serve();
    add.mockResolvedValue({ status: "fresh-check-required" });
    render(<TwoStepSection />);
    await userEvent.click(await screen.findByRole("button", { name: "Add a passkey" }));

    const dialog = await screen.findByRole("dialog", { name: "Sign in again" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Sign in with Google" }));
    expect(signInMock).toHaveBeenCalledWith("google", { callbackUrl: "/account?tab=security" });
    expect(check).not.toHaveBeenCalled();
  });

  it("renames a factor", async () => {
    status = ON;
    serve();
    render(<TwoStepSection />);
    await userEvent.click(await screen.findByRole("button", { name: "Rename Device passkey" }));
    const field = screen.getByRole("textbox", { name: "Factor name" });
    await userEvent.clear(field);
    await userEvent.type(field, "iPhone passkey");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("iPhone passkey")).toBeTruthy();
    expect(renamed).toEqual([{ url: "/api/account/mfa/factors/f1", body: { name: "iPhone passkey" } }]);
  });

  it.each(["Save", "Cancel"])("returns focus to the row's Rename button after %s", async (ending) => {
    status = ON;
    serve();
    render(<TwoStepSection />);
    await userEvent.click(await screen.findByRole("button", { name: "Rename Device passkey" }));
    await userEvent.click(screen.getByRole("button", { name: ending }));

    const back = await screen.findByRole("button", { name: /^Rename / });
    // `:focus` asked of the element found: the test wall bans reading `document.activeElement`.
    await waitFor(() => expect(back.matches(":focus")).toBe(true));
  });

  it("says nothing when the person closes the browser's prompt, and says so when adding fails", async () => {
    serve();
    add.mockResolvedValueOnce({ status: "cancelled" });
    render(<TwoStepSection />);
    await userEvent.click(await screen.findByRole("button", { name: "Add a passkey" }));
    await waitFor(() => expect(add).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).toBeNull();

    add.mockResolvedValueOnce({ status: "failed", reason: "already-registered" });
    await userEvent.click(screen.getByRole("button", { name: "Add a passkey" }));
    expect((await screen.findByRole("alert")).textContent).toBe("That passkey is already on this account.");
  });

  it("turns two-step sign-in on with an authenticator app as the first factor, then shows the codes", async () => {
    serve();
    startApp.mockResolvedValue({ status: "started", start: { ticket: "t1", secret: "JBSWY3DPEHPK3PXP", qr: "data:image/png;base64,AAAA" } });
    confirmApp.mockImplementation(async () => {
      status = { enabled: true, factors: [{ ...phone, name: "Authenticator app", kind: "totp" }], recoveryCodesLeft: 10 };
      return { status: "added", recoveryCodes: CODES, signedIn: true };
    });
    render(<TwoStepSection />);
    await userEvent.click(await screen.findByRole("button", { name: "Add an authenticator app" }));
    const dialog = await screen.findByRole("dialog", { name: "Add an authenticator app" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Authenticator code" }), "123456{Enter}");

    const sheet = await screen.findByRole("dialog", { name: "Save your recovery codes" });
    expect(within(sheet).getAllByRole("listitem")).toHaveLength(10);
    expect(confirmApp).toHaveBeenCalledWith("t1", "123456");
    expect(await screen.findByText("Authenticator app · never used")).toBeTruthy();
  });

  it("asks for a check first when adding an authenticator app, and a code is enough", async () => {
    status = ON;
    serve();
    startApp.mockResolvedValueOnce({ status: "fresh-check-required" });
    startApp.mockResolvedValue({ status: "started", start: { ticket: "t2", secret: "JBSWY3DPEHPK3PXP", qr: "data:image/png;base64,AAAA" } });
    checkCode.mockResolvedValue("passed");
    render(<TwoStepSection />);
    await userEvent.click(await screen.findByRole("button", { name: "Add an authenticator app" }));

    const check = await screen.findByRole("dialog", { name: "Confirm it’s you" });
    await userEvent.click(within(check).getByRole("button", { name: "Use authenticator code" }));
    await userEvent.type(within(check).getByRole("textbox", { name: "Authenticator code" }), "654321{Enter}");
    expect(checkCode).toHaveBeenCalledWith("otp", "654321");
    expect(await screen.findByRole("dialog", { name: "Add an authenticator app" })).toBeTruthy();
    expect(startApp).toHaveBeenCalledTimes(2);
  });

  it("says how many recovery codes are left, and Regenerate shows the new set once the check passes", async () => {
    status = ON;
    serve();
    regenerate.mockResolvedValueOnce({ status: "fresh-check-required" });
    regenerate.mockResolvedValueOnce({ status: "regenerated", recoveryCodes: CODES });
    check.mockResolvedValue("passed");
    render(<TwoStepSection />);
    expect(await screen.findByText("Recovery codes: 9 of 10 left")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    await userEvent.click(screen.getByRole("button", { name: "Regenerate codes" }));

    const dialog = await screen.findByRole("dialog", { name: "Confirm it’s you" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Use a passkey" }));
    const sheet = await screen.findByRole("dialog", { name: "Save your recovery codes" });
    expect(within(sheet).getAllByRole("listitem")).toHaveLength(10);
    expect(regenerate).toHaveBeenCalledTimes(2);
  });

  it("says the old codes are voided and waits for a second click before regenerating", async () => {
    status = ON;
    serve();
    regenerate.mockResolvedValue({ status: "regenerated", recoveryCodes: CODES });
    render(<TwoStepSection />);
    await userEvent.click(await screen.findByRole("button", { name: "Regenerate" }));
    expect(screen.getByText("This voids your current codes.")).toBeTruthy();
    expect(regenerate).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Keep current codes" }));
    expect(regenerate).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Regenerate" })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    await userEvent.click(screen.getByRole("button", { name: "Regenerate codes" }));
    expect(await screen.findByRole("dialog", { name: "Save your recovery codes" })).toBeTruthy();
    expect(regenerate).toHaveBeenCalledTimes(1);
  });

  it("moves focus to the passkey button when the check goes back to the passkey", async () => {
    status = ON;
    serve();
    regenerate.mockResolvedValue({ status: "fresh-check-required" });
    render(<TwoStepSection />);
    await userEvent.click(await screen.findByRole("button", { name: "Regenerate" }));
    await userEvent.click(screen.getByRole("button", { name: "Regenerate codes" }));
    const dialog = await screen.findByRole("dialog", { name: "Confirm it’s you" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Use authenticator code" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Use a passkey" }));
    const passkey = within(dialog).getByRole("button", { name: "Use a passkey" });
    await waitFor(() => expect(passkey.matches(":focus")).toBe(true));
  });

  it("does not show the recovery codes line while two-step sign-in is off", async () => {
    serve();
    render(<TwoStepSection />);
    await screen.findByRole("button", { name: "Add a passkey" });
    expect(screen.queryByText(/Recovery codes:/)).toBeNull();
  });

  it("opens the fresh check on a code when the account has no passkey", async () => {
    status = { enabled: true, factors: [{ ...phone, kind: "totp" }], recoveryCodesLeft: 10 };
    serve();
    regenerate.mockResolvedValue({ status: "fresh-check-required" });
    render(<TwoStepSection />);
    await userEvent.click(await screen.findByRole("button", { name: "Regenerate" }));
    await userEvent.click(screen.getByRole("button", { name: "Regenerate codes" }));
    const dialog = await screen.findByRole("dialog", { name: "Confirm it’s you" });
    expect(within(dialog).getByRole("textbox", { name: "Authenticator code" })).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Use a passkey" })).toBeNull();
  });

  describe("removing a factor", () => {
    const app = { id: "f2", name: "Authenticator app", kind: "totp" as const, createdAt: "2026-11-02T00:00:00Z", lastUsedAt: null };
    const TWO: MfaStatusResponse = { enabled: true, factors: [phone, app], recoveryCodesLeft: 9 };

    it("removes the factor after a confirm, and the list reads on without it", async () => {
      status = TWO;
      serve();
      removeOne.mockImplementation(async () => {
        status = ON;
        return { status: "done", signedIn: true };
      });
      render(<TwoStepSection />);
      await userEvent.click(await screen.findByRole("button", { name: "Remove Authenticator app" }));
      // Nothing is sent by the first click.
      expect(removeOne).not.toHaveBeenCalled();
      await userEvent.click(screen.getByRole("button", { name: "Yes, remove Authenticator app" }));
      await waitFor(() => expect(removeOne).toHaveBeenCalledWith("f2"));
      await waitFor(() => expect(screen.queryByText("Authenticator app")).toBeNull());
    });

    // Remove unmounts with focus in it, and so does Keep: without a hand-off a
    // keyboard user's next Tab starts again from the top of the page.
    it("moves focus to the confirm when Remove opens it, and back to Remove when Keep closes it", async () => {
      status = TWO;
      serve();
      render(<TwoStepSection />);
      (await screen.findByRole("button", { name: "Remove Authenticator app" })).focus();
      await userEvent.keyboard("{Enter}");
      expect(screen.getByRole("button", { name: "Yes, remove Authenticator app" }).matches(":focus")).toBe(true);
      await userEvent.click(screen.getByRole("button", { name: "Keep Authenticator app" }));
      expect(screen.getByRole("button", { name: "Remove Authenticator app" }).matches(":focus")).toBe(true);
    });

    it("opens the fresh check when Remove is refused for want of one, and removes once it passes", async () => {
      status = TWO;
      serve();
      removeOne.mockResolvedValueOnce({ status: "fresh-check-required" }).mockResolvedValueOnce({ status: "done", signedIn: true });
      check.mockResolvedValue("passed");
      render(<TwoStepSection />);
      await userEvent.click(await screen.findByRole("button", { name: "Remove Authenticator app" }));
      await userEvent.click(screen.getByRole("button", { name: "Yes, remove Authenticator app" }));
      const dialog = await screen.findByRole("dialog", { name: "Confirm it’s you" });
      await userEvent.click(within(dialog).getByRole("button", { name: "Use a passkey" }));
      await waitFor(() => expect(removeOne).toHaveBeenCalledTimes(2));
    });

    it("offers no Remove for the only factor, and says Turn off is the way", async () => {
      status = ON;
      serve();
      render(<TwoStepSection />);
      await screen.findByText("Device passkey");
      expect(screen.queryByRole("button", { name: "Remove Device passkey" })).toBeNull();
      expect(screen.getByText(/only second step/i).textContent).toContain("Turn off two-step sign-in");
    });

    it("sends the person to sign in again when this session could not be kept", async () => {
      status = TWO;
      serve();
      removeOne.mockResolvedValue({ status: "done", signedIn: false });
      const assign = vi.fn();
      vi.stubGlobal("location", { ...window.location, assign });
      render(<TwoStepSection />);
      await userEvent.click(await screen.findByRole("button", { name: "Remove Authenticator app" }));
      await userEvent.click(screen.getByRole("button", { name: "Yes, remove Authenticator app" }));
      await waitFor(() => expect(assign).toHaveBeenCalledWith(expect.stringContaining("/api/session-expired")));
    });
  });

  describe("turning two-step sign-in off", () => {
    it("asks first, then removes everything and shows the section off", async () => {
      status = ON;
      serve();
      turnOff.mockImplementation(async () => {
        status = OFF;
        return { status: "done", signedIn: true };
      });
      render(<TwoStepSection />);
      await userEvent.click(await screen.findByRole("button", { name: "Turn off two-step sign-in" }));
      const confirm = await screen.findByRole("dialog", { name: "Turn off two-step sign-in?" });
      expect(turnOff).not.toHaveBeenCalled();
      await userEvent.click(within(confirm).getByRole("button", { name: "Turn off" }));
      await waitFor(() => expect(turnOff).toHaveBeenCalledTimes(1));
      expect(await screen.findByText("Add a second step after Google")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Turn off two-step sign-in" })).toBeNull();
    });

    it("keeps it on when the confirm is cancelled", async () => {
      status = ON;
      serve();
      render(<TwoStepSection />);
      await userEvent.click(await screen.findByRole("button", { name: "Turn off two-step sign-in" }));
      await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel" }));
      expect(turnOff).not.toHaveBeenCalled();
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("opens the fresh check when refused for want of one, and turns off once it passes", async () => {
      status = ON;
      serve();
      turnOff.mockResolvedValueOnce({ status: "fresh-check-required" }).mockResolvedValueOnce({ status: "done", signedIn: true });
      check.mockResolvedValue("passed");
      render(<TwoStepSection />);
      await userEvent.click(await screen.findByRole("button", { name: "Turn off two-step sign-in" }));
      await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Turn off" }));
      const dialog = await screen.findByRole("dialog", { name: "Confirm it’s you" });
      await userEvent.click(within(dialog).getByRole("button", { name: "Use a passkey" }));
      await waitFor(() => expect(turnOff).toHaveBeenCalledTimes(2));
    });
  });

  describe("the revoke-everything tick", () => {
    async function turnOnAndReachSheet(onRevoked?: () => void) {
      status = OFF;
      serve();
      add.mockImplementation(async () => {
        status = ON;
        return { status: "added", recoveryCodes: CODES, signedIn: true };
      });
      render(<TwoStepSection onRevoked={onRevoked} />);
      await userEvent.click(await screen.findByRole("button", { name: "Add a passkey" }));
      return screen.findByRole("dialog", { name: "Save your recovery codes" });
    }

    it("is unticked, and ticking it revokes every token and connected app when Done is pressed", async () => {
      revokeAll.mockResolvedValue("revoked");
      const onRevoked = vi.fn();
      const sheet = await turnOnAndReachSheet(onRevoked);
      const tick = within(sheet).getByRole("checkbox", { name: /Also revoke all tokens and connected apps/ });
      expect((tick as HTMLInputElement).checked).toBe(false);
      await userEvent.click(tick);
      await userEvent.click(within(sheet).getByRole("checkbox", { name: "I saved these" }));
      await userEvent.click(within(sheet).getByRole("button", { name: "Done" }));
      await waitFor(() => expect(revokeAll).toHaveBeenCalledTimes(1));
      // What tells the token and connected-app lists to read again.
      await waitFor(() => expect(onRevoked).toHaveBeenCalledTimes(1));
    });

    it("does not tell the lists anything changed when the revoke fails", async () => {
      revokeAll.mockResolvedValue("failed");
      const onRevoked = vi.fn();
      const sheet = await turnOnAndReachSheet(onRevoked);
      await userEvent.click(within(sheet).getByRole("checkbox", { name: /Also revoke all tokens and connected apps/ }));
      await userEvent.click(within(sheet).getByRole("checkbox", { name: "I saved these" }));
      await userEvent.click(within(sheet).getByRole("button", { name: "Done" }));
      expect(await screen.findByRole("alert")).toBeTruthy();
      expect(onRevoked).not.toHaveBeenCalled();
    });

    it("revokes nothing when left unticked", async () => {
      const sheet = await turnOnAndReachSheet();
      await userEvent.click(within(sheet).getByRole("checkbox", { name: "I saved these" }));
      await userEvent.click(within(sheet).getByRole("button", { name: "Done" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(revokeAll).not.toHaveBeenCalled();
    });

    it("is not offered on regenerated codes", async () => {
      status = ON;
      serve();
      regenerate.mockResolvedValue({ status: "regenerated", recoveryCodes: CODES });
      render(<TwoStepSection />);
      await userEvent.click(await screen.findByRole("button", { name: "Regenerate" }));
      await userEvent.click(screen.getByRole("button", { name: "Regenerate codes" }));
      const sheet = await screen.findByRole("dialog", { name: "Save your recovery codes" });
      expect(within(sheet).queryByRole("checkbox", { name: /Also revoke all tokens and connected apps/ })).toBeNull();
    });
  });
});
