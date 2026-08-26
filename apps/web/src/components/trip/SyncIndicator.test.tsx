import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SyncIndicator } from "./SyncIndicator";

afterEach(cleanup);

// Contract note (task 8b.3, revised by KI-36): the third state ships. The
// `@ts-expect-error` assertion that used to live at the bottom of this file
// pinned `pending: boolean | number` so the prop could not quietly grow an
// error state without the decision being revisited — the decision has now
// been made (Mitchell, 2026-08-25: KI-36 Option 1), so the pin is removed and
// replaced by the tests below, which assert the real state instead of
// asserting its absence.
//
// The prop shape changed with it: `pending: boolean | number` became
// `unsent: number` + `failure`. A boolean cannot distinguish "saving" from
// "couldn't save", and the count has to be a real number because the
// accessible name states it.
const failure = { at: "2026-08-25T12:00:00.000Z", message: "Server rejected AddDay" };

describe("SyncIndicator", () => {
  it("labels the saving state with visible text, in the brand voice", () => {
    render(<SyncIndicator unsent={2} onRetry={() => {}} />);
    const status = screen.getByRole("status", { name: /saving/i });
    expect(status.textContent).toMatch(/saving/i);
  });

  it("keeps 'All changes saved' as the accessible name when the queue is drained, with no visible label text", () => {
    render(<SyncIndicator unsent={0} onRetry={() => {}} />);
    const status = screen.getByRole("status", { name: "All changes saved" });
    // The saved state draws a bare dot — no rendered text. The accessible
    // name (title/aria-label) is the only place a screen reader gets
    // confirmation, so this asserts it's carried on the element attributes,
    // not derived from content.
    expect(status.textContent).toBe("");
    expect(status.getAttribute("title")).toBe("All changes saved");
    expect(status.getAttribute("aria-label")).toBe("All changes saved");
  });

  describe("the failed state (KI-36)", () => {
    it("says 'Couldn't save' and NOT 'retrying' — retry is manual, so the design's copy would be false", () => {
      render(<SyncIndicator unsent={3} failure={failure} onRetry={() => {}} />);
      const status = screen.getByRole("status", { name: /couldn't save/i });
      expect(status.textContent).toContain("Couldn't save");
      // The handoff (dc.html:3106-3120) labels this state "Couldn't save —
      // retrying". Nothing retries on its own, so that word must not appear.
      expect(status.textContent).not.toMatch(/retrying/i);
    });

    it("states the real count of unsent changes in the accessible name, pluralised", () => {
      const { unmount } = render(<SyncIndicator unsent={3} failure={failure} onRetry={() => {}} />);
      expect(screen.getByRole("status").getAttribute("aria-label")).toBe("Couldn't save — 3 changes not sent");
      unmount();
      render(<SyncIndicator unsent={1} failure={failure} onRetry={() => {}} />);
      expect(screen.getByRole("status").getAttribute("aria-label")).toBe("Couldn't save — 1 change not sent");
    });

    it("offers a Retry control the user can actually activate, named for what it retries", () => {
      const onRetry = vi.fn();
      render(<SyncIndicator unsent={2} failure={failure} onRetry={onRetry} />);
      const retry = screen.getByRole("button", { name: "Retry saving 2 changes" });
      expect(retry.textContent).toBe("Retry");
      retry.click();
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it("suppresses the saving affordances — a failed queue is not in flight", () => {
      const { container } = render(<SyncIndicator unsent={2} failure={failure} onRetry={() => {}} />);
      // The pulsing haloes say "a send is happening right now". None is.
      expect(container.querySelectorAll(".sync-halo")).toHaveLength(0);
      expect(screen.getByRole("status").textContent).not.toMatch(/saving…/i);
    });

    it("stays a polite role=status region rather than flipping to role=alert", () => {
      // Deliberate: the page already raises the server's rejection in its own
      // role="alert" (TripBoardScreen), and a live region's role is registered
      // at mount, so swapping it mid-life is unreliable in assistive tech.
      render(<SyncIndicator unsent={1} failure={failure} onRetry={() => {}} />);
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.getByRole("status")).toBeTruthy();
    });

    it("does not render a timestamp it cannot keep honest", () => {
      // `failure.at` is real and is exposed on the trip context, but a
      // relative "(since …)" needs a ticking clock this component has not
      // got. It belongs to the (still descoped) sync-failure banner.
      render(<SyncIndicator unsent={1} failure={failure} onRetry={() => {}} />);
      expect(screen.getByRole("status").textContent).not.toContain("2026");
      expect(screen.getByRole("status").textContent).not.toMatch(/ago|since/i);
    });
  });
});
