import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { CommandPalette } from "./CommandPalette";
import { findPaletteCommand, registerPaletteCommands, runPaletteCommand } from "./paletteRegistry";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/components/account/useSessionUser", () => ({
  useSessionUser: () => ({ userId: "u1", email: "a@example.com", name: "A" }),
}));
const fetchTrips = vi.fn();
vi.mock("@/lib/apiClient", () => ({ fetchTrips: () => fetchTrips() }));

const taken: Array<() => void> = [];
afterEach(() => {
  taken.splice(0).forEach((takeBack) => takeBack());
  push.mockReset();
  cleanup();
});

// ADR-072 §1: a command named by id runs the function its screen registered,
// the one ⌘K runs, and not a copy of it.
describe("running a palette command by id", () => {
  it("runs the registered command's own function, and nothing for an id no screen offers", () => {
    const toggle = vi.fn();
    taken.push(registerPaletteCommands("test", [{ id: "notebook-editing", action: "Edit", type: "Notebook", target: { label: "Turn editing on" }, run: toggle }]));

    expect(findPaletteCommand("notebook-editing")?.run).toBe(toggle);
    expect(runPaletteCommand("notebook-editing")).toBe(true);
    expect(toggle).toHaveBeenCalledTimes(1);

    expect(findPaletteCommand("go:notebook:gone")).toBeUndefined();
    expect(runPaletteCommand("go:notebook:gone")).toBe(false);
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  // The places and trips were built inside the palette's render, so nothing
  // outside it could find them, and only once it had been opened.
  it("finds your trips and the app's pages with the palette mounted and never opened", async () => {
    fetchTrips.mockResolvedValue({ ok: true, value: [{ tripId: "t1", name: "Kyoto in spring", status: "active" }] });
    render(<CommandPalette />);

    await waitFor(() => expect(findPaletteCommand("go:trip:t1")).toBeDefined());
    expect(runPaletteCommand("go:trip:t1")).toBe(true);
    expect(push).toHaveBeenLastCalledWith("/trips/t1");
    expect(runPaletteCommand("go:home")).toBe(true);
    expect(push).toHaveBeenLastCalledWith("/home");
  });

  // ADR-072 §6: one command for "open my Kyoto trip on the map", by the
  // `?view=` the trip page reads for every view.
  it("goes to a trip on a chosen view", async () => {
    fetchTrips.mockResolvedValue({ ok: true, value: [{ tripId: "t1", name: "Kyoto in spring", status: "active" }] });
    render(<CommandPalette />);

    await waitFor(() => expect(runPaletteCommand("go:trip:t1:view:Map")).toBe(true));
    expect(push).toHaveBeenLastCalledWith("/trips/t1?view=Map");
  });
});
