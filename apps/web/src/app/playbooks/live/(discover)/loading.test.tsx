// Discover's loading boundaries, both copies. M45 decision 3: the head Ask is
// in the first paint, so the frame a tap on Playbooks shows first carries it
// too, or it pops in when the days do. Since PR 655 that is every signed-in
// reader's, whatever the plan the layout above the boundary serves.
import { cleanup, render, screen } from "@testing-library/react";
import type { Entitlement } from "@tc/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServedEntitlementsProvider } from "@/lib/useAiEntitled";
import CachedDiscoverRouteLoading from "../../[copy]/(discover)/loading";
import DiscoverRouteLoading from "./loading";

const session = vi.hoisted(() => ({ user: { id: "user-a" } as { id: string } | null }));
vi.mock("@/components/account/useSessionUser", async (orig) => ({
  ...(await orig<typeof import("@/components/account/useSessionUser")>()),
  useSessionUser: () => session.user,
  useKnownSessionUser: () => session.user,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

function frame(boundary: React.ReactNode, served: Entitlement[] | null) {
  render(<ServedEntitlementsProvider entitlements={served}>{boundary}</ServedEntitlementsProvider>);
}

afterEach(() => {
  session.user = { id: "user-a" };
  cleanup();
});

describe("Discover's loading frame", () => {
  it("draws the head Ask for a signed-in reader whose plan has the assistant", () => {
    frame(<DiscoverRouteLoading />, ["ai.ask"]);
    expect(screen.getByRole("heading", { level: 1, name: "Discover" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ask" })).toBeTruthy();
  });

  // A free reader's Ask opens onto the call to upgrade, as on the screen.
  it("draws the head Ask on a plan without the assistant too", () => {
    frame(<DiscoverRouteLoading />, []);
    expect(screen.getByRole("button", { name: "Ask" })).toBeTruthy();
  });

  // Only a reader with no session is sent to the cached copy.
  it("is the cached copy's frame too, for a reader with no session", () => {
    session.user = null;
    frame(<CachedDiscoverRouteLoading />, null);
    expect(screen.getByRole("heading", { level: 1, name: "Discover" })).toBeTruthy();
    expect(screen.getByRole("status", { name: "Loading days" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ask" })).toBeNull();
  });
});
