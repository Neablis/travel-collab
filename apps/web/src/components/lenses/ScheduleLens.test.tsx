import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

// LensRouter derives lens/view from the URL via next/navigation — mock it the
// same way trip/context/context.test.tsx and board/TripBoardScreen.test.tsx do.
let search = new URLSearchParams("");
const replaceSpy = vi.fn((url: string) => {
  search = new URLSearchParams(url.split("?")[1] ?? "");
});
vi.mock("next/navigation", () => ({
  useSearchParams: () => search,
  usePathname: () => "/trips/x",
  useRouter: () => ({ replace: replaceSpy }),
}));

import { LensRouter } from "../trip/context/LensRouter";
import { EditorHost } from "../trip/context/EditorHost";
import { ScheduleLens } from "./ScheduleLens";
import { tripDetailFixture } from "../../mocks/fixtures";

beforeEach(() => {
  search = new URLSearchParams("");
  replaceSpy.mockClear();
});

describe("ScheduleLens Timeline/Calendar switch (#27)", () => {
  it("renders the subtle-variant switch (no nested moss tab strip) and still toggles views", async () => {
    const detail = tripDetailFixture();
    render(
      <EditorHost>
        <LensRouter>
          <ScheduleLens detail={detail} />
        </LensRouter>
      </EditorHost>,
    );

    const group = screen.getByRole("radiogroup", { name: "Schedule view" });
    expect(group.className).not.toContain("bg-moss");

    fireEvent.click(screen.getByRole("radio", { name: "Calendar" }));
    expect(replaceSpy).toHaveBeenCalledWith(expect.stringContaining("view=Calendar"), { scroll: false });
  });
});
