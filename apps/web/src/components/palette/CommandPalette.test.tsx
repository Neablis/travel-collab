import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

// What the palette reads to tell a Mac (⌘K) from anything else (Ctrl+K).
// jsdom's own is "", so each test says which it is: a Mac unless it says not.
let platform = "MacIntel";
beforeEach(() => {
  platform = "MacIntel";
  vi.spyOn(navigator, "platform", "get").mockImplementation(() => platform);
  signedIn = true;
  push.mockReset();
  fetchTrips.mockReset().mockResolvedValue({ ok: true, value: [] });
});
afterEach(() => {
  vi.restoreAllMocks();
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

  it("opens on Ctrl+K off a Mac, and not on the Windows key", async () => {
    platform = "Win32";
    render(<CommandPalette />);
    await userEvent.keyboard("{Meta>}k{/Meta}");
    expect(palette()).toBeNull();
    await userEvent.keyboard("{Control>}k{/Control}");
    expect(palette()).toBeTruthy();
  });

  // PR 398 review: Ctrl+K in a Mac text field deletes to the end of the line.
  it("leaves Ctrl+K to the text field on a Mac", async () => {
    render(<CommandPalette />);
    await userEvent.keyboard("{Control>}k{/Control}");
    expect(palette()).toBeNull();
  });

  // PR 398 review: on a Russian layout the K key types "л".
  it("opens by the K key where the layout's letters are not Latin", () => {
    render(<CommandPalette />);
    fireEvent.keyDown(window, { key: "л", code: "KeyK", metaKey: true });
    expect(palette()).toBeTruthy();
  });

  // PR 398 review: an IME's Enter commits the candidate it is composing.
  it("runs nothing on an Enter that ends an IME composition", async () => {
    const plan = vi.fn();
    offer([command("Plan", plan)]);
    render(<CommandPalette />);
    await userEvent.keyboard("{Meta>}k{/Meta}");
    const box = screen.getByRole("combobox", { name: "Go to or do" });
    fireEvent.keyDown(box, { key: "Enter", isComposing: true });
    fireEvent.keyDown(box, { key: "Enter", keyCode: 229 });
    expect(palette()).toBeTruthy();
    expect(plan).not.toHaveBeenCalled();
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
    expect(palette()).toBeTruthy();
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

  // PR 398 review: a list kept from the last opening offers a trip deleted
  // since, until this opening's read lands, and for good if it fails.
  it("shows none of the last opening's trips before this opening's arrive", async () => {
    fetchTrips.mockResolvedValue({ ok: true, value: [{ tripId: "t1", name: "Kyoto in spring", status: "active" }] });
    render(<CommandPalette />);
    await userEvent.keyboard("{Meta>}k{/Meta}");
    await screen.findByRole("option", { name: /Kyoto in spring/ });
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(palette()).toBeNull());

    fetchTrips.mockResolvedValue({ ok: false, error: { code: "network" } });
    await userEvent.keyboard("{Meta>}k{/Meta}");
    expect(palette()).toBeTruthy();
    await waitFor(() => expect(fetchTrips).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("option", { name: /Kyoto in spring/ })).toBeNull();
  });

  // PR 398 review: the list can shrink under the highlight while it is open.
  it("keeps the highlight on the list when the list shrinks under it", async () => {
    signedIn = false;
    offer([command("Alpha", vi.fn()), command("Beta", vi.fn())]);
    render(<CommandPalette />);
    await userEvent.keyboard("{Meta>}k{/Meta}{ArrowDown}{ArrowDown}");
    expect(screen.getByRole("option", { selected: true }).textContent).toBe("PlaybooksGo to");

    act(() => offer([command("Alpha", vi.fn())]));
    const box = screen.getByRole("combobox", { name: "Go to or do" });
    expect(screen.getByRole("option", { selected: true }).id).toBe(box.getAttribute("aria-activedescendant"));
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(push).toHaveBeenCalledWith("/playbooks"));
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
