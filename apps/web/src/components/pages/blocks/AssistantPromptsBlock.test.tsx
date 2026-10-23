import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tripDetailFactory } from "@tc/factories";
import { registerPhoneAsk } from "@/components/nav/phoneAsk";
import { ServedEntitlementsProvider } from "@/lib/useAiEntitled";
import { MacroView } from "../MacroView";

// "Ask" (M52 decision 15) through the notebook's own renderer, for the three
// readers the plan's preview names: a paid member's chip opens the screen's
// Ask with its question filled in; a free member and a share-link reader are
// shown nothing (decision 20, SPEC §27: absent, never disabled).

const trip = tripDetailFactory.build({}, { transient: { dayCount: 1, activitiesPerDay: 0, unscheduledCount: 0 } });

const unregister: (() => void)[] = [];
afterEach(() => {
  unregister.splice(0).forEach((undo) => undo());
  cleanup();
});

const page = (entitlements: readonly ("ai.ask")[]) => (
  <ServedEntitlementsProvider entitlements={entitlements}>
    <div data-testid="page">
      <MacroView detail={trip} context={{ tripId: trip.tripId }} name="assistant.prompts" params={{}} />
    </div>
  </ServedEntitlementsProvider>
);

describe("AssistantPromptsBlock", () => {
  // Filled in, not sent (decision 15: "opens the sheet prefilled"): the
  // reader says by how much before it costs a turn.
  it("fills a chip's whole question into the screen's Ask, for a member with the assistant", async () => {
    const onAsk = vi.fn();
    unregister.push(registerPhoneAsk({ open: false, onOpen: () => {}, onAsk }));
    render(page(["ai.ask"]));
    await userEvent.click(screen.getByRole("button", { name: "Running late" }));
    expect(onAsk).toHaveBeenCalledWith(expect.stringMatching(/running late/i), { prefill: true });
    expect(onAsk.mock.calls[0]![0]).not.toBe("Running late");
  });

  it("is absent for a member whose plan has no assistant", () => {
    unregister.push(registerPhoneAsk({ open: false, onOpen: () => {}, onAsk: () => {} }));
    render(page([]));
    expect(screen.getByTestId("page").textContent).toBe("");
    expect(screen.queryByRole("group")).toBeNull();
  });

  // A share link's page registers no Ask, whatever the account holds.
  it("is absent where no screen offers an Ask", () => {
    render(page(["ai.ask"]));
    expect(screen.getByTestId("page").textContent).toBe("");
    expect(screen.queryByRole("group")).toBeNull();
  });
});
