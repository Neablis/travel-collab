import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AddPasskeyResult, PasskeyCheck } from "@/lib/mfaClient";
import type { MfaStatusResponse } from "@/lib/mfaWire";

const add = vi.fn<() => Promise<AddPasskeyResult>>();
const check = vi.fn<() => Promise<PasskeyCheck>>();
vi.mock("@/lib/mfaClient", () => ({ addPasskey: () => add(), checkWithPasskey: () => check() }));
const signInMock = vi.fn();
vi.mock("next-auth/react", () => ({ signIn: (...args: unknown[]) => signInMock(...args) }));

import { TwoStepSection } from "./TwoStepSection";

const OFF: MfaStatusResponse = { enabled: false, factors: [] };
const phone = { id: "f1", name: "Device passkey", kind: "passkey" as const, createdAt: "2026-11-01T00:00:00Z", lastUsedAt: null };
const ON: MfaStatusResponse = { enabled: true, factors: [phone] };

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
});
