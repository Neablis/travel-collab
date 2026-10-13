// M45 D9: a playbook page's assistant. Only an account whose plan has the
// assistant sees it, and it starts closed, like the trip board's: the page's
// Ask opens it, and a question goes to the one door about no one trip with
// the page it was asked on.
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssistantAskButton, PlaybookAssistant } from "./BeyondTripAssistant";

const entitlement = vi.hoisted(() => ({ value: true as boolean | null }));
vi.mock("@/lib/useAiEntitled", () => ({
  useEntitled: () => entitlement.value,
  useAiEntitled: () => entitlement.value,
  AI_ASK_ENTITLEMENT: "ai.ask",
}));

const session = vi.hoisted(() => ({ user: { id: "user-a" } as { id: string } | null | undefined }));
vi.mock("@/components/account/useSessionUser", async (orig) => ({
  ...(await orig<typeof import("@/components/account/useSessionUser")>()),
  useSessionUser: () => session.user,
  useKnownSessionUser: () => session.user,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const DAY = { kind: "day", savedDayId: "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f" } as const;

function page() {
  return render(
    <>
      <AssistantAskButton />
      <PlaybookAssistant page={DAY} contextLine="Looking at Kyoto, on foot" />
    </>,
  );
}

const rail = () => screen.queryByRole("complementary", { name: "Assistant" });

afterEach(() => {
  entitlement.value = true;
  session.user = { id: "user-a" };
  vi.unstubAllGlobals();
  window.localStorage.clear();
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

  it.each([
    ["signed out", () => (session.user = null)],
    ["on a plan without the assistant", () => (entitlement.value = false)],
    ["while the plan is still being read", () => (entitlement.value = null)],
  ])("offers no Ask and no assistant %s", (_case, arrange) => {
    arrange();
    page();
    expect(screen.queryByRole("button", { name: "Ask" })).toBeNull();
    expect(rail()).toBeNull();
  });
});
