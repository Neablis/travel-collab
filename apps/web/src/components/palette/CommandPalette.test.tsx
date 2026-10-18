import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

// Whether the plan includes the assistant: `null` (unknown, read as entitled)
// unless a test says otherwise. Asked only where there is an Ask: to offer.
let aiEntitled: boolean | null = null;
const entitlementAsked = vi.fn();
vi.mock("@/lib/useAiEntitled", () => ({
  AI_ASK_ENTITLEMENT: "ai.ask",
  useEntitled: (capability: string, active: boolean) => {
    if (active) entitlementAsked(capability);
    return active ? aiEntitled : null;
  },
}));

const fetchTrips = vi.fn();
vi.mock("@/lib/apiClient", () => ({ fetchTrips: () => fetchTrips() }));

const taken: Array<() => void> = [];
function offer(commands: PaletteCommand[]) {
  taken.push(registerPaletteCommands("test", commands));
}
// A lens, as the trip registers one: Go to › View › <label>.
const command = (label: string, run: () => void): PaletteCommand => ({ id: label, action: "Go to", type: "View", target: { label }, run });

// What the palette reads to tell a Mac (⌘K) from anything else (Ctrl+K).
// jsdom's own is "", so each test says which it is: a Mac unless it says not.
let platform = "MacIntel";
beforeEach(() => {
  platform = "MacIntel";
  vi.spyOn(navigator, "platform", "get").mockImplementation(() => platform);
  signedIn = true;
  aiEntitled = null;
  entitlementAsked.mockReset();
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
    await userEvent.keyboard("calendar{Enter}");
    await waitFor(() => expect(calendar).toHaveBeenCalledTimes(1));
    expect(seen).toEqual([true]);
  });

  // Go to › View, then its children: Plan, Calendar.
  it("moves down the list with the arrow keys", async () => {
    const plan = vi.fn();
    const calendar = vi.fn();
    offer([command("Plan", plan), command("Calendar", calendar)]);
    render(<CommandPalette />);
    await userEvent.keyboard("{Meta>}k{/Meta}go view{ArrowDown}{ArrowDown}{Enter}");
    await waitFor(() => expect(calendar).toHaveBeenCalledTimes(1));
    expect(plan).not.toHaveBeenCalled();
  });

  // Where no assistant is mounted, unmatched text still goes nowhere.
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

  // M46: `open` is the whole panel now, Chat included, and from Chat *Ask*
  // still has a tab to switch to.
  it("offers the assistant while the panel is up on Chat", async () => {
    const onOpen = vi.fn();
    taken.push(registerPhoneAsk({ open: true, chatShown: true, onOpen }));
    render(<CommandPalette />);
    await userEvent.keyboard("{Meta>}k{/Meta}ask{Enter}");
    await waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1));
  });

  // PR 436's preview walk: the tab bar reopens the tab last open, but ⌘K's
  // Ask names its tab, so it never lands on Chat.
  it("opens the assistant on Ask, not by the tab bar's reopen", async () => {
    const onOpen = vi.fn();
    const onResume = vi.fn();
    taken.push(registerPhoneAsk({ open: false, onOpen, onResume }));
    render(<CommandPalette />);
    await userEvent.keyboard("{Meta>}k{/Meta}ask{Enter}");
    await waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1));
    expect(onResume).not.toHaveBeenCalled();
  });

  // M45 D6, ADR-072 §7: where an assistant is mounted, text that matches
  // nothing is offered to it, and choosing the row sends it.
  it("offers Ask: <text> when nothing matches, and choosing it sends the text", async () => {
    const onAsk = vi.fn();
    taken.push(registerPhoneAsk({ open: false, onOpen: vi.fn(), onAsk }));
    render(<CommandPalette />);
    await userEvent.keyboard("{Meta>}k{/Meta}which city have I been to most");
    expect(await screen.findByRole("option", { name: "Ask: which city have I been to most" })).toBeTruthy();
    expect(screen.queryByText("No match")).toBeNull();
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(onAsk).toHaveBeenCalledWith("which city have I been to most"));
    expect(palette()).toBeNull();
  });

  // Mitchell, 2026-10-12: an account whose plan has no assistant is not
  // offered one here; its unmatched text says No match, as anywhere else.
  it("offers no Ask: row to an account whose plan has no assistant, and one to an account whose plan does", async () => {
    taken.push(registerPhoneAsk({ open: false, onOpen: vi.fn(), onAsk: vi.fn() }));
    aiEntitled = false;
    const { unmount } = render(<CommandPalette />);
    await userEvent.keyboard("{Meta>}k{/Meta}which city have I been to most");
    expect(await screen.findByText("No match")).toBeTruthy();
    expect(screen.queryByRole("option", { name: /^Ask:/ })).toBeNull();
    expect(entitlementAsked).toHaveBeenCalledWith("ai.ask");
    unmount();

    aiEntitled = true;
    render(<CommandPalette />);
    await userEvent.keyboard("{Meta>}k{/Meta}which city have I been to most");
    expect(await screen.findByRole("option", { name: "Ask: which city have I been to most" })).toBeTruthy();
  });

  it("offers no Ask: row while a command matches", async () => {
    taken.push(registerPhoneAsk({ open: false, onOpen: vi.fn(), onAsk: vi.fn() }));
    offer([command("Plan", vi.fn())]);
    render(<CommandPalette />);
    await userEvent.keyboard("{Meta>}k{/Meta}plan");
    await screen.findByRole("option", { name: /Plan/ });
    expect(screen.queryByRole("option", { name: /^Ask:/ })).toBeNull();
  });

  // A trip's name typed before the trips arrive matches nothing for a moment;
  // Enter then must not hand the name to the model.
  it("holds the Ask: row until this opening's trips have been read", async () => {
    let answer: (value: unknown) => void = () => {};
    fetchTrips.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    taken.push(registerPhoneAsk({ open: false, onOpen: vi.fn(), onAsk: vi.fn() }));
    render(<CommandPalette />);
    await userEvent.keyboard("{Meta>}k{/Meta}kyoto");
    expect(screen.queryByRole("option", { name: /^Ask:/ })).toBeNull();
    await act(async () => answer({ ok: true, value: [] }));
    expect(await screen.findByRole("option", { name: "Ask: kyoto" })).toBeTruthy();
  });

  // Registered as "places" so the assistant can run `go:trip:<id>` without
  // ⌘K ever being opened, but not on the first frame, where it competed with
  // the page's own requests.
  it("reads your trips on mount once the page is idle, not during it", async () => {
    render(<CommandPalette />);
    expect(fetchTrips).not.toHaveBeenCalled();
    await waitFor(() => expect(fetchTrips).toHaveBeenCalledTimes(1));
  });

  it("goes to one of your trips by name", async () => {
    fetchTrips.mockResolvedValue({ ok: true, value: [{ tripId: "t1", name: "Kyoto in spring", status: "active" }] });
    render(<CommandPalette />);
    await userEvent.keyboard("{Meta>}k{/Meta}kyo");
    await screen.findByRole("option", { name: /Kyoto in spring/ });
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(push).toHaveBeenCalledWith("/trips/t1"));
  });

  // ADR-069 §5: trips in the order Home lists them, where the API's (newest
  // first) would put an undated trip over the one coming up.
  it("lists your trips as Home does, the next one first", async () => {
    fetchTrips.mockResolvedValue({
      ok: true,
      value: [
        { tripId: "t1", name: "Lisbon someday", status: "active", startDate: null, endDate: null },
        { tripId: "t2", name: "Lima soon", status: "active", startDate: "2999-01-01", endDate: "2999-01-05" },
      ],
    });
    render(<CommandPalette />);
    await userEvent.keyboard("{Meta>}k{/Meta}go li");
    await screen.findByRole("option", { name: /Lisbon/ });
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Go to › Trip › Lima soon", "Go to › Trip › Lisbon someday"]);
  });

  // PR 398 review: a list kept from the last opening offers a trip deleted
  // since, until this opening's read lands, and for good if it fails.
  it("shows none of the last opening's trips before this opening's arrive", async () => {
    fetchTrips.mockResolvedValue({ ok: true, value: [{ tripId: "t1", name: "Kyoto in spring", status: "active" }] });
    render(<CommandPalette />);
    await userEvent.keyboard("{Meta>}k{/Meta}kyo");
    await screen.findByRole("option", { name: /Kyoto in spring/ });
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(palette()).toBeNull());

    fetchTrips.mockResolvedValue({ ok: false, error: { code: "network" } });
    await userEvent.keyboard("{Meta>}k{/Meta}kyo");
    expect(palette()).toBeTruthy();
    // On each opening. The mount read waits for idle, and an opening first
    // stands in for it.
    await waitFor(() => expect(fetchTrips).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("option", { name: /Kyoto in spring/ })).toBeNull();
  });

  // M45 D4: Notebook is a Type, in the vocabulary's place among the others
  // (ADR-069: the closed sets never move), and "notebook" finds both its actions.
  it("lists Notebook among the types in its place, and finds its commands by it", async () => {
    signedIn = false;
    const toggle = vi.fn();
    offer([
      command("Map", vi.fn()),
      { id: "go:notebook:p1", action: "Go to", type: "Notebook", target: { key: "p1", label: "Packing" }, run: vi.fn() },
      { id: "notebook-editing", action: "Edit", type: "Notebook", target: { label: "Turn editing on" }, run: toggle },
    ]);
    render(<CommandPalette />);
    await userEvent.keyboard("{Meta>}k{/Meta}{Enter}");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["View›", "Notebook›", "Page›"]);
    await userEvent.keyboard("{Escape}{Meta>}k{/Meta}notebook");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Go to › Notebook›", "Go to › Notebook › Packing", "Edit › Notebook›"]);
    await userEvent.keyboard("{Escape}{Meta>}k{/Meta}editing on{Enter}");
    await waitFor(() => expect(toggle).toHaveBeenCalledTimes(1));
  });

  // ADR-072 §6: a command only the assistant names by id is not a row.
  it("lists no unlisted command", async () => {
    signedIn = false;
    offer([{ id: "hidden", action: "Go to", type: "View", target: { label: "Hidden" }, unlisted: true, run: vi.fn() }]);
    render(<CommandPalette />);
    await userEvent.keyboard("{Meta>}k{/Meta}hidden");
    expect(screen.queryAllByRole("option")).toEqual([]);
  });

  // PR 398 review: the list can shrink under the highlight while it is open.
  it("keeps the highlight on the list when the list shrinks under it", async () => {
    signedIn = false;
    offer([command("Alpha", vi.fn()), command("Beta", vi.fn())]);
    render(<CommandPalette />);
    // Go to › View, then its children Alpha and Beta, under one heading.
    await userEvent.keyboard("{Meta>}k{/Meta}go view{ArrowDown}{ArrowDown}");
    expect(screen.getByRole("option", { selected: true }).textContent).toBe("Go to › View › Beta");

    const alpha = vi.fn();
    act(() => offer([command("Alpha", alpha)]));
    const box = screen.getByRole("combobox", { name: "Go to or do" });
    expect(screen.getByRole("option", { selected: true }).id).toBe(box.getAttribute("aria-activedescendant"));
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(alpha).toHaveBeenCalledTimes(1));
  });

  it("offers a reader with no account only what is open to them", async () => {
    signedIn = false;
    render(<CommandPalette />);
    await userEvent.keyboard("{Meta>}k{/Meta}{Enter}{Enter}");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Playbooks"]);
    expect(fetchTrips).not.toHaveBeenCalled();
  });

  // ADR-069 §2.
  describe("drilling in", () => {
    const leaves = () => {
      const ramenToDay3 = vi.fn();
      offer([
        { id: "rm", action: "Remove", type: "Stop", target: { label: "Ramen" }, run: vi.fn() },
        { id: "m3", action: "Move", type: "Stop", target: { label: "Ramen" }, destination: { label: "Day 3" }, run: ramenToDay3 },
        { id: "mu", action: "Move", type: "Stop", target: { label: "Ramen" }, destination: { label: "Unscheduled" }, run: vi.fn() },
        { id: "undo", action: "Undo", run: vi.fn() },
      ]);
      return { ramenToDay3 };
    };
    const optionNames = () => screen.getAllByRole("option").map((o) => o.textContent);
    const box = () => screen.getByRole("combobox", { name: "Go to or do" });

    it("lists only the actions when nothing is typed", async () => {
      signedIn = false;
      leaves();
      render(<CommandPalette />);
      await userEvent.keyboard("{Meta>}k{/Meta}");
      expect(optionNames()).toEqual(["Go to›", "Move›", "Remove›", "Undo"]);
    });

    it("opens a branch on Enter, shows the path, and runs a leaf at the end of it", async () => {
      signedIn = false;
      const { ramenToDay3 } = leaves();
      render(<CommandPalette />);
      await userEvent.keyboard("{Meta>}k{/Meta}{ArrowDown}{Enter}");
      expect(screen.getByTestId("palette-path").textContent).toBe("Move ›");
      expect(optionNames()).toEqual(["Stop›"]);
      await userEvent.keyboard("{Enter}{Enter}");
      expect(screen.getByTestId("palette-path").textContent).toBe("Move › Stop › Ramen ›");
      expect(optionNames()).toEqual(["Day 3", "Unscheduled"]);
      await userEvent.keyboard("{Enter}");
      await waitFor(() => expect(ramenToDay3).toHaveBeenCalledTimes(1));
    });

    it("opens a branch on Tab too", async () => {
      signedIn = false;
      leaves();
      render(<CommandPalette />);
      await userEvent.keyboard("{Meta>}k{/Meta}{ArrowDown}{Tab}");
      expect(screen.getByTestId("palette-path").textContent).toBe("Move ›");
    });

    it("climbs back out one level on Backspace in an empty box, and only then", async () => {
      signedIn = false;
      leaves();
      render(<CommandPalette />);
      await userEvent.keyboard("{Meta>}k{/Meta}{ArrowDown}{Enter}{Enter}");
      expect(screen.getByTestId("palette-path").textContent).toBe("Move › Stop ›");
      await userEvent.keyboard("x{Backspace}");
      expect(screen.getByTestId("palette-path").textContent).toBe("Move › Stop ›");
      await userEvent.keyboard("{Backspace}");
      expect(screen.getByTestId("palette-path").textContent).toBe("Move ›");
      await userEvent.keyboard("{Backspace}");
      expect(screen.queryByTestId("palette-path")).toBeNull();
      expect(box()).toBeTruthy();
    });

    // A leaf and a branch both end on Ramen; opening the branch sets the whole trail.
    it("searches every node from the top, under each action's heading", async () => {
      signedIn = false;
      const { ramenToDay3 } = leaves();
      render(<CommandPalette />);
      await userEvent.keyboard("{Meta>}k{/Meta}ramen");
      expect(within(screen.getByRole("group", { name: "Remove" })).getAllByRole("option").map((o) => o.textContent)).toEqual(["Remove › Stop › Ramen"]);
      expect(within(screen.getByRole("group", { name: "Move" })).getAllByRole("option").map((o) => o.textContent)).toEqual(["Move › Stop › Ramen›"]);
      await userEvent.keyboard("{ArrowDown}{Enter}");
      expect(screen.getByTestId("palette-path").textContent).toBe("Move › Stop › Ramen ›");
      await userEvent.keyboard("{Enter}");
      await waitFor(() => expect(ramenToDay3).toHaveBeenCalledTimes(1));
    });

    // The group's name comes from `aria-labelledby`, a space-separated list of
    // ids: a heading with a space in it ("Go to") must not become two ids.
    it("names a group whose heading has a space in it", async () => {
      signedIn = false;
      leaves();
      offer([{ id: "go-ramen", action: "Go to", type: "Stop", target: { label: "Ramen" }, run: vi.fn() }]);
      render(<CommandPalette />);
      await userEvent.keyboard("{Meta>}k{/Meta}ramen");
      expect(within(screen.getByRole("group", { name: "Go to" })).getAllByRole("option").map((o) => o.textContent)).toEqual(["Go to › Stop › Ramen"]);
    });

    // Mitchell, PR 398: typing the action shows its options, not its leaves.
    it("lists a top branch's children under it, and opens one with Enter", async () => {
      signedIn = false;
      leaves();
      render(<CommandPalette />);
      await userEvent.keyboard("{Meta>}k{/Meta}move");
      expect(optionNames()).toEqual(["Move›", "Move › Stop›", "Remove›"]);
      expect(screen.queryByTestId("palette-path")).toBeNull();
      await userEvent.keyboard("{ArrowDown}{Enter}");
      expect(screen.getByTestId("palette-path").textContent).toBe("Move › Stop ›");
    });

    it("searches only under the branch it is in", async () => {
      signedIn = false;
      leaves();
      render(<CommandPalette />);
      await userEvent.keyboard("{Meta>}k{/Meta}{ArrowDown}{Enter}ramen");
      expect(optionNames()).toEqual(["Stop › Ramen›", "Stop › Ramen › Day 3", "Stop › Ramen › Unscheduled"]);
    });

    // The focused day's commands go when focus does, while the palette is open on them.
    it("stands at the nearest level still there when the one it is in empties", async () => {
      signedIn = false;
      leaves();
      render(<CommandPalette />);
      await userEvent.keyboard("{Meta>}k{/Meta}{ArrowDown}{Enter}{Enter}");
      act(() => offer([{ id: "undo", action: "Undo", run: vi.fn() }]));
      expect(screen.queryByTestId("palette-path")).toBeNull();
      expect(optionNames()).toEqual(["Go to›", "Undo"]);
    });
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
