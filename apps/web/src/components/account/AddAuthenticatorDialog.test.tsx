import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConfirmAuthenticatorResult, StartAuthenticatorResult } from "@/lib/mfaClient";

const start = vi.fn<() => Promise<StartAuthenticatorResult>>();
const confirm = vi.fn<(ticket: string, code: string) => Promise<ConfirmAuthenticatorResult>>();
vi.mock("@/lib/mfaClient", () => ({
  startAuthenticator: () => start(),
  confirmAuthenticator: (ticket: string, code: string) => confirm(ticket, code),
}));

import { AddAuthenticatorDialog } from "./AddAuthenticatorDialog";

const STARTED: StartAuthenticatorResult = {
  status: "started",
  start: { ticket: "t1", secret: "JBSWY3DPEHPK3PXP", qr: "data:image/png;base64,AAAA" },
};

afterEach(() => {
  cleanup();
  start.mockReset();
  confirm.mockReset();
});

function open() {
  const onAdded = vi.fn();
  const onFreshCheckRequired = vi.fn();
  const onClose = vi.fn();
  render(<AddAuthenticatorDialog onAdded={onAdded} onFreshCheckRequired={onFreshCheckRequired} onClose={onClose} />);
  return { onAdded, onFreshCheckRequired, onClose };
}

describe("AddAuthenticatorDialog", () => {
  it("shows the QR code, keeps the secret behind Can't scan?, and confirms with the typed code", async () => {
    start.mockResolvedValue(STARTED);
    confirm.mockResolvedValue({ status: "added", recoveryCodes: ["a-b"], signedIn: true });
    const { onAdded } = open();

    expect(await screen.findByRole("img", { name: "QR code for your authenticator app" })).toBeDefined();
    expect(screen.queryByText("JBSWY3DPEHPK3PXP")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Can’t scan?" }));
    expect(screen.getByText("JBSWY3DPEHPK3PXP")).toBeDefined();

    await userEvent.type(screen.getByRole("textbox", { name: "Authenticator code" }), "123456{Enter}");
    await waitFor(() => expect(onAdded).toHaveBeenCalledWith(["a-b"], true));
    expect(confirm).toHaveBeenCalledWith("t1", "123456");
  });

  it("says a wrong code did not work, stays open and does not report an add", async () => {
    start.mockResolvedValue(STARTED);
    confirm.mockResolvedValue({ status: "wrong-code" });
    const { onAdded } = open();
    await userEvent.type(await screen.findByRole("textbox", { name: "Authenticator code" }), "000000{Enter}");
    expect((await screen.findByRole("alert")).textContent).toBe("That code did not work. Check your app and try again.");
    expect(onAdded).not.toHaveBeenCalled();
  });

  it("ties the refusal to the code field", async () => {
    start.mockResolvedValue(STARTED);
    confirm.mockResolvedValue({ status: "wrong-code" });
    open();
    const field = await screen.findByRole("textbox", { name: "Authenticator code" });
    await userEvent.type(field, "000000{Enter}");
    const problem = await screen.findByRole("alert");
    expect(field.getAttribute("aria-describedby")).toBe(problem.id);
  });

  it("hands over to the fresh check when the confirm finds the check has lapsed, instead of failing", async () => {
    start.mockResolvedValue(STARTED);
    confirm.mockResolvedValue({ status: "fresh-check-required" });
    const { onFreshCheckRequired, onAdded } = open();
    await userEvent.type(await screen.findByRole("textbox", { name: "Authenticator code" }), "123456{Enter}");
    await waitFor(() => expect(onFreshCheckRequired).toHaveBeenCalledTimes(1));
    expect(onAdded).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("hands over to the fresh check when the route asks for one", async () => {
    start.mockResolvedValue({ status: "fresh-check-required" });
    const { onFreshCheckRequired } = open();
    await waitFor(() => expect(onFreshCheckRequired).toHaveBeenCalledTimes(1));
  });

  it("says so when no secret could be made", async () => {
    start.mockResolvedValue({ status: "failed" });
    open();
    expect((await screen.findByRole("alert")).textContent).toContain("could not be set up");
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
