import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// **The operator reset on the account page** (M62 D9, D15): Reset stays shut
// until there is a reason and the tick, it sends both, the page re-reads after,
// and a refusal says nothing changed. The route behind it is
// `mfa-reset/route.int.test.ts`.

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import { AccountMfaReset } from "./AccountMfaReset";

const NOW = "2026-11-21T12:00:00.000Z";
const ON = { enabled: true, factors: 2, resets: [] };

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

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Reset two-step sign-in" }));
  return screen.getByRole("dialog", { name: "Reset two-step sign-in" });
}

describe("AccountMfaReset", () => {
  it("resets only with a reason and the tick, sends both, then re-reads the page", async () => {
    fetchMock.mockResolvedValue(json({ at: NOW }));
    const user = userEvent.setup();
    render(<AccountMfaReset accountId="dev-mei" account="mei@gmail.com" mfa={ON} now={NOW} />);

    const dialog = await openDialog(user);
    const confirm = within(dialog).getByRole("button", { name: "Reset" }) as HTMLButtonElement;
    const tick = within(dialog).getByRole("checkbox", { name: /I confirmed this by email/ });
    // Each alone leaves it shut.
    await user.click(tick);
    expect(confirm.disabled).toBe(true);
    await user.click(tick);
    await user.type(within(dialog).getByLabelText("Reason"), "Lost her phone and codes");
    expect(confirm.disabled).toBe(true);
    await user.click(tick);
    expect(confirm.disabled).toBe(false);

    await user.click(confirm);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/accounts/dev-mei/mfa-reset",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ reason: "Lost her phone and codes", confirmed: true }),
      }),
    );
    expect(refresh).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  // The opener is gone once the page re-reads with two-step off, and focus would go with it.
  it("moves focus to the two-step state, which says Off, once a reset lands", async () => {
    fetchMock.mockResolvedValue(json({ at: NOW }));
    const user = userEvent.setup();
    const { rerender } = render(<AccountMfaReset accountId="dev-mei" account="mei@gmail.com" mfa={ON} now={NOW} />);
    refresh.mockImplementation(() =>
      rerender(<AccountMfaReset accountId="dev-mei" account="mei@gmail.com" mfa={{ ...ON, enabled: false, factors: 0 }} now={NOW} />),
    );

    const dialog = await openDialog(user);
    await user.type(within(dialog).getByLabelText("Reason"), "Lost her phone");
    await user.click(within(dialog).getByRole("checkbox", { name: /I confirmed this by email/ }));
    await user.click(within(dialog).getByRole("button", { name: "Reset" }));

    expect(screen.queryByRole("button", { name: "Reset two-step sign-in" })).toBeNull();
    const state = screen.getByRole("status");
    expect(state.textContent).toBe("Off");
    await waitFor(() => expect(state.matches(":focus")).toBe(true));
  });

  // In production the re-read usually outlasts the dialog's exit, so the opener is
  // still mounted when Radix's unmount timeout runs: focus must not go back to it,
  // or the re-read removes it and drops focus to the page.
  it("keeps focus on the two-step state when the page re-reads only after the dialog has gone", async () => {
    fetchMock.mockResolvedValue(json({ at: NOW }));
    const user = userEvent.setup();
    const { rerender } = render(<AccountMfaReset accountId="dev-mei" account="mei@gmail.com" mfa={ON} now={NOW} />);

    const dialog = await openDialog(user);
    await user.type(within(dialog).getByLabelText("Reason"), "Lost her phone");
    await user.click(within(dialog).getByRole("checkbox", { name: /I confirmed this by email/ }));
    await user.click(within(dialog).getByRole("button", { name: "Reset" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // Radix's unmount autofocus runs from a timeout of its own.
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    rerender(<AccountMfaReset accountId="dev-mei" account="mei@gmail.com" mfa={{ ...ON, enabled: false, factors: 0 }} now={NOW} />);

    expect(screen.getByRole("status").matches(":focus")).toBe(true);
  });

  // Disabling the focused button would drop focus to the page while the request is out.
  it("keeps Reset focusable while the request is in flight, and sends it once", async () => {
    let answer!: (res: Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => (answer = resolve)));
    const user = userEvent.setup();
    render(<AccountMfaReset accountId="dev-mei" account="mei@gmail.com" mfa={ON} now={NOW} />);

    const dialog = await openDialog(user);
    await user.type(within(dialog).getByLabelText("Reason"), "Lost her phone");
    await user.click(within(dialog).getByRole("checkbox", { name: /I confirmed this by email/ }));
    const confirm = within(dialog).getByRole("button", { name: "Reset" }) as HTMLButtonElement;
    await user.click(confirm);
    expect(confirm.disabled).toBe(false);
    expect(confirm.getAttribute("aria-disabled")).toBe("true");
    await user.click(confirm);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    answer(json({ error: "mfa-not-enabled" }, 409));
    expect(await within(dialog).findByRole("alert")).toBeTruthy();
  });

  it("says nothing changed when the server refuses, and keeps the dialog open", async () => {
    fetchMock.mockResolvedValue(json({ error: "mfa-not-enabled" }, 409));
    const user = userEvent.setup();
    render(<AccountMfaReset accountId="dev-mei" account="mei@gmail.com" mfa={ON} now={NOW} />);

    const dialog = await openDialog(user);
    await user.type(within(dialog).getByLabelText("Reason"), "Lost her phone");
    await user.click(within(dialog).getByRole("checkbox", { name: /I confirmed this by email/ }));
    await user.click(within(dialog).getByRole("button", { name: "Reset" }));

    expect((await within(dialog).findByRole("alert")).textContent).toContain("Nothing changed");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("lists every reset with who did it and why, and offers none while it is off", () => {
    render(
      <AccountMfaReset
        accountId="dev-mei"
        account="mei@gmail.com"
        mfa={{
          enabled: false,
          factors: 0,
          resets: [{ at: "2026-11-20T09:00:00.000Z", operator: "ops@caesura.example", reason: "Lost her phone" }],
        }}
        now={NOW}
      />,
    );
    const [reset] = within(screen.getByRole("list", { name: "Resets" })).getAllByRole("listitem");
    expect(reset!.textContent).toContain("Yesterday");
    expect(reset!.textContent).toContain("ops@caesura.example");
    expect(reset!.textContent).toContain("Lost her phone");
    expect(screen.queryByRole("button", { name: "Reset two-step sign-in" })).toBeNull();
  });
});
