import { expect, test } from "@playwright/test";
import { createMappedTrip } from "./helpers";
import { e2eTripName } from "./tripNames";

// **SPEC §13.1's floor, counted the way KI-046 counted it** — M26 link 14's
// sweep and the Wave 2 gate's measurement box. Rendered heights in a browser,
// never a class scan: KI-046's own 191-of-211 came from rendered boxes, and
// counting `min-h-11` in the source would be a different claim wearing the same
// number.
//
// The figures, at 411x852 across seven phone routes:
//
// | | under 44px |
// |---|---|
// | KI-046, 2026-09-05 (one trip screen, 412px) | 191 of 211, 91% |
// | Before this sweep (2026-09-20, seven routes, 411px) | **48 of 91, 53%** |
// | After | **4 of 91, 4%** |
//
// **The denominators differ and that is not a trick.** KI-046 counted one
// screen on a build with four lenses and a Timeline card carrying Ask and Edit
// per stop; this counts seven routes on a build where §24 deleted that lens.
// KI-046 says the same of its own two figures ("the two counts are not directly
// comparable; both say the same thing").
//
// **All four that remain are MapLibre's own attribution** — named in `ALLOWED`
// below, which is a decision rather than a miss: the credit is legally
// required, the library styles it, and restyling somebody else's required
// credit is not ours to do.
//
// The floor reached them through three primitives rather than N call sites:
// `buttonVariants`' base, `Input`'s base, and `PHONE_TOUCH` for the elements
// that are styled like controls without being them (a segmented option, a nav
// link, a row link).
test.describe("M26 — SPEC §13.1's 44px floor on a phone", () => {
  // **What is deliberately under the floor, and why.** A number with no
  // exceptions list is a number somebody will silence rather than fix.
  const ALLOWED = [
    // MapLibre's own attribution. Legally required, styled by the library, and
    // restyling somebody else's required credit is not ours to do.
    /MapLibre|OpenFreeMap|OpenMapTiles|OpenStreetMap/,
  ];

  async function countUnder(page: import("@playwright/test").Page, url: string) {
    await page.goto(url);
    // The page's own chrome, rather than `networkidle` — which the lint wall
    // bans for good reason (a surface with a poll or a long-lived stream never
    // reaches it). Every route below renders `AppHeader`, so its wordmark is
    // the one element that says "this route has painted" on all seven.
    await page.getByRole("link", { name: "Caesura" }).first().waitFor();
    return page.evaluate(() =>
      [...document.querySelectorAll("button, a[href], [role='button'], input, select, textarea")]
        .filter((el) => {
          const box = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none";
        })
        .map((el) => ({
          h: Math.round(el.getBoundingClientRect().height),
          name: (el.getAttribute("aria-label") ?? el.textContent?.trim() ?? "(unnamed)").slice(0, 40),
        }))
        .filter((c) => c.h < 44),
    );
  }

  test("every control a phone offers clears 44px, bar a named few", async ({ page }) => {
    await page.setViewportSize({ width: 411, height: 852 });
    const tripId = await createMappedTrip(page, e2eTripName("Targets"), 3);

    const routes = [
      ["trips", "/"],
      ["plan", `/trips/${tripId}?view=Plan`],
      ["map", `/trips/${tripId}?view=Map`],
      ["notebook", `/trips/${tripId}/pages`],
      ["playbooks", "/playbooks"],
      ["account", "/account"],
      ["plans", "/plans"],
    ] as const;

    const measured = [];
    for (const [route, url] of routes) {
      measured.push(...(await countUnder(page, url)).map((c) => ({ route, ...c })));
    }
    // The filter is not a conditional IN the test — it is how the exception
    // list is applied, and it keeps the assertion a single `toEqual` whose
    // failure prints the whole list rather than the first item.
    const offenders = measured
      .filter((c) => !ALLOWED.some((allowed) => allowed.test(c.name)))
      .map((c) => `${c.route}: "${c.name}" is ${c.h}px`);

    // Reported as a LIST, not a count: a bare number tells whoever breaks this
    // that something is wrong and not what.
    expect(offenders).toEqual([]);
  });

  // The other half of "a variant layer, not a second design system": the
  // desktop keeps its own density, and the floor releases at the same 768px
  // line every other phone rule in this app draws.
  test("does not force the floor on a desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    const addTrip = page.getByRole("button", { name: "New trip" });
    const box = await addTrip.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeLessThan(44);
  });
});
