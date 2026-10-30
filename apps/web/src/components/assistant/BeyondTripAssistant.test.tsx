// M45 D9: a playbook page's assistant. Every signed-in reader sees it (PR 655:
// a plan without the assistant opens it onto the call to upgrade), and it
// starts closed, like the trip board's: the page's Ask opens it, and a
// question goes to the one door about no one trip with the page it was asked on.
//
// The plan is the one the layout sends with the page
// (`ServedEntitlementsProvider`, Mitchell's decision 3), not a mock of the
// hook that reads it: the Ask has to be in the server's HTML.
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import type { Entitlement } from "@tc/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearQueryCache } from "@/lib/queryCache";
import { ServedEntitlementsProvider } from "@/lib/useAiEntitled";
import { PlaybookAskButton, PlaybookAssistant } from "./BeyondTripAssistant";

const served = vi.hoisted(() => ({ value: ["ai.ask"] as Entitlement[] | null }));

const session = vi.hoisted(() => ({ user: { id: "user-a" } as { id: string } | null | undefined }));
vi.mock("@/components/account/useSessionUser", async (orig) => ({
  ...(await orig<typeof import("@/components/account/useSessionUser")>()),
  useSessionUser: () => session.user,
  useKnownSessionUser: () => session.user,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const DAY = { kind: "day", savedDayId: "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f" } as const;

function tree() {
  return (
    <ServedEntitlementsProvider entitlements={served.value}>
      <PlaybookAskButton />
      <PlaybookAssistant page={DAY} contextLine="Looking at Kyoto, on foot" />
    </ServedEntitlementsProvider>
  );
}

const page = () => render(tree());

const rail = () => screen.queryByRole("complementary", { name: "Assistant" });

afterEach(() => {
  served.value = ["ai.ask"];
  session.user = { id: "user-a" };
  vi.unstubAllGlobals();
  window.localStorage.clear();
  clearQueryCache();
  cleanup();
});

describe("a playbook page's assistant", () => {
  it("starts closed, opens from Ask, and asks at /api/ask about this page", async () => {
    const fetchMock = vi.fn(async () => new Response('data: {"type":"finish"}\n\n', { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    page();
    expect(rail()).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(rail()).not.toBeNull();

    await userEvent.type(screen.getByPlaceholderText("Ask about this page…"), "what does this cover?{Enter}");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(new URL(url, "http://test").pathname).toBe("/api/ask");
    expect((JSON.parse(String(init.body)) as { scope: unknown }).scope).toEqual({ kind: "playbook", page: DAY });
  });

  it("offers no Ask and no assistant to a reader who is signed out", () => {
    session.user = null;
    served.value = null;
    page();
    expect(screen.queryByRole("button", { name: "Ask" })).toBeNull();
    expect(rail()).toBeNull();
  });

  // PR 655 (Mitchell, 2026-10-30: "Render everywhere, keep behavior
  // consistent"): a plan without the assistant gets the Ask too, as on Home
  // and a trip, and it opens onto the rail's call to upgrade. Nothing it
  // offers reaches `/api/ask`.
  it("opens onto the call to upgrade for a plan without the assistant, and asks nothing", async () => {
    const fetchMock = vi.fn(async (_url: string) => new Response('data: {"type":"finish"}\n\n', { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    served.value = [];
    page();

    await userEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(screen.getByRole("link", { name: "See plans" }).getAttribute("href")).toBe("/plans");
    expect((screen.getByPlaceholderText("Ask about this page…") as HTMLTextAreaElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "What does this cover?" }));
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/api/ask"))).toEqual([]);
  });

  // Mitchell's decision 3: the plan comes with the page, so the Ask is in the
  // first HTML for a signed-in reader, before the session or anything else has
  // been read on the client, whatever that plan is (PR 655).
  it.each([
    ["with the assistant", ["ai.ask"]],
    ["without it", []],
  ] as const)("is in the server's HTML for a plan %s, with no read of its own", (_case, plan) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    session.user = undefined;
    served.value = [...plan];
    expect(renderToString(tree()).includes('data-testid="ask-pill"')).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
