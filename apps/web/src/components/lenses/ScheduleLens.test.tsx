import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// LensRouter derives lens/view from the URL via next/navigation — mock it the
// same way trip/context/context.test.tsx and board/TripBoardScreen.test.tsx do.
let search = new URLSearchParams("");
vi.mock("next/navigation", () => ({
  useSearchParams: () => search,
  usePathname: () => "/trips/x",
  useRouter: () => ({ replace: vi.fn() }),
}));

import { LensRouter } from "../trip/context/LensRouter";
import { EditorHost } from "../trip/context/EditorHost";
import { FocusProvider } from "../trip/context/FocusProvider";
import { ScheduleLens } from "./ScheduleLens";
import { tripDetailFixture } from "@tc/factories";

// The Timeline/Calendar switch moved out of this component (it used to own a
// SegmentedControl of its own) to TripViewTabs.tsx, which now drives the same
// `view` URL param as a top-level tab per the design handoff's 3-tab strip
// (#M10 redesign-feedback follow-up). This just confirms ScheduleLens still
// renders the right view for whatever `view` is current, with no nav control
// left to render itself.
describe("ScheduleLens", () => {
  it("renders TimelineLens when view=Timeline (the default)", () => {
    search = new URLSearchParams("");
    const detail = tripDetailFixture();
    render(
      <FocusProvider>
        <EditorHost>
          <LensRouter>
            <ScheduleLens detail={detail} />
          </LensRouter>
        </EditorHost>
      </FocusProvider>,
    );
    expect(screen.getByTestId("schedule-lens")).toBeTruthy();
    expect(screen.queryByRole("radiogroup", { name: "Schedule view" })).toBeNull();
  });

  it("renders CalendarLens when view=Calendar", () => {
    search = new URLSearchParams("view=Calendar");
    // CalendarLens shows a "Set a start date" status instead of the grid
    // unless there's both a startDate and at least one dated day.
    const detail = tripDetailFixture({
      startDate: "2027-06-01",
      days: [{ dayId: "d1", activityIds: [], date: "2027-06-01", costSubtotal: 0 }],
    });
    render(
      <FocusProvider>
        <EditorHost>
          <LensRouter>
            <ScheduleLens detail={detail} />
          </LensRouter>
        </EditorHost>
      </FocusProvider>,
    );
    // CalendarLens renders a 7-column grid of day cells, not TimelineLens's
    // day-header blocks — a data-testid on either lens would be more direct,
    // but neither exposes one, so this checks CalendarLens's grid role
    // instead of re-deriving TimelineLens/CalendarLens's own render tests.
    expect(screen.getByRole("grid")).toBeTruthy();
  });
});
