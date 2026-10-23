import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { activityFactory, tripDetailFixture, tripMemberProfileFactory, uuidFrom } from "@tc/factories";
import { tripTargets } from "@/components/palette/commands";
import { personasOf } from "@/components/pages/people";
import { registerBoardFocus } from "./boardFocus";
import { ChatPanel } from "./ChatPanel";
import type { TripChat } from "./useTripChat";

// The trip's notebooks, as the composer reads them: only `id` and `title` matter here.
const packing = { id: uuidFrom(3, 46), title: "Packing list" };
vi.mock("@/lib/pagesClient", () => ({
  fetchPages: vi.fn(async () => ({ ok: true, value: { pages: [packing], viewerId: null } })),
}));
// Whether the reader's plan answers an `@assistant`; `null` is not yet known, read as yes.
const aiEntitled = vi.hoisted(() => ({ value: null as boolean | null }));
vi.mock("@/lib/useAiEntitled", () => ({ useAiEntitled: () => aiEntitled.value }));
const bea = tripMemberProfileFactory.build({ userId: "dev-bea", name: "Bea" });

const DAY = uuidFrom(1, 46);
const colosseum = activityFactory.build({ activityId: uuidFrom(2, 46), title: "Colosseum", timeWindow: { start: "09:00", end: "11:00" } });
const trip = tripDetailFixture({
  days: [{ dayId: DAY, activityIds: [colosseum.activityId], date: null, costSubtotal: 0 }],
  activities: { [colosseum.activityId]: colosseum },
});

let unregister = () => {};
afterEach(() => {
  act(() => unregister());
  aiEntitled.value = null;
});

function composer(detail = trip) {
  act(() => {
    unregister = registerBoardFocus({ ...tripTargets(detail, { focusedActivityId: null, focusedDayId: null, selectedDayId: null }), focusDay: vi.fn(), focusActivity: vi.fn() });
  });
  const post = vi.fn(async () => null);
  const chat: TripChat = {
    tripId: trip.tripId,
    status: "ready",
    messages: [],
    hasEarlier: false,
    unread: 0,
    canPost: true,
    post,
    postError: null,
    edit: async () => true,
    remove: async () => true,
    changeError: null,
  };
  render(<ChatPanel chat={chat} personas={personasOf([bea])} />);
  return { post, field: screen.getByRole("combobox", { name: "Message" }) as HTMLInputElement };
}

describe("the composer's @day / @stop picker (M46 D3)", () => {
  it("offers this trip's stops after @, writes the one picked by keyboard, and sends its link", async () => {
    const user = userEvent.setup();
    const { post, field } = composer();
    await user.type(field, "Meet at @stop col");
    const list = screen.getByRole("listbox", { name: "Mentions" });
    expect(within(list).getAllByRole("option").map((o) => o.textContent)).toEqual(["StopColosseum"]);
    expect(field.getAttribute("aria-expanded")).toBe("true");

    // Enter picks; it does not send the half-typed mention.
    await user.keyboard("{Enter}");
    expect(post).not.toHaveBeenCalled();
    expect(field.value).toBe("Meet at @Colosseum ");
    expect(screen.queryByRole("listbox")).toBeNull();

    await user.type(field, "at nine?{Enter}");
    expect(post).toHaveBeenCalledWith("Meet at @Colosseum at nine?", { kind: "stop", id: colosseum.activityId });
  });

  it("sends no link once the picked mention is taken out of the words", async () => {
    const user = userEvent.setup();
    const { post, field } = composer();
    await user.type(field, "@day{Enter}");
    expect(field.value).toBe("@Day 1 ");
    await user.clear(field);
    await user.type(field, "Free all day{Enter}");
    expect(post).toHaveBeenCalledWith("Free all day", undefined);
  });

  it("closes on Escape and leaves the words as typed", async () => {
    const user = userEvent.setup();
    const { field } = composer();
    await user.type(field, "@");
    expect(screen.getByRole("listbox", { name: "Mentions" })).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(field.value).toBe("@");
  });

  // PR 439 review: closing remembered only where the `@` was, so a new `@` at
  // the same place, after the words were replaced or deleted, never opened it.
  it("opens again for a new @ where a picked or dismissed one was", async () => {
    const user = userEvent.setup();
    const { field } = composer();
    await user.type(field, "@day{Enter}");
    await user.clear(field);
    await user.type(field, "@");
    expect(screen.getByRole("listbox", { name: "Mentions" })).toBeTruthy();

    await user.keyboard("{Escape}{Backspace}@");
    expect(screen.getByRole("listbox", { name: "Mentions" })).toBeTruthy();
  });

  // PR 439 re-review: taking back the space a pick adds reopened the picker,
  // so the next Enter picked again instead of sending.
  it("stays closed when the space after a pick is deleted, so Enter sends", async () => {
    const user = userEvent.setup();
    const { post, field } = composer();
    await user.type(field, "Meet at @col{Enter}{Backspace}");
    expect(screen.queryByRole("listbox")).toBeNull();
    await user.keyboard("{Enter}");
    expect(post).toHaveBeenCalledWith("Meet at @Colosseum", { kind: "stop", id: colosseum.activityId });
  });

  // PR 439 re-review: `@Day 1` is a prefix of `@Day 10`, which names another day.
  it("sends no link once more is typed onto the picked name", async () => {
    const user = userEvent.setup();
    const { post, field } = composer();
    await user.type(field, "Swap @day{Enter}{Backspace}0{Enter}");
    expect(post).toHaveBeenCalledWith("Swap @Day 10", undefined);
  });
});

// Mitchell's M46 walk: "@ reference people, along with days and notebooks".
describe("the composer's @ picker for people and notebooks", () => {
  it("offers the trip's members and notebooks after the days and stops, and sends the one picked", async () => {
    const user = userEvent.setup();
    const { post, field } = composer();
    await user.type(field, "@");
    const list = screen.getByRole("listbox", { name: "Mentions" });
    // The notebooks arrive after the panel opens.
    expect(await within(list).findByRole("option", { name: /Packing list/ })).toBeTruthy();
    expect(within(list).getAllByRole("option").map((o) => o.textContent)).toEqual(["AskAssistant", "DayDay 1", "StopColosseum", "PersonBea", "NotebookPacking list"]);

    await user.type(field, "bea{Enter}");
    expect(field.value).toBe("@Bea ");
    await user.type(field, "and @pack{Enter}{Enter}");
    // One reference a message, the last one picked.
    expect(post).toHaveBeenCalledWith("@Bea and @Packing list", { kind: "notebook", id: packing.id });
  });

  // PR 446 review: the first 8 matches overall were all days on a long trip,
  // so a bare "@" never offered a person or a notebook.
  it("offers a person and a notebook on a bare @, however many days the trip has", async () => {
    const user = userEvent.setup();
    const days = Array.from({ length: 10 }, (_, i) => ({ dayId: uuidFrom(10 + i, 46), activityIds: [], date: null, costSubtotal: 0 }));
    const { field } = composer(tripDetailFixture({ days, activities: {} }));
    await user.type(field, "@");
    const list = screen.getByRole("listbox", { name: "Mentions" });
    expect(await within(list).findByRole("option", { name: /Packing list/ })).toBeTruthy();
    expect(within(list).getByRole("option", { name: /Bea/ })).toBeTruthy();
    expect(within(list).getAllByRole("option")).toHaveLength(8);
  });
});

// M52 decision 18: the assistant is a mention target, asked on the reader's own
// plan; a plan without it is offered the upgrade, not a control that is refused.
describe("the composer's @assistant", () => {
  it("offers the assistant after @, and sends the message as an ask", async () => {
    const user = userEvent.setup();
    const { post, field } = composer();
    await user.type(field, "@ass");
    expect(within(screen.getByRole("listbox", { name: "Mentions" })).getAllByRole("option").map((o) => o.textContent)).toEqual(["AskAssistant"]);
    await user.keyboard("{Enter}");
    expect(field.value).toBe("@assistant ");
    await user.type(field, "push dinner back an hour{Enter}");
    expect(post).toHaveBeenCalledWith("@assistant push dinner back an hour", undefined, true);
  });

  // Review of PR 535: an address is not an ask, and an ask is a paid turn.
  it("does not ask for @assistant inside an address, and does at a sentence's end", async () => {
    const user = userEvent.setup();
    const { post, field } = composer();
    await user.type(field, "forward it to bookings@assistant.com{Enter}");
    await user.type(field, "or foo@assistant{Enter}");
    await user.type(field, "@assistant.com is theirs{Enter}");
    await user.type(field, "over to you, @assistant.{Enter}");
    expect(post.mock.calls).toEqual([
      ["forward it to bookings@assistant.com", undefined],
      ["or foo@assistant", undefined],
      ["@assistant.com is theirs", undefined],
      ["over to you, @assistant.", undefined, true],
    ]);
  });

  it("offers a reader without the plan the upgrade instead, and sends their words as a message", async () => {
    aiEntitled.value = false;
    const user = userEvent.setup();
    const { post, field } = composer();
    // Mounted empty, so a screen reader announces the offer when it arrives.
    const regions = screen.getAllByRole("status");
    expect(regions.map((region) => region.textContent)).toEqual(["", ""]);
    await user.type(field, "@ass{Enter}");
    expect(field.value).toBe("@ass");
    expect(regions.find((region) => region.textContent?.includes("Asking the assistant in chat comes with Plus"))).toBeDefined();
    expect(screen.getByRole("link", { name: "See plans" }).getAttribute("href")).toBe("/plans");

    await user.clear(field);
    await user.type(field, "@assistant hello{Enter}");
    expect(post).toHaveBeenCalledWith("@assistant hello", undefined);
  });
});
