import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { Entitlement } from "@tc/contracts";
import { AI_ASK_ENTITLEMENT, ServedEntitlementsProvider, useAiEntitled, useEntitled } from "./useAiEntitled";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubPlan(response: Response | Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(async () => response));
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const planWith = (...entitlements: string[]) => ({
  plan: { entitlements, planVersionRef: "v1", conferredVersionRef: "v1" },
});

describe("useAiEntitled", () => {
  it("is true when the account is conferred ai.ask", async () => {
    stubPlan(json(planWith(AI_ASK_ENTITLEMENT, "trip.collaborators")));
    const { result } = renderHook(() => useAiEntitled());
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("is false when it is not", async () => {
    stubPlan(json(planWith("trip.collaborators")));
    const { result } = renderHook(() => useAiEntitled());
    await waitFor(() => expect(result.current).toBe(false));
  });

  // **The permissive direction, stated by the hook's own contract**: `null` is
  // both "not resolved yet" and "the read failed", and every caller must treat
  // it as entitled. Flashing a paywall at a subscriber is a worse failure than
  // one optimistic frame for a free account.
  it("stays null when the read fails", async () => {
    stubPlan(json({ error: "nope" }, 500));
    const { result } = renderHook(() => useAiEntitled());
    // Given a tick to resolve — the assertion is that it did NOT become false.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current).toBeNull();
  });

  // **A 200 is not a promise about the body.** `body.plan.entitlements` on a
  // response shaped like anything else THREW inside the caller's `.then`,
  // rejecting rather than resolving — breaking the invariant this file claims
  // and `apiClient.ts` states at the top of itself.
  //
  // It surfaced when M26 link 9a mounted this hook on a second screen: five
  // unhandled rejections in a run that still reported every test passing, which
  // is why the exit code is what CLAUDE.md says to check. Each case below is a
  // 200 a real deployment can serve — an auth redirect to an HTML page, an
  // envelope without the key, a `null` plan.
  it.each([
    ["a body with no plan key", json({ ok: true })],
    ["a null plan", json({ plan: null })],
    ["a plan with no entitlements", json({ plan: { planVersionRef: "v1" } })],
    ["entitlements that are not a list", json({ plan: { entitlements: "all" } })],
    ["a body that is not JSON at all", new Response("<!doctype html>", { status: 200 })],
  ])("resolves rather than rejecting on %s", async (_name, response) => {
    stubPlan(response);
    const { result } = renderHook(() => useAiEntitled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Unknown, which every caller reads as entitled — and, crucially, NOT a
    // rejection: an unhandled one fails the run through the exit code while
    // every assertion here still passes.
    expect(result.current).toBeNull();
  });
});

// Mitchell's decision 3: under `(app)/layout.tsx` the plan comes with the page.
describe("with the plan sent with the page", () => {
  const servedAs = (entitlements: Entitlement[]) =>
    function Served({ children }: { children: ReactNode }) {
      return <ServedEntitlementsProvider entitlements={entitlements}>{children}</ServedEntitlementsProvider>;
    };

  it.each<[string, Entitlement[], boolean]>([
    ["true when it is conferred", [AI_ASK_ENTITLEMENT], true],
    ["false when it is not", ["trip.collaborators"], false],
  ])("is %s, on the first render and with no read of its own", (_name, entitlements, expected) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    // `active: false` too: a caller's session read has not landed on the
    // first paint, and the server only sends a plan for a signed-in reader.
    const { result } = renderHook(() => useEntitled(AI_ASK_ENTITLEMENT, false), { wrapper: servedAs(entitlements) });
    expect(result.current).toBe(expected);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
