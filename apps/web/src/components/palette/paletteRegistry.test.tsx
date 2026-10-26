import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook, waitFor } from "@testing-library/react";
import { stripComments } from "@/test-support/stripComments";
import { CommandPalette } from "./CommandPalette";
import { PAGE_SOURCES, findPaletteCommand, registerPaletteCommands, runPaletteCommand, usePaletteAwaits, usePaletteSource } from "./paletteRegistry";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => "/" }));
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

// M54 part 4: each screen that registers commands is waited for on its own
// route, by the source name it registers under, and a route with none is not.
describe("waiting for the page's commands", () => {
  it.each([
    ["/home", PAGE_SOURCES.home],
    ["/trips/t1", PAGE_SOURCES.tripBoard],
    ["/trips/t1/pages/p1", PAGE_SOURCES.notebook],
  ])("waits on %s until %s registers", (pathname, source) => {
    const { result } = renderHook(() => usePaletteAwaits(pathname));
    expect(result.current).toBe(true);
    act(() => {
      taken.push(registerPaletteCommands(source, []));
    });
    expect(result.current).toBe(false);
  });

  it("waits for nothing on a page that registers none", () => {
    const { result } = renderHook(() => usePaletteAwaits("/plans"));
    expect(result.current).toBe(false);
  });

  // PR 601 review: an empty list ended the wait before the page's data read
  // had landed, so the board and the notebook offer nothing until it has.
  it("still waits for a screen that has not read its data, and stops once it has", () => {
    const { result: awaits } = renderHook(() => usePaletteAwaits("/trips/t1/pages/p1"));
    const { rerender, unmount } = renderHook(({ ready }) => usePaletteSource(PAGE_SOURCES.notebook, ready ? [] : null), { initialProps: { ready: false } });
    expect(awaits.current).toBe(true);
    rerender({ ready: true });
    expect(awaits.current).toBe(false);
    unmount();
  });

  // PR 601 review: a screen registering under a name the route table does not
  // hold is never waited for, and the palette's Enter falls on No match again.
  it("holds every screen to a waited-for source, the shell's own aside", () => {
    const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const files = (function sourceFiles(dir: string): string[] {
      return readdirSync(dir).flatMap((name) => {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) return sourceFiles(full);
        return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
      });
    })(SRC);
    const callers = files.flatMap((file) => {
      const text = readFileSync(file, "utf8");
      // Comments stripped only where there is a call to find: it is slow.
      if (!text.includes("usePaletteSource(")) return [];
      return [...stripComments(text, file).matchAll(/(?<!function )\busePaletteSource\(\s*([^,]+),/g)].map((match) => ({ file: path.basename(file), source: match[1]!.trim() }));
    });
    // A sweep that found nothing would pass.
    expect(callers.map((caller) => caller.file)).toEqual(expect.arrayContaining(["HomeScreen.tsx", "TripBoardScreen.tsx", "PageScreen.tsx"]));
    // The palette's own places and TripHeader's, which are no route's screen.
    const shell = new Set(['"places"', '"trip-header"']);
    expect(callers.filter((caller) => !/^PAGE_SOURCES\.\w+$/.test(caller.source) && !shell.has(caller.source))).toEqual([]);
  });
});
