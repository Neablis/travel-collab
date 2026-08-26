import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SaveLightMark, SaveLightProvider, usePublishSaveState, type SaveState } from "./SaveLight";

afterEach(cleanup);

// Ported from SyncIndicator.test.tsx, which this replaces: SPEC "The logo is
// the save light" removed the trip header's own dot and gave the job to the
// logo mark. The states and their accessible names are unchanged — what moved
// is where they render and how the state gets there (published up from
// TripProvider rather than passed down as props).
const failure = { at: "2026-08-25T12:00:00.000Z", message: "Server rejected AddDay" };

function Publisher({ sync }: { sync: SaveState }) {
  usePublishSaveState(sync);
  return null;
}

function renderLight(sync: SaveState | null, opts: { publisherMounted?: boolean } = {}) {
  const mounted = opts.publisherMounted ?? true;
  return render(
    <SaveLightProvider>
      <SaveLightMark />
      {sync && mounted ? <Publisher sync={sync} /> : null}
    </SaveLightProvider>,
  );
}

describe("SaveLightMark", () => {
  it("rests as a link home, with nothing to announce but 'All changes saved'", () => {
    renderLight(null);

    expect(screen.getByRole("link", { name: /Caesura/ }).getAttribute("href")).toBe("/");
    expect(screen.getByRole("status").textContent).toBe("All changes saved");
  });

  it("breathes while there is unsent work, and does not become a spinner", () => {
    const { container } = renderLight({ unsent: 2, failure: null, retry: () => {} });

    expect(screen.getByRole("status").textContent).toBe("Saving…");
    expect(container.querySelectorAll(".save-light-breathing")).toHaveLength(1);
    // Still the logo, still a link home — SPEC: "One mark, two jobs."
    expect(screen.getByRole("link", { name: /Caesura/ })).toBeTruthy();
  });

  describe("when the queue has failed", () => {
    it("turns danger and names the count the mark has no room to draw", () => {
      const { container } = renderLight({ unsent: 3, failure, retry: () => {} });

      expect(screen.getByRole("status").textContent).toBe("Couldn't save — 3 changes not sent");
      expect(container.querySelector(".bg-danger")).toBeTruthy();
      expect(container.querySelector(".bg-brand")).toBeNull();
    });

    it("counts one change in the singular", () => {
      renderLight({ unsent: 1, failure, retry: () => {} });
      expect(screen.getByRole("status").textContent).toBe("Couldn't save — 1 change not sent");
    });

    // The deliberate deviation from SPEC, which colours the failure but gives
    // no way out of it. RULES.md 6 asks every screen to recover from the
    // worst, and the queue only ever retries when asked (KI-36) — so the mark
    // itself becomes the retry control rather than the affordance vanishing
    // with the indicator it used to live on.
    it("makes the mark a retry button, so unsent work is never a dead end", async () => {
      const retry = vi.fn();
      renderLight({ unsent: 2, failure, retry });

      const button = screen.getByRole("button", { name: "Retry saving 2 changes" });
      await userEvent.click(button);
      expect(retry).toHaveBeenCalledTimes(1);
      // It is a button *instead of* the link home, not as well — one mark.
      expect(screen.queryByRole("link", { name: /Caesura/ })).toBeNull();
    });

    it("suppresses the breathing — a failed queue is not in flight", () => {
      const { container } = renderLight({ unsent: 2, failure, retry: () => {} });
      expect(container.querySelectorAll(".save-light-breathing")).toHaveLength(0);
      expect(screen.getByRole("status").textContent).not.toMatch(/saving…/i);
    });

    it("stays a polite role=status region rather than flipping to role=alert", () => {
      // Deliberate, carried over: the page already raises the server's
      // rejection in its own role="alert" (TripBoardScreen), and a live
      // region's role is registered at mount, so swapping it mid-life is
      // unreliable in assistive tech.
      renderLight({ unsent: 1, failure, retry: () => {} });
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.getByRole("status")).toBeTruthy();
    });

    it("does not render a timestamp it cannot keep honest", () => {
      // `failure.at` is real and is exposed on the trip context, but a
      // relative "(since …)" needs a ticking clock this has not got.
      renderLight({ unsent: 1, failure, retry: () => {} });
      expect(screen.getByRole("status").textContent).not.toContain("2026");
      expect(screen.getByRole("status").textContent).not.toMatch(/ago|since/i);
    });
  });

  // The failure mode this whole indirection has that a prop did not: the
  // light outlives the trip that wrote to it, so leaving a trip has to hand
  // it back. Without the cleanup, the header would still be announcing the
  // last trip's unsent work on the trips list.
  it("returns to rest when the publishing trip unmounts", () => {
    const sync = { unsent: 2, failure: null, retry: () => {} };
    const { rerender } = render(
      <SaveLightProvider>
        <SaveLightMark />
        <Publisher sync={sync} />
      </SaveLightProvider>,
    );
    expect(screen.getByRole("status").textContent).toBe("Saving…");

    rerender(
      <SaveLightProvider>
        <SaveLightMark />
      </SaveLightProvider>,
    );
    expect(screen.getByRole("status").textContent).toBe("All changes saved");
  });

  // The cost this indirection could have had, pinned so a refactor can't
  // reintroduce it. Publishing sets state on a provider that sits ABOVE the
  // whole page, so the obvious worry is that every save re-renders (or worse,
  // remounts) the entire trip below it. It does neither: `children` reaches
  // the provider as an already-built element from the layout, and React bails
  // out of re-rendering a child whose element identity has not changed, so
  // only the context's real consumer — the mark — re-renders.
  //
  // What would break it: giving SaveLightProvider a prop that changes with the
  // light, or wrapping `children` in something the provider itself builds
  // during render. Either would make this count climb.
  it("does not re-render the page below it when the light changes", () => {
    let renders = 0;
    function PageBelow() {
      renders++;
      return <div />;
    }

    render(
      <SaveLightProvider>
        <SaveLightMark />
        <PageBelow />
        <Publisher sync={{ unsent: 3, failure: null, retry: () => {} }} />
      </SaveLightProvider>,
    );

    // The publish effect has already fired — the light is showing its result.
    expect(screen.getByRole("status").textContent).toBe("Saving…");
    expect(renders).toBe(1);
  });

  it("rests rather than throwing when rendered with no provider above it", () => {
    // AppHeader renders on every route; a page that forgets the provider
    // should lose the light, not the header.
    render(<SaveLightMark />);
    expect(screen.getByRole("status").textContent).toBe("All changes saved");
  });
});
