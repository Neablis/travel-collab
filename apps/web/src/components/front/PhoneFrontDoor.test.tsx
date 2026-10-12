import { cleanup, render, screen, within, fireEvent } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { LANDING_FEATURES } from "@/lib/landingDemo";
import { PhoneFrontDoor } from "./PhoneFrontDoor";

// The three real cards are `lazy()`-loaded; loaded here first so a cold
// worker's transform does not outrun `findBy*` (`LandingHeroArt.test.tsx`).
beforeAll(async () => {
  await import("./LandingFeaturePanels");
});

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

  // **A claim nobody can see is a claim nobody should hear.** All four panes
  // are in the document at every scroll position and `opacity: 0` is a paint
  // property, not a presence one — so without `aria-hidden` a screen reader
  // read the whole sequence stacked on itself, four labels and four bodies,
  // wherever the page happened to be (CodeRabbit, PR 170).
  //
  // Asserted against what is PAINTED rather than against an index, so the two
  // cannot drift: whatever the effect made visible is exactly what is exposed.
  it("exposes only the claims that are actually on screen", () => {
    render(<PhoneFrontDoor />);
    const exposed = () =>
      screen.getAllByTestId("front-door-claim").map((el) => el.getAttribute("aria-hidden") !== "true");

    expect(exposed()).toEqual([true, false, false, false]);
    for (const p of [0.3, 0.5, 0.62, 0.9]) {
      scrollTo(p);
      expect(exposed(), `at p=${p}`).toEqual(opacities().map((o) => o > 0));
    }
  });

  // M42 part 9 put real links in the claims (the Discover card's), and the
  // claims are stacked: a faded one later in the document sat over the shown
  // one, took its taps, and kept its links in the tab order. Every claim the
  // sequence hides is `inert` as well as `aria-hidden`. jsdom models neither
  // focus nor hit-testing for it, so the attribute is held here and the
  // behaviour in `m42-demo-trips.spec.ts`.
  it("puts only the claims on screen within reach of a tap or a tab", () => {
    render(<PhoneFrontDoor />);
    const reachable = () => screen.getAllByTestId("front-door-claim").map((el) => !el.hasAttribute("inert"));

    expect(reachable()).toEqual([true, false, false, false]);
    for (const p of [0.3, 0.5, 0.62, 0.9]) {
      scrollTo(p);
      expect(reachable(), `at p=${p}`).toEqual(opacities().map((o) => o > 0));
    }
  });

  // And the markup carries it before any effect runs, for the same reason the
  // authored opacity has to: Next ships the server's HTML and hydration is a
  // tick later, so a page read in that gap would announce all four.
  it("carries the hidden state in the server-rendered markup too", () => {
    const html = renderToStaticMarkup(<PhoneFrontDoor />);
    const claims = [...html.matchAll(/data-testid="front-door-claim"([^>]*)>/g)].map((m) => m[1]!);
    expect(claims).toHaveLength(4);
    expect(claims[0]).not.toContain('aria-hidden="true"');
    expect(claims[0]).not.toContain("inert");
    for (const attrs of claims.slice(1)) {
      expect(attrs).toContain('aria-hidden="true"');
      expect(attrs).toContain('inert=""');
    }
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

  // **The stage is never blank between two claims**, which is half of what
  // Mitchell reported as *"there needs to be more time between the scroll
  // transitions between blocks, right now the last few are almost
  // unreadable"*. The other half is the length of the pin, which is geometry
  // this layer cannot see (`.front-door-pin` is 900dvh of CSS and jsdom reports
  // every height as 0 — `scrollTo` above fakes the two it needs).
  //
  // A claim used to finish fading out exactly where the next began fading in,
  // so at every segment boundary both were at zero. CodeRabbit found the same
  // thing as arithmetic — at `p = 0.25`, `0.5` and `0.75` neither neighbour was
  // rendered — and the existing sample at `0.4` sat comfortably inside a
  // segment where it could never have noticed.
  it("always has a claim on screen through every transition", () => {
    render(<PhoneFrontDoor />);
    // **A dense sweep rather than named boundaries.** The first version sampled
    // 0.25 / 0.5 / 0.75 and a hair either side, which was right when the four
    // claims divided the whole pin — and silently wrong the moment they were
    // re-spread over `[0, TAIL_START]` so the last one stopped being squeezed
    // by the clear-out. A test that knows the boundaries has to be edited every
    // time they move, and the edit is exactly what nobody remembers to do.
    //
    // Sweeping asserts the property instead: at no point in the whole sequence
    // is the stage blank or nearly so. It covers the boundaries wherever they
    // are, and the midpoints, and everything between.
    //
    // Stops at 0.9 rather than 1: past `TAIL_START` the stage is SUPPOSED to
    // clear, and asserting a lit claim there would be asserting the opposite of
    // §28's "then the map clears out".
    for (let p = 0; p <= 0.9; p += 0.01) {
      scrollTo(p);
      const lit = opacities().filter((o) => o > 0);
      expect(lit.length, `nothing is on screen at p=${p.toFixed(2)}`).toBeGreaterThan(0);
      // And it is READABLE, not a sliver: at a crossfade one of the two is
      // always fully in, and a crossfade whose peak is 0.2 is the same
      // complaint Mitchell filed in a different shape.
      expect(Math.max(...lit), `what is on screen at p=${p.toFixed(2)} is barely there`).toBeGreaterThan(0.5);
    }
  });

  // **Every claim gets the same share of the scroll**, which is the half of
  // *"the last chunk … doesn't last long enough"* that is arithmetic rather
  // than taste. The claims used to divide the WHOLE pin while the clear-out ate
  // the end of it, so the fourth one held at full strength for 0.07 of the
  // scroll against the first one's 0.25 — a quarter of the reading time, for
  // one claim in four.
  //
  // Measured as "how much scroll is this claim the brightest thing on screen
  // for", which is what a reader experiences, and compared between the first
  // and the last — the two the old arithmetic separated most.
  it("gives the last claim as much of the scroll as the first", () => {
    render(<PhoneFrontDoor />);
    const held = [0, 0, 0, 0];
    for (let p = 0; p <= 0.92; p += 0.005) {
      scrollTo(p);
      const os = opacities();
      const best = os.indexOf(Math.max(...os));
      // `?? 0` for `noUncheckedIndexedAccess`, not for doubt: `best` comes from
      // `indexOf` on the same array. Vitest transpiles without typechecking, so
      // this only failed at `next build` — which is the point of that step.
      held[best] = (held[best] ?? 0) + 1;
    }
    expect(held[0]).toBeGreaterThan(0);
    expect(held[3]).toBeGreaterThan(0);
    // Within a fifth of each other. Not exact: the first claim starts already
    // lit and the last runs into the clear-out, so the two ends are genuinely
    // shaped differently — what must not happen is one of them getting a
    // fraction of another's.
    //
    // Red-checked by dividing the pin instead of `TAIL_START`: `first claim
    // held for 51 samples, last for 33` — the fourth claim on two thirds of the
    // first one's scroll, which is what he was reading when he filed it.
    expect(
      Math.abs(held[3]! - held[0]!) / held[0]!,
      `first claim held for ${held[0]} samples, last for ${held[3]}`,
    ).toBeLessThan(0.2);
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
  // ADR-061: the playbook library is open without an account, so a phone
  // visitor can leave the front door for it (Mitchell, 2026-10-02).
  // axe at phone width on `/`: no `main` landmark, and the headline, claims
  // and call to action outside every landmark.
  it("holds its content in a main landmark, between the banner and the footer", () => {
    render(<PhoneFrontDoor />);
    const main = within(screen.getByTestId("phone-front-door")).getByRole("main");
    expect(within(main).getByRole("heading", { level: 1, name: "Put the best day on repeat." })).toBeTruthy();
    expect(within(main).getByRole("link", { name: "Start a trip" })).toBeTruthy();
  });

  // M42 D3. The desktop tree owns the `pricing` id — two elements cannot share
  // one — and comes second in the document, so a browser following
  // `/welcome#pricing` at phone width finds the hidden desktop section and
  // scrolls nowhere. The phone front door answers the hash itself, by
  // scrolling its own scroller and nothing else (see the effect's comment).
  describe("#pricing", () => {
    const scrolled: { el: Element; top: number | undefined }[] = [];
    beforeEach(() => {
      scrolled.length = 0;
      // jsdom implements no scrolling, so the call is recorded instead.
      Element.prototype.scrollTo = function (this: Element, options?: ScrollToOptions | number) {
        scrolled.push({ el: this, top: typeof options === "object" ? options.top : undefined });
      } as Element["scrollTo"];
    });
    afterEach(() => {
      window.history.replaceState(null, "", window.location.pathname);
      delete (Element.prototype as Partial<Element>).scrollTo;
    });

    it("scrolls its own scroller when the page is opened at #pricing", () => {
      window.history.replaceState(null, "", "#pricing");
      render(<PhoneFrontDoor />);
      expect(scrolled.map(({ el }) => el)).toEqual([screen.getByTestId("phone-front-door")]);
    });

    it("lands the section just under the sticky bar when the hash changes to #pricing", () => {
      render(<PhoneFrontDoor />);
      const door = screen.getByTestId("phone-front-door");
      const pricing = within(door).getByRole("region", { name: "Pricing" });
      // jsdom lays nothing out, so the geometry the effect reads is given here.
      door.scrollTop = 100;
      vi.spyOn(door, "getBoundingClientRect").mockReturnValue({ top: 0 } as DOMRect);
      vi.spyOn(pricing, "getBoundingClientRect").mockReturnValue({ top: 5000 } as DOMRect);
      Object.defineProperty(within(door).getByRole("banner"), "offsetHeight", { value: 64 });

      window.history.replaceState(null, "", "#pricing");
      fireEvent(window, new HashChangeEvent("hashchange"));

      expect(scrolled).toEqual([{ el: door, top: 100 + 5000 - 64 }]);
    });

    // Mitchell, 2026-10-11: the front door summarises the plans and leaves
    // the specifics to `/plans`. One line each, one way through to the rest —
    // and no second sign-up button, because "Start a trip" sits just above.
    it("summarises the plans and sends the specifics to /plans", () => {
      render(<PhoneFrontDoor />);
      const door = within(screen.getByTestId("phone-front-door"));
      const pricing = within(door.getByRole("region", { name: "Pricing" }));
      expect(pricing.queryByRole("table")).toBeNull();
      expect(pricing.getByText("Unlimited planned trips")).toBeTruthy();
      expect(pricing.getByText("AI tools to help plan the trip")).toBeTruthy();
      expect(pricing.getByText("Invite all your friends to come along")).toBeTruthy();
      expect(pricing.getByRole("link", { name: "Compare plans" }).getAttribute("href")).toBe("/signin?callbackUrl=%2Fplans");
      expect(door.queryByRole("link", { name: "Sign up" })).toBeNull();
    });
  });

  // Mitchell, 2026-10-11: the bar is clear over the map, where nothing sits
  // under it to read, and paper once the pin releases — after that, content
  // scrolls under it, and a clear bar shows that content through its links
  // and takes the taps aimed at it.
  it("puts the header on paper once the pin releases, and only then", () => {
    render(<PhoneFrontDoor />);
    const header = within(screen.getByTestId("phone-front-door")).getByRole("banner");
    expect(header.hasAttribute("data-solid")).toBe(false);
    scrollTo(0.97);
    expect(header.hasAttribute("data-solid")).toBe(false);
    scrollTo(1.2);
    expect(header.hasAttribute("data-solid")).toBe(true);
    scrollTo(0.5);
    expect(header.hasAttribute("data-solid")).toBe(false);
  });

  it("links the playbook library from the header", () => {
    render(<PhoneFrontDoor />);
    const playbooks = within(screen.getByTestId("phone-front-door")).getByRole("link", { name: "Playbooks" });
    expect(playbooks.getAttribute("href")).toBe("/playbooks");
  });

  describe("what the first build of this screen left out", () => {
    // *"Missing the top of page signing CTA"*. There was no header at all, so a
    // returning visitor on a phone had no way into their own account.
    it("offers a way in for somebody who already has an account", () => {
      render(<PhoneFrontDoor />);
      const signIn = within(screen.getByTestId("phone-front-door")).getByRole("link", { name: "Sign in" });
      expect(signIn.getAttribute("href")).toBe("/signin");
      // **SPEC §13.1's 44px floor is NOT asserted here**, and the test-quality
      // wall is right to have refused it: `expect(className).toContain(
      // "min-h-11")` is asserting a class, and the wall's own message says
      // roles, labels and values. The floor is a property of the `touch` size
      // variant and `ui/primitives.test.tsx` owns it — "Button's touch size is
      // a 44px floor in both axes" — which is the one place `components/ui` is
      // allowed to read its own token classes. Restating it here would have
      // been a second, weaker copy of a claim already made properly.
    });

    // *"Is also awkward wording ... and missing the graphic"*, twice, and
    // *"missing the example. Attached example of what it should look like"*.
    // Every claim carries a card since the 2026-09-28 retro (the card-less
    // "One plan" opener went; Playbooks leads, and Countdown is new), and three
    // of the four are the product itself since M42 part 9: the desktop blocks'
    // river, Discover card and notebook page, at phone size. Found with
    // `hidden`, because every claim but the first starts out unannounced.
    it("draws the example under every claim, three of them the product's own", async () => {
      render(<PhoneFrontDoor />);
      const claims = screen.getAllByTestId("front-door-claim");
      // Playbooks: a real day from the library, as Discover shows it.
      expect(
        await within(claims[0]!).findByRole("link", { name: LANDING_FEATURES.playbook.name, hidden: true }),
      ).toBeTruthy();
      expect(within(claims[0]!).queryByText("A beach day in Phuket")).toBeNull();
      // Together: the demo trip's day on the board's read-only river.
      expect(await within(claims[1]!).findByRole("list", { name: "Day 7 timeline", hidden: true })).toBeTruthy();
      expect(within(claims[1]!).queryByText("Fushimi Inari, early")).toBeNull();
      // Countdown: the night before, and somebody still awake moving the
      // start earlier — still a drawing, since the app's own reads the clock.
      expect(within(claims[2]!).getByText("Wheels up tomorrow")).toBeTruthy();
      expect(within(claims[2]!).getByText("Priya moved the meet-up to 6:40 am.")).toBeTruthy();
      // A countdown offers no Accept, so its card draws none (review of PR 405).
      expect(within(claims[2]!).queryByText("Accept")).toBeNull();
      // Notebook: a page of the trip as it was lived, under the trip's strip.
      expect(await within(claims[3]!).findByRole("img", { name: /^Days 1–3 Tokyo/, hidden: true })).toBeTruthy();
      expect(within(claims[3]!).getByText(/best night of the trip/)).toBeTruthy();
      expect(within(claims[3]!).queryByText("Sam, Priya, Dana, Marcus · Apr 9")).toBeNull();
    });

    // Mitchell, 2026-10-11: *"it should be more nostalgic than how much you
    // spent on dinner."* The card used to be a day's spend and its receipts;
    // "How you'll remember it" is not a total.
    it("remembers the trip in the notebook without a price in it", async () => {
      render(<PhoneFrontDoor />);
      const notebook = screen.getAllByTestId("front-door-claim")[3]!;
      expect(await within(notebook).findByText("Check in at Gora Kadan")).toBeTruthy();
      expect(within(notebook).getByText("How you'll remember it.")).toBeTruthy();
      expect(notebook.textContent).not.toMatch(/[$€£¥]\s?\d/);
    });

    // The half of "awkward wording" that was a BUILD defect rather than a copy
    // preference: the `Together` claim ran the design's headline and its card's
    // caption together into one sentence, because the card was not built.
    it("keeps the Together headline to the headline", () => {
      render(<PhoneFrontDoor />);
      const claims = screen.getAllByTestId("front-door-claim");
      expect(within(claims[1]!).getByText("The trip starts before the trip.")).toBeTruthy();
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
    expect(cta.getByRole("link", { name: "Start a trip" }).getAttribute("href")).toBe("/signup");
    expect(cta.getByRole("link", { name: "Look around a real trip" }).getAttribute("href")).toBe("/demo");
  });

  it("ends on the same footer as the desktop landing", () => {
    render(<PhoneFrontDoor />);
    const footer = within(within(screen.getByTestId("phone-front-door")).getByRole("contentinfo"));
    expect(footer.getByRole("link", { name: "mitchell@demarcosoftware.com" }).getAttribute("href")).toBe(
      "mailto:mitchell@demarcosoftware.com",
    );
    expect(footer.getByRole("link", { name: "Developers" }).getAttribute("href")).toBe("/developers");
  });
});
