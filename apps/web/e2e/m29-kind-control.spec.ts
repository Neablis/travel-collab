import type { Locator } from "@playwright/test";
import { expect, test } from "./fixtures/test";
import { createMappedTrip } from "./helpers";
import { e2eTripName } from "./tripNames";

// M29 part 1's two walks (SPEC §36.9, ADR-055): the stop editor's segmented
// Kind with the one detail row under it, and the badge a card earns from it.
//
// What is proven elsewhere and not here: which command the editor sends
// (`ActivityEditor.test.tsx`), which label and variant a stop earns
// (`activityKind.test.ts`), and the contract refusing a reason off `pending`
// (`adr055-pending-reason.test.ts`). What only a browser has is a hover's
// tooltip, a colour after the design tokens resolve, and whether a badge fits
// on one line of a 390px phone card — so that is what this walks.

const radio = (group: Locator, name: string) => group.getByRole("radio", { name, exact: true });

test("the stop editor's Kind is segmented, and Pending and Travel each bring their own icon row", async ({ page }) => {
  const tripId = await createMappedTrip(page, e2eTripName("KindControl"), 1);
  await page.goto(`/trips/${tripId}?view=Plan`);
  await page.getByRole("button", { name: "Add stop" }).click();
  await expect(page.getByRole("heading", { name: "Add a stop" })).toBeVisible();

  const kind = page.getByRole("radiogroup", { name: "Kind", exact: true });
  await expect(kind.getByRole("radio")).toHaveText(["Planned", "Pending", "Travel"]);
  const why = page.getByRole("radiogroup", { name: "Why it is pending" });
  const modes = page.getByRole("radiogroup", { name: "Travelling by" });

  // Planned has no detail, so no second row at all.
  await radio(kind, "Planned").click();
  await expect(radio(kind, "Planned")).toHaveAttribute("aria-checked", "true");
  await expect(why).toHaveCount(0);
  await expect(modes).toHaveCount(0);

  // -- Pending: To book / Maybe, with To book already chosen on a new stop --
  await radio(kind, "Pending").click();
  await expect(radio(kind, "Pending")).toHaveAttribute("aria-checked", "true");
  await expect(why.getByRole("radio")).toHaveCount(2);
  await expect(radio(why, "To book")).toHaveAttribute("aria-checked", "true");
  await expect(radio(why, "Maybe")).toHaveAttribute("aria-checked", "false");
  // An icon says what it is when hovered: the title is the browser's tooltip.
  for (const label of ["To book", "Maybe"]) {
    await radio(why, label).hover();
    await expect(radio(why, label)).toHaveAttribute("title", label);
  }
  // Clicking the chosen icon clears it — no reason at all, not the other one.
  await radio(why, "To book").click();
  await expect(radio(why, "To book")).toHaveAttribute("aria-checked", "false");
  await expect(radio(why, "Maybe")).toHaveAttribute("aria-checked", "false");

  // -- Travel: the mode icons replace the reasons --
  await radio(kind, "Travel").click();
  await expect(why).toHaveCount(0);
  const MODES = ["On foot", "Bus", "Train", "Flight", "Ferry", "Car", "Bike"];
  await expect(modes.getByRole("radio")).toHaveCount(MODES.length);
  for (const label of MODES) {
    await radio(modes, label).hover();
    await expect(radio(modes, label)).toHaveAttribute("title", label);
  }
  await radio(modes, "Train").click();
  await expect(radio(modes, "Train")).toHaveAttribute("aria-checked", "true");
  await radio(modes, "Train").click();
  await expect(modes.getByRole("radio", { checked: true })).toHaveCount(0);
});

// Runs in the page: the badge's own background against the token it should be
// wearing, resolved the same way — so the assertion is "amber is the warning
// tint", whatever the tint's hex is today and in either theme.
function backgroundAgainstToken(el: Element, token: string): { got: string; want: string } {
  const probe = document.createElement("span");
  probe.style.backgroundColor = `var(${token})`;
  document.body.append(probe);
  const want = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return { got: getComputedStyle(el).backgroundColor, want };
}

test("a card's badge reads To book in amber, Maybe in neutral, or its mode, and none wraps at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // One day, with the factory's one planned stop on it — which earns no badge.
  const tripId = await createMappedTrip(page, e2eTripName("KindBadges"), 1);
  const detail = (await (await page.request.get(`/api/trips/${tripId}`)).json()) as { trip: { days: { dayId: string }[] } };
  const dayId = detail.trip.days[0]!.dayId;

  // A crowded footer on purpose — a cost at the right and tags beside the
  // badge — so "fits on one line" is asked of a card that has other things in
  // its row, not an empty one.
  const stops = [
    { title: "Ryokan in Hakone", extra: { kind: "pending", pendingReason: "book", tags: ["lodging"] }, label: "To book", token: "--color-warning-tint" },
    { title: "Ghibli Museum", extra: { kind: "pending", pendingReason: "maybe", tags: ["ticketed", "outdoors"] }, label: "Maybe", token: "--color-moss" },
    { title: "Shinkansen to Kyoto", extra: { kind: "transit", mode: "train" }, label: "Train", token: "--color-info-tint" },
  ].map((stop) => ({ ...stop, activityId: crypto.randomUUID() }));
  for (const stop of stops) {
    const response = await page.request.post(`/api/trips/${tripId}/commands`, {
      data: {
        type: "AddActivity",
        tripId,
        activityId: stop.activityId,
        dayId,
        title: stop.title,
        cost: { amountMinor: 1_234_500, currency: "USD" },
        ...stop.extra,
      },
    });
    expect(response.ok(), `AddActivity ${stop.title} -> ${response.status()}`).toBe(true);
  }
  // Straight to the URL: below 768px the lens tab strip is hidden.
  await page.goto(`/trips/${tripId}?view=Plan`);

  // Three badges: the planned stop earns none.
  await expect(page.getByTestId(/^kind-badge-/)).toHaveCount(stops.length);
  for (const stop of stops) {
    const card = page.getByTestId(`activity-card-${stop.activityId}`);
    const badge = page.getByTestId(`kind-badge-${stop.activityId}`);
    await expect(card).toContainText(stop.title);
    await expect(badge).toHaveText(stop.label);

    const colour = await badge.evaluate(backgroundAgainstToken, stop.token);
    expect(colour.got, `${stop.label} wears ${stop.token}`).toBe(colour.want);

    // One line: shorter than two of its own lines, and inside its card.
    const geometry = await badge.evaluate((el) => ({
      height: el.getBoundingClientRect().height,
      line: parseFloat(getComputedStyle(el).lineHeight),
    }));
    expect(geometry.height, `${stop.label} wrapped: ${geometry.height}px for a ${geometry.line}px line`).toBeLessThan(geometry.line * 2);
    const badgeBox = (await badge.boundingBox())!;
    const cardBox = (await card.boundingBox())!;
    expect(badgeBox.x + badgeBox.width, `${stop.label} runs past its card`).toBeLessThanOrEqual(cardBox.x + cardBox.width);
  }
});
