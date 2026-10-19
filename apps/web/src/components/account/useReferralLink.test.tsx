import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useReferralLink } from "./useReferralLink";

// The referral link the Share and Invite dialogs offer (M50 part 8). What
// matters is what lands on the clipboard, and that a code is minted only when
// there is no unredeemed one to hand out: each code is a slot under the
// server's cap on outstanding codes.

type Codes = { code: string; redeemed: boolean }[];

function serve({ earnsReward, codes = [], mint = 201 }: { earnsReward: boolean; codes?: Codes; mint?: number }) {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      return mint === 201
        ? new Response(JSON.stringify({ code: "MINTED234" }), { status: 201 })
        : new Response(JSON.stringify({ error: "too-many-outstanding" }), { status: mint });
    }
    return new Response(JSON.stringify({ codes, earnsReward }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const posts = (fetchMock: ReturnType<typeof serve>) =>
  fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");

const writeText = vi.fn();

beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});

afterEach(() => vi.unstubAllGlobals());

describe("useReferralLink", () => {
  it("does not earn until the server says the account earns the reward", async () => {
    const fetchMock = serve({ earnsReward: false });
    const { result } = renderHook(() => useReferralLink());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/account/referrals"));
    await act(async () => {
      await fetchMock.mock.results[0]?.value;
    });
    expect(result.current.earns).toBe(false);
  });

  it("copies the unredeemed code's signup link without minting another", async () => {
    const fetchMock = serve({
      earnsReward: true,
      codes: [
        { code: "USED23456", redeemed: true },
        { code: "OPEN23456", redeemed: false },
      ],
    });
    const { result } = renderHook(() => useReferralLink());
    await waitFor(() => expect(result.current.earns).toBe(true));
    await act(() => result.current.copy());
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/signup?code=OPEN23456`);
    expect(posts(fetchMock)).toHaveLength(0);
    expect(result.current.status).toBe("copied");
  });

  it("mints a code when none is unredeemed, then copies its link", async () => {
    const fetchMock = serve({ earnsReward: true, codes: [{ code: "USED23456", redeemed: true }] });
    const { result } = renderHook(() => useReferralLink());
    await waitFor(() => expect(result.current.earns).toBe(true));
    await act(() => result.current.copy());
    expect(posts(fetchMock)).toHaveLength(1);
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/signup?code=MINTED234`);
  });

  // A second click before the first mint has answered would see no unredeemed
  // code either, and spend a second slot under the cap.
  it("mints once when copy is pressed twice before the mint answers", async () => {
    const fetchMock = serve({ earnsReward: true });
    let answerMint: (res: Response) => void = () => {};
    const { result } = renderHook(() => useReferralLink());
    await waitFor(() => expect(result.current.earns).toBe(true));
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => (answerMint = resolve)));
    await act(async () => {
      const first = result.current.copy();
      const second = result.current.copy();
      answerMint(new Response(JSON.stringify({ code: "MINTED234" }), { status: 201 }));
      await Promise.all([first, second]);
    });
    expect(posts(fetchMock)).toHaveLength(1);
    expect(writeText).toHaveBeenLastCalledWith(`${window.location.origin}/signup?code=MINTED234`);
  });

  // The pending mint is shared, so if a failed one stayed held every retry
  // would read its failure again and never ask the server.
  it("mints again on a copy after a failed mint", async () => {
    const fetchMock = serve({ earnsReward: true, mint: 500 });
    const { result } = renderHook(() => useReferralLink());
    await waitFor(() => expect(result.current.earns).toBe(true));
    await act(() => result.current.copy());
    await act(() => result.current.copy());
    expect(posts(fetchMock)).toHaveLength(2);
  });

  it("says the codes are all out when the server refuses at the cap, and copies nothing", async () => {
    serve({ earnsReward: true, mint: 409 });
    const { result } = renderHook(() => useReferralLink());
    await waitFor(() => expect(result.current.earns).toBe(true));
    await act(() => result.current.copy());
    expect(result.current.status).toBe("full");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("hands the link back to show when the clipboard is denied", async () => {
    serve({ earnsReward: true, codes: [{ code: "OPEN23456", redeemed: false }] });
    writeText.mockRejectedValueOnce(new Error("denied"));
    const { result } = renderHook(() => useReferralLink());
    await waitFor(() => expect(result.current.earns).toBe(true));
    await act(() => result.current.copy());
    expect(result.current.status).toBe("denied");
    expect(result.current.link).toBe(`${window.location.origin}/signup?code=OPEN23456`);
  });
});
