import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UserPreferences } from "@tc/contracts";
import { tripDetailFixture } from "@tc/factories";
import { PreferencesProvider } from "@/components/account/PreferencesProvider";
import type { KeepDayCandidate } from "./KeepDayDialog";

const createSavedDayMock = vi.fn();
const publishSavedDayMock = vi.fn();
const updatePreferencesMock = vi.fn();
const fetchTripDetailMock = vi.fn();
vi.mock("@/lib/apiClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/apiClient")>()),
  createSavedDay: (...args: unknown[]) => createSavedDayMock(...args),
  publishSavedDay: (...args: unknown[]) => publishSavedDayMock(...args),
  updatePreferences: (...args: unknown[]) => updatePreferencesMock(...args),
  fetchTripDetail: (...args: unknown[]) => fetchTripDetailMock(...args),
}));
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { PublishTripOffer, TripPageOffer } from "./PublishTripOffer";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const preferences: UserPreferences = {
  displayName: null,
  homeAirport: null,
  distanceUnit: "km",
  timeFormat: "12h",
  avatar: null,
  color: null,
  publicDisplayName: false,
  dismissedPublishOffers: [],
};

const tripId = "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f";
const savedDayId = "8b1f3c2a-1d4e-4f5a-9b6c-7d8e9f0a1b2c";
const days: KeepDayCandidate[] = [
  { dayId: "d1", date: "2020-05-01", city: "Lisbon", stops: [] },
  {
    dayId: "d2",
    date: "2020-05-02",
    city: "Sintra",
    stops: [
      {
        title: "Pena Palace",
        timeWindow: null,
        location: null,
        notes: null,
        anchors: [],
        kind: "planned",
        tags: [],
        cost: null,
        dayIndex: 0,
        mode: null,
        endLocation: null,
        pendingReason: null,
      },
    ],
  },
];

function renderOffer(canPublish: boolean) {
  return render(
    <PreferencesProvider initialRead={{ preferences, defaultColor: null, isAdmin: false }}>
      <PublishTripOffer trip={{ tripId, name: "Lisbon long weekend", endDate: "2020-05-02" }} canPublish={canPublish} days={days} />
    </PreferencesProvider>,
  );
}

// M50 decision 7, at the top of the trip page: the board passes the gate its
// Keep pennant uses, and the days it already has.
describe("PublishTripOffer on the trip page", () => {
  it("publishes the whole trip and lands on its public page", async () => {
    createSavedDayMock.mockResolvedValue({ ok: true, value: { savedDayId, name: "Lisbon long weekend" } });
    publishSavedDayMock.mockResolvedValue({ ok: true, value: { savedDayId, name: "Lisbon long weekend" } });
    updatePreferencesMock.mockResolvedValue({ ok: true, value: { ...preferences, dismissedPublishOffers: [tripId] } });
    renderOffer(true);
    await userEvent.click(await screen.findByRole("button", { name: "Publish Lisbon long weekend" }));
    await userEvent.click(screen.getByRole("button", { name: "Save & publish" }));

    expect(createSavedDayMock).toHaveBeenCalledWith({ name: "Lisbon long weekend", tripId, dayIds: ["d1", "d2"] });
    expect(push).toHaveBeenCalledWith(`/playbooks/day/lisbon-long-weekend-${savedDayId}`);
    // Published, it is not offered again: a second yes would be a second
    // public page of the same trip.
    expect(updatePreferencesMock).toHaveBeenCalledWith({ dismissedPublishOffers: [tripId] });
  });

  // On Home every card carries one, so each control says whose trip it is,
  // and Dismiss does not drop focus back to the top of the page.
  it("names the trip on its controls, and keeps focus in place on Dismiss", async () => {
    updatePreferencesMock.mockResolvedValue({ ok: true, value: { ...preferences, dismissedPublishOffers: [tripId] } });
    renderOffer(true);
    await userEvent.click(await screen.findByRole("button", { name: "Dismiss publishing Lisbon long weekend" }));
    expect(screen.queryByRole("group", { name: "Publish Lisbon long weekend as a playbook" })).toBeNull();
    // `:focus` asked of what the query found, as SnapshotList.test.tsx does.
    const note = await screen.findByRole("status");
    expect(note.matches(":focus")).toBe(true);
    // Focus lands on something that stays: a note that goes once focus leaves
    // it is a place a reader cannot come back to.
    await userEvent.tab();
    expect(screen.getByRole("status")).toBe(note);
  });

  it("keeps the offer and says so when the dismissal fails to save", async () => {
    updatePreferencesMock.mockResolvedValue({ ok: false, error: { status: 0, message: "Couldn't save. Try again." } });
    renderOffer(true);
    await userEvent.click(await screen.findByRole("button", { name: "Dismiss publishing Lisbon long weekend" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Couldn't save. Try again.");
    expect(screen.getByRole("group", { name: "Publish Lisbon long weekend as a playbook" })).toBeTruthy();
    // Both usable again, so the reader can retry or publish instead, and focus
    // is still on Dismiss: the error's redraw keeps the pressed button rather
    // than replacing it. (That it is never `disabled` while held, which in a
    // browser would drop focus too, is the next test's `:disabled` check.)
    const dismiss = screen.getByRole("button", { name: "Dismiss publishing Lisbon long weekend" });
    expect(dismiss.getAttribute("aria-disabled")).toBeNull();
    const publish = screen.getByRole("button", { name: "Publish Lisbon long weekend" });
    expect(publish.getAttribute("aria-disabled")).toBeNull();
    expect(dismiss.matches(":focus")).toBe(true);
  });

  // A Publish pressed while the dismissal saves would open the Keep dialog,
  // and the save landing would unmount it in the middle of the edit.
  it("lets neither control be pressed while the dismissal saves", async () => {
    updatePreferencesMock.mockReturnValue(new Promise(() => {}));
    renderOffer(true);
    await userEvent.click(await screen.findByRole("button", { name: "Dismiss publishing Lisbon long weekend" }));
    const publish = screen.getByRole("button", { name: "Publish Lisbon long weekend" });
    const dismiss = screen.getByRole("button", { name: "Dismiss publishing Lisbon long weekend" });
    expect(publish.getAttribute("aria-disabled")).toBe("true");
    expect(dismiss.getAttribute("aria-disabled")).toBe("true");
    // Announced, not `disabled`: a browser moves focus off a disabled button to
    // the page. jsdom leaves `activeElement` alone, but `:focus` does not match.
    expect(dismiss.matches(":focus")).toBe(true);
    expect(dismiss.matches(":disabled")).toBe(false);
    await userEvent.click(publish);
    expect(screen.queryByRole("dialog")).toBeNull();
    // A second press is a second save of the same dismissal.
    await userEvent.click(dismiss);
    expect(updatePreferencesMock).toHaveBeenCalledTimes(1);
  });

  // From Home the days are read when Publish is pressed. A Dismiss landing
  // during that read would unmount the dialog it is about to open, and a read
  // that fails must leave both controls usable for a retry.
  it("holds Dismiss while Publish reads the trip, and frees both if the read fails", async () => {
    let fail!: () => void;
    fetchTripDetailMock.mockReturnValue(
      new Promise((resolve) => (fail = () => resolve({ ok: false, error: { status: 0, message: "Couldn't load the trip." } }))),
    );
    render(
      <PreferencesProvider initialRead={{ preferences, defaultColor: null, isAdmin: false }}>
        <PublishTripOffer trip={{ tripId, name: "Lisbon long weekend", endDate: "2020-05-02" }} canPublish />
      </PreferencesProvider>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Publish Lisbon long weekend" }));
    const dismiss = screen.getByRole("button", { name: "Dismiss publishing Lisbon long weekend" });
    expect(dismiss.getAttribute("aria-disabled")).toBe("true");
    await userEvent.click(dismiss);
    expect(updatePreferencesMock).not.toHaveBeenCalled();

    await act(async () => fail());
    expect((await screen.findByRole("alert")).textContent).toBe("Couldn't load the trip.");
    expect(dismiss.getAttribute("aria-disabled")).toBeNull();
    const publish = screen.getByRole("button", { name: "Publish Lisbon long weekend" });
    expect(publish.getAttribute("aria-disabled")).toBeNull();
  });

  // The page reads the trip's end off its last day: a trip whose first day is
  // past but whose last is still to come is not over.
  it("is offered once the trip's last day, not its first, has passed", async () => {
    const dated = (dates: string[]) =>
      tripDetailFixture({ days: dates.map((date, i) => ({ dayId: `d${i}`, activityIds: [], date, costSubtotal: 0 })) });
    const { rerender } = render(
      <PreferencesProvider initialRead={{ preferences, defaultColor: null, isAdmin: false }}>
        <TripPageOffer trip={dated(["2020-05-01", "2020-05-02"])} canPublish />
      </PreferencesProvider>,
    );
    // Witness: today has been read and the offer shows for a trip all past.
    expect(await screen.findByRole("group", { name: /^Publish Rome 2027/ })).toBeTruthy();
    rerender(
      <PreferencesProvider initialRead={{ preferences, defaultColor: null, isAdmin: false }}>
        <TripPageOffer trip={dated(["2020-05-01", "2999-05-02"])} canPublish />
      </PreferencesProvider>,
    );
    expect(screen.queryByRole("group", { name: /^Publish Rome 2027/ })).toBeNull();
  });

  it("is not offered to someone the board does not let keep a day", async () => {
    const { rerender } = renderOffer(true);
    // Witness: today has been read, and the trip is over.
    expect(await screen.findByRole("group", { name: "Publish Lisbon long weekend as a playbook" })).toBeTruthy();
    rerender(
      <PreferencesProvider initialRead={{ preferences, defaultColor: null, isAdmin: false }}>
        <PublishTripOffer trip={{ tripId, name: "Lisbon long weekend", endDate: "2020-05-02" }} canPublish={false} days={days} />
      </PreferencesProvider>,
    );
    expect(screen.queryByRole("group", { name: "Publish Lisbon long weekend as a playbook" })).toBeNull();
  });
});
