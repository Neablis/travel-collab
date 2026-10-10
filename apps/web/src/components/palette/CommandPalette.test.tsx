import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { registerPhoneAsk } from "@/components/nav/phoneAsk";
import { CommandPalette } from "./CommandPalette";
import { type PaletteCommand, registerPaletteCommands } from "./paletteRegistry";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

let signedIn = true;
vi.mock("@/components/account/useSessionUser", () => ({
  useSessionUser: () => (signedIn ? { userId: "u1", email: "a@example.com", name: "A" } : null),
}));

const fetchTrips = vi.fn();
vi.mock("@/lib/apiClient", () => ({ fetchTrips: () => fetchTrips() }));

const taken: Array<() => void> = [];
function offer(commands: PaletteCommand[]) {
  taken.push(registerPaletteCommands("test", commands));
}
const command = (label: string, run: () => void, group: PaletteCommand["group"] = "Go to"): PaletteCommand => ({
  id: label,
  label,
  group,
  run,
});

beforeEach(() => {
  signedIn = true;
  push.mockReset();
  fetchTrips.mockReset().mockResolvedValue({ ok: true, value: [] });
});
afterEach(() => {
  taken.splice(0).forEach((takeBack) => takeBack());
  cleanup();
});

const palette = () => screen.queryByRole("dialog", { name: "Go to or do" });

describe("CommandPalette", () => {
  it("opens on ⌘K and closes on it again", async () => {
    render(<CommandPalette />);
    expect(palette()).toBeNull();
    await userEvent.keyboard("{Meta>}k{/Meta}");
    expect(palette()).toBeTruthy();
    await userEvent.keyboard("{Meta>}k{/Meta}");
    await waitFor(() => expect(palette()).toBeNull());
  });

  it("opens on Ctrl+K as well, for a keyboard without ⌘", async () => {
    render(<CommandPalette />);
    await userEvent.keyboard("{Control>}k{/Control}");
    expect(palette()).toBeTruthy();
  });

  // ADR-068 §1: the palette runs the page's function, and only once it has
  // closed, so what the command opens is not opened under it.
  it("runs the top match on Enter, once the palette has closed", async () => {
    const seen: Array<boolean> = [];
    const calendar = vi.fn(() => seen.push(palette() === null));
    offer([command("Plan", vi.fn()), command("Calendar", calendar)]);
    render(<CommandPalette />);
    await userEvent.keyboard("{Meta>}k{/Meta}");
    await userEvent.keyboard("cal{Enter}");
    await waitFor(() => expect(calendar).toHaveBeenCalledTimes(1));
    expect(seen).toEqual([true]);
  });

  it("moves down the list with the arrow keys", async () => {
    const plan = vi.fn();
    const calendar = vi.fn();
    offer([command("Plan", plan), command("Calendar", calendar)]);
    render(<CommandPalette />);
    await userEvent.keyboard("{Meta>}k{/Meta}{ArrowDown}{Enter}");
    await waitFor(() => expect(calendar).toHaveBeenCalledTimes(1));
    expect(plan).not.toHaveBeenCalled();
  });

  // ADR-068 §5: unmatched text goes nowhere, not to the assistant.
  it("says so when nothing matches, and Enter then does nothing", async () => {
    const plan = vi.fn();
    offer([command("Plan", plan)]);
    render(<CommandPalette />);
    await userEvent.keyboard("{Meta>}k{/Meta}zzz");
    expect(screen.getByText("No match")).toBeTruthy();
    await userEvent.keyboard("{Enter}");
    expect(palette()).toBeTruthy();
    expect(plan).not.toHaveBeenCalled();
  });

  // The assistant's opener is the one the phone's tab bar Ask uses, so the
  // palette cannot open it any differently (Mitchell, D9).
  it("offers the assistant through the screen's registered opener, and not while it is open", async () => {
    const onOpen = vi.fn();
    taken.push(registerPhoneAsk({ open: false, onOpen }));
    render(<CommandPalette />);
    await userEvent.keyboard("{Meta>}k{/Meta}ask{Enter}");
    await waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1));

    taken.push(registerPhoneAsk({ open: true, onOpen }));
    await userEvent.keyboard("{Meta>}k{/Meta}ask");
    expect(screen.queryByRole("option", { name: /Ask the assistant/ })).toBeNull();
  });

  it("goes to one of your trips by name", async () => {
    fetchTrips.mockResolvedValue({ ok: true, value: [{ tripId: "t1", name: "Kyoto in spring", status: "active" }] });
    render(<CommandPalette />);
    await userEvent.keyboard("{Meta>}k{/Meta}");
    await screen.findByRole("option", { name: /Kyoto in spring/ });
    await userEvent.keyboard("kyo{Enter}");
    await waitFor(() => expect(push).toHaveBeenCalledWith("/trips/t1"));
  });

  it("offers a reader with no account only what is open to them", async () => {
    signedIn = false;
    render(<CommandPalette />);
    await userEvent.keyboard("{Meta>}k{/Meta}");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["PlaybooksGo to"]);
    expect(fetchTrips).not.toHaveBeenCalled();
  });

  // KI-2026-10-09-b. Said through the keyboard, as ConflictsChip.test's is
  // (the wall bans reading focus directly): Enter presses the button only if
  // it has focus back.
  it("hands focus back to where it was when it closes", async () => {
    const pressed = vi.fn();
    render(
      <>
        <button type="button" onClick={pressed}>
          Opener
        </button>
        <CommandPalette />
      </>,
    );
    await userEvent.tab();
    await userEvent.keyboard("{Meta>}k{/Meta}");
    expect(palette()).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(palette()).toBeNull());
    await userEvent.keyboard("{Enter}");
    expect(pressed).toHaveBeenCalledTimes(1);
  });
});
