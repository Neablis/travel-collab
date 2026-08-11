import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Same URLSearchParams-as-store mock pattern as TripBoardScreen.test.tsx —
// this component reads/writes lens+view through LensRouter's router.replace.
let search = new URLSearchParams("");
const replaceSpy = vi.fn((url: string) => {
  search = new URLSearchParams(url.split("?")[1] ?? "");
});
vi.mock("next/navigation", () => ({
  useSearchParams: () => search,
  usePathname: () => "/trips/x",
  useRouter: () => ({ replace: replaceSpy }),
}));

import { LensRouter } from "./context/LensRouter";
import { TripViewTabs } from "./TripViewTabs";

beforeEach(() => {
  search = new URLSearchParams("");
  replaceSpy.mockClear();
});
afterEach(cleanup);

function renderTabs() {
  return render(
    <LensRouter>
      <TripViewTabs />
    </LensRouter>,
  );
}

describe("TripViewTabs", () => {
  it("shows exactly 3 primary tabs, Day columns selected by default (LensRouter's own default lens, unchanged)", () => {
    renderTabs();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Timeline", "Day columns", "Calendar"]);
    expect(screen.getByRole("tab", { name: "Day columns" }).getAttribute("aria-selected")).toBe("true");
  });

  it("selects Timeline when lens=Schedule&view=Timeline", () => {
    search = new URLSearchParams("lens=Schedule&view=Timeline");
    renderTabs();
    expect(screen.getByRole("tab", { name: "Timeline" }).getAttribute("aria-selected")).toBe("true");
  });

  it("clicking Day columns sets lens=Board", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("tab", { name: "Day columns" }));
    expect(replaceSpy).toHaveBeenCalledWith(expect.stringContaining("lens=Board"), { scroll: false });
  });

  it("clicking Calendar sets lens=Schedule&view=Calendar", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("tab", { name: "Calendar" }));
    expect(replaceSpy).toHaveBeenCalledWith(expect.stringContaining("view=Calendar"), { scroll: false });
  });

  it("none of the 3 primary tabs is selected while on a More-menu lens", () => {
    search = new URLSearchParams("lens=Map");
    renderTabs();
    for (const tab of screen.getAllByRole("tab")) {
      expect(tab.getAttribute("aria-selected")).toBe("false");
    }
    expect(screen.getByRole("button", { name: /More views \(currently Map\)/ }).textContent).toBe("Map");
  });

  it("opens the More menu and selects Itinerary", async () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "More views" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Itinerary" }));
    expect(replaceSpy).toHaveBeenCalledWith(expect.stringContaining("lens=Itinerary"), { scroll: false });
  });

  it("lists all 4 non-primary lenses in the More menu", async () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "More views" }));
    const items = await screen.findAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual(["Map", "Itinerary", "Daily overview", "Full trip"]);
  });
});
