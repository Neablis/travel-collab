import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { activityFactory, tripDetailFixture, uuidFrom } from "@tc/factories";
import { tripTargets } from "@/components/palette/commands";
import { registerBoardFocus } from "./boardFocus";
import { ChatPanel } from "./ChatPanel";
import type { TripChat } from "./useTripChat";

const DAY = uuidFrom(1, 46);
const colosseum = activityFactory.build({ activityId: uuidFrom(2, 46), title: "Colosseum", timeWindow: { start: "09:00", end: "11:00" } });
const trip = tripDetailFixture({
  days: [{ dayId: DAY, activityIds: [colosseum.activityId], date: null, costSubtotal: 0 }],
  activities: { [colosseum.activityId]: colosseum },
});

let unregister = () => {};
afterEach(() => act(() => unregister()));

function composer() {
  act(() => {
    unregister = registerBoardFocus({ ...tripTargets(trip, { focusedActivityId: null, focusedDayId: null, selectedDayId: null }), focusDay: vi.fn(), focusActivity: vi.fn() });
  });
  const post = vi.fn(async () => true);
  const chat: TripChat = { status: "ready", messages: [], hasEarlier: false, unread: 0, canPost: true, post, posting: false, postError: null };
  render(<ChatPanel chat={chat} personas={null} />);
  return { post, field: screen.getByRole("combobox", { name: "Message" }) as HTMLInputElement };
}

describe("the composer's @day / @stop picker (M46 D3)", () => {
  it("offers this trip's stops after @, writes the one picked by keyboard, and sends its link", async () => {
    const user = userEvent.setup();
    const { post, field } = composer();
    await user.type(field, "Meet at @stop col");
    const list = screen.getByRole("listbox", { name: "Days and stops" });
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
    expect(screen.getByRole("listbox", { name: "Days and stops" })).toBeTruthy();
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
    expect(screen.getByRole("listbox", { name: "Days and stops" })).toBeTruthy();

    await user.keyboard("{Escape}{Backspace}@");
    expect(screen.getByRole("listbox", { name: "Days and stops" })).toBeTruthy();
  });
});
