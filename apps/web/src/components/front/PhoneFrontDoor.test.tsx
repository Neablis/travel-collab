import { cleanup, render, screen, within, fireEvent } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { PhoneFrontDoor } from "./PhoneFrontDoor";

afterEach(cleanup);

/** The four claim panes, in document order, with their current opacity. */
function opacities(): number[] {
  return screen.getAllByTestId("front-door-claim").map((el) => Number(el.style.opacity));
}

/**
 * Drives the pinned block to a fraction of its scroll.
 *
 * jsdom reports every `offsetHeight`/`clientHeight` as 0, so the component's
 * own `usable` would be 1 and any scrollTop would saturate the sequence. These
 * two properties are defined so the geometry is real — which is the only way a
 * test can distinguish "chunk 2 is showing" from "everything is showing".
 */
function scrollTo(fraction: number) {
  const scroller = screen.getByTestId("phone-front-door");
  const pin = screen.getByTestId("front-door-pin");
  Object.defineProperty(pin, "offsetHeight", { value: 3000, configurable: true });
  Object.defineProperty(scroller, "clientHeight", { value: 1000, configurable: true });
  scroller.scrollTop = fraction * 2000;
  fireEvent.scroll(scroller);
}

describe("the phone front door (SPEC §28)", () => {
  // §28's second note, and the one that produces the worst-looking bug: *"The
  // rest state must be **authored into the markup** (first chunk visible, the
  // rest at zero) or a cold load stacks all four."*
  //
  // **Asserted against the SERVER render, and it has to be.** The first version
  // of this test rendered normally and checked the opacities — and passed with
  // the authored `style` deleted, because the mount effect paints them a tick
  // later and jsdom never shows the frame in between. That frame is the whole
  // bug: Next ships the server's HTML, the browser paints it, and only then
  // does hydration run the effect. If the markup does not carry the rest state,
  // all four claims are stacked on top of each other for that paint.
  //
  // `renderToStaticMarkup` runs no effects, which is exactly the state the
  // trap lives in.
  it("carries the rest state in the server-rendered markup, before any effect runs", () => {
    const html = renderToStaticMarkup(<PhoneFrontDoor />);
    const claimStyles = [...html.matchAll(/data-testid="front-door-claim"[^>]*style="([^"]*)"/g)].map((m) => m[1]!);
    expect(claimStyles).toHaveLength(4);
    expect(claimStyles[0]).toContain("opacity:1");
    for (const style of claimStyles.slice(1)) expect(style).toContain("opacity:0");
  });

  it("also paints the rest state on mount, so a client-only render is not stacked either", () => {
    render(<PhoneFrontDoor />);
    expect(opacities()).toEqual([1, 0, 0, 0]);
  });

  // §28's first note: *"Progress is **scroll position inside the pinned
  // block**, not time — you can stop on one."* Stopping a third of the way in
  // puts a later claim up and the first one away, and it STAYS there, because
  // nothing here is on a timer.
  it("advances the sequence by scroll position, and holds wherever it stops", () => {
    render(<PhoneFrontDoor />);
    scrollTo(0.4);
    const stopped = opacities();
    expect(stopped[0]).toBeLessThan(1);
    expect(stopped[1]! + stopped[2]!).toBeGreaterThan(0);

    // No timers, no rAF: nothing advances on its own. Re-reading without a
    // scroll must give the identical frame.
    expect(opacities()).toEqual(stopped);
  });

  // §28: *"then the map clears out and the call to action arrives on empty
  // paper."* The stage clears as ONE — the map and whatever claim is still on
  // it go together — so the pin never releases onto a line of type floating
  // over a background that has already gone.
  it("clears the map and the last claim together at the end of the pin", () => {
    render(<PhoneFrontDoor />);
    scrollTo(1);
    const map = screen.getByTestId("front-door-map");
    expect(Number(map.style.opacity)).toBe(0);
    expect(opacities().every((o) => o === 0)).toBe(true);
  });

  // The five things Mitchell reported missing on the 2026-09-12 preview, each
  // pinned by the thing he asked for rather than by a class name.
  describe("what the first build of this screen left out", () => {
    // *"Missing the top of page signing CTA"*. There was no header at all, so a
    // returning visitor on a phone had no way into their own account.
    it("offers a way in for somebody who already has an account", () => {
      render(<PhoneFrontDoor />);
      const signIn = within(screen.getByTestId("phone-front-door")).getByRole("link", { name: "Sign in" });
      expect(signIn.getAttribute("href")).toBe("/signin");
      // SPEC §13.1's 44px floor, taken from the size variant rather than
      // hand-written — asserted because a header control that is hard to hit on
      // a phone is the same defect as one that is missing.
      expect(signIn.className).toContain("min-h-11");
    });

    // *"Is also awkward wording ... and missing the graphic"*, twice, and
    // *"missing the example. Attached example of what it should look like"*.
    // Three of the four claims carry a card in the design and none of them did
    // in the build.
    it("draws the example under every claim that has one", () => {
      render(<PhoneFrontDoor />);
      const claims = screen.getAllByTestId("front-door-claim");
      // Together: three stops and the change somebody else made.
      expect(within(claims[1]!).getByText("Fushimi Inari, early")).toBeTruthy();
      expect(within(claims[1]!).getByText(/Priya moved this an hour later/)).toBeTruthy();
      // Notebook: a sentence with a value in it, over the costs that value is
      // the total of.
      expect(within(claims[2]!).getByText("$596")).toBeTruthy();
      expect(within(claims[2]!).getByText("Ryokan · Hakone")).toBeTruthy();
      // Playbooks: somebody else's day, and what happens when you take it.
      expect(within(claims[3]!).getByText("A beach day in Phuket")).toBeTruthy();
      expect(within(claims[3]!).getByText(/Dropping in as Day 2/)).toBeTruthy();
    });

    // The half of "awkward wording" that was a BUILD defect rather than a copy
    // preference: the `Together` claim ran the design's headline and its card's
    // caption together into one sentence, because the card was not built.
    it("keeps the Together headline to the headline", () => {
      render(<PhoneFrontDoor />);
      const claims = screen.getAllByTestId("front-door-claim");
      expect(within(claims[1]!).getByText("Everyone moves the same day.")).toBeTruthy();
    });

    // *"The mobile homepage styling is missing the background box with
    // gradiant"*. The plate is what keeps a claim legible while the map moves
    // under it; the veil is what stops the map reading as a flat block behind
    // the type. Both are one-off gradients in `globals.css` (the colour wall
    // refuses arbitrary Tailwind values), so the class IS the handle here —
    // there is no role or label standing in for "this has a background".
    it("puts every claim on its plate, and the map under its veil", () => {
      const html = renderToStaticMarkup(<PhoneFrontDoor />);
      expect([...html.matchAll(/front-door-plate/g)]).toHaveLength(4);
      expect(html).toContain("front-door-veil");
    });
  });

  it("puts the call to action on the paper after the pin, not over the map", () => {
    render(<PhoneFrontDoor />);
    const cta = within(screen.getByTestId("phone-front-door"));
    expect(cta.getByRole("link", { name: "Continue with Google" }).getAttribute("href")).toBe("/signup");
    expect(cta.getByRole("link", { name: "Look around a real trip" }).getAttribute("href")).toBe("/demo");
  });
});
