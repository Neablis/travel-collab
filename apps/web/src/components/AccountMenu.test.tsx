import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountMenu, AccountMenuFromSession } from "./AccountMenu";

vi.mock("next-auth/react", () => ({
  getSession: vi.fn(),
  signOut: vi.fn(async () => {}),
}));

afterEach(cleanup);

describe("AccountMenu", () => {
  it("shows the signed-in identity behind the avatar", async () => {
    render(<AccountMenu name="Sam K" email="sam@example.com" />);
    await userEvent.click(screen.getByRole("button", { name: "Account menu" }));
    expect(screen.getByText("sam@example.com")).toBeTruthy();
  });

  it("signs out", async () => {
    const onSignOut = vi.fn();
    render(<AccountMenu name="Sam K" email="sam@example.com" onSignOut={onSignOut} />);
    await userEvent.click(screen.getByRole("button", { name: "Account menu" }));
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(onSignOut).toHaveBeenCalled();
  });
});

describe("AccountMenuFromSession", () => {
  it("renders nothing while signed out", async () => {
    const { getSession } = await import("next-auth/react");
    vi.mocked(getSession).mockResolvedValueOnce(null);

    render(<AccountMenuFromSession />);

    await waitFor(() => expect(vi.mocked(getSession)).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Account menu" })).toBeNull();
  });

  it("resolves the session client-side and dispatches the real signOut on click", async () => {
    const { getSession, signOut } = await import("next-auth/react");
    vi.mocked(getSession).mockResolvedValueOnce({
      user: { name: "Sam K", email: "sam@example.com" },
      expires: "",
    });

    render(<AccountMenuFromSession />);

    await userEvent.click(await screen.findByRole("button", { name: "Account menu" }));
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));

    expect(signOut).toHaveBeenCalledWith({ callbackUrl: "/" });
  });
});
