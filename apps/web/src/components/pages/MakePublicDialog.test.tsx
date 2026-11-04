import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PageShare } from "@tc/contracts";

const fetchPublishPreview = vi.fn();
const fetchPageShares = vi.fn();
const createPageShare = vi.fn();
const revokePageShare = vi.fn();

vi.mock("@/lib/pagesClient", () => ({
  fetchPublishPreview: (...args: unknown[]) => fetchPublishPreview(...args),
  fetchPageShares: (...args: unknown[]) => fetchPageShares(...args),
  createPageShare: (...args: unknown[]) => createPageShare(...args),
  revokePageShare: (...args: unknown[]) => revokePageShare(...args),
}));

vi.mock("@/lib/publicNotebookLink", () => ({ publicNotebookLink: (token: string) => `http://test/n/${token}` }));

import { MakePublicDialog } from "./MakePublicDialog";

const TRIP = "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f";
const PAGE = "11111111-1111-4111-8111-111111111111";
const SIDE = "22222222-2222-4222-8222-222222222222";

const share = (overrides: Partial<PageShare> = {}): PageShare => ({
  shareId: "33333333-3333-4333-8333-333333333333",
  tripId: TRIP,
  pageId: PAGE,
  token: "live-token",
  createdBy: "dev-alice",
  createdAt: "2026-11-04T00:00:00.000Z",
  revokedAt: null,
  ...overrides,
});

const preview = {
  view: {
    title: "Itinerary",
    content: [{ type: "paragraph", content: [{ type: "text", text: "What a stranger reads" }] }],
    accents: { cities: {}, days: {} },
  },
  plainText: ["Sam's surprise", "Map"],
  alsoPublic: [{ pageId: SIDE, title: "Sam's surprise" }],
};

const writeText = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  fetchPublishPreview.mockReset().mockResolvedValue({ ok: true, value: preview });
  fetchPageShares.mockReset().mockResolvedValue({ ok: true, value: [] });
  createPageShare.mockReset().mockImplementation(async (_trip: string, pageId: string) => ({
    ok: true,
    value: share({ pageId, token: pageId === PAGE ? "page-token" : "side-token" }),
  }));
  revokePageShare.mockReset().mockResolvedValue({ ok: true, value: share({ revokedAt: "now" }) });
  writeText.mockClear();
  Object.assign(navigator, { clipboard: { writeText } });
});
afterEach(cleanup);

function mount(onChange = vi.fn(), onOpenChange = vi.fn()) {
  render(<MakePublicDialog tripId={TRIP} pageId={PAGE} title="Itinerary" open onOpenChange={onOpenChange} onChange={onChange} />);
  return { onChange, onOpenChange };
}

describe("MakePublicDialog", () => {
  it("shows what a stranger reads, what turns to plain text, and ticks nothing", async () => {
    mount();
    const stranger = await screen.findByRole("region", { name: "What a stranger sees" });
    expect(within(stranger).getByText("What a stranger reads")).toBeTruthy();
    const plain = screen.getByRole("list", { name: "Shown as plain text" });
    expect(within(plain).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Sam's surprise", "Map"]);
    expect((screen.getByRole("checkbox", { name: "Sam's surprise" }) as HTMLInputElement).checked).toBe(false);
  });

  it("publishes only what was ticked, then shows the link and copies it", async () => {
    const { onChange } = mount();
    await userEvent.click(await screen.findByRole("button", { name: "Make public" }));
    await screen.findByRole("textbox", { name: "Public link" });
    expect(createPageShare.mock.calls.map((c) => c[1])).toEqual([PAGE]);
    expect(onChange).toHaveBeenCalledWith("page-token");
    expect((screen.getByRole("textbox", { name: "Public link" }) as HTMLInputElement).value).toBe("http://test/n/page-token");

    await userEvent.click(screen.getByRole("button", { name: "Copy link" }));
    expect(writeText).toHaveBeenCalledWith("http://test/n/page-token");
  });

  it("makes a ticked notebook public too, before this one", async () => {
    mount();
    await userEvent.click(await screen.findByRole("checkbox", { name: "Sam's surprise" }));
    await userEvent.click(screen.getByRole("button", { name: "Make public" }));
    await screen.findByRole("textbox", { name: "Public link" });
    expect(createPageShare.mock.calls.map((c) => c[1])).toEqual([SIDE, PAGE]);
  });

  it("opens straight on the link when the page is already public, and fetches no preview", async () => {
    fetchPageShares.mockResolvedValue({ ok: true, value: [share({ token: "old", revokedAt: "then" }), share()] });
    mount();
    expect(((await screen.findByRole("textbox", { name: "Public link" })) as HTMLInputElement).value).toBe("http://test/n/live-token");
    expect(fetchPublishPreview).not.toHaveBeenCalled();
  });

  it("shows the existing link when the server answers a publish with one it already had", async () => {
    createPageShare.mockResolvedValue({ ok: true, value: share({ token: "already-live" }) });
    mount();
    await userEvent.click(await screen.findByRole("button", { name: "Make public" }));
    expect(((await screen.findByRole("textbox", { name: "Public link" })) as HTMLInputElement).value).toBe("http://test/n/already-live");
  });

  it("makes private by revoking that link, and says so", async () => {
    fetchPageShares.mockResolvedValue({ ok: true, value: [share()] });
    const { onChange, onOpenChange } = mount();
    await userEvent.click(await screen.findByRole("button", { name: "Make private" }));
    await waitFor(() => expect(revokePageShare).toHaveBeenCalledWith(TRIP, PAGE, share().shareId));
    expect(onChange).toHaveBeenCalledWith(null);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("keeps the dialog on its words when publishing is refused", async () => {
    createPageShare.mockResolvedValue({ ok: false, error: { status: 422, message: "This notebook can't be made public." } });
    const { onChange } = mount();
    await userEvent.click(await screen.findByRole("button", { name: "Make public" }));
    expect((await screen.findByRole("alert")).textContent).toContain("can't be made public");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("says which notebooks are already public when a later one fails, and stops offering them", async () => {
    const OTHER = "44444444-4444-4444-8444-444444444444";
    fetchPublishPreview.mockResolvedValue({
      ok: true,
      value: { ...preview, alsoPublic: [{ pageId: SIDE, title: "Sam's surprise" }, { pageId: OTHER, title: "Packing" }] },
    });
    createPageShare.mockImplementation(async (_trip: string, pageId: string) =>
      pageId === OTHER
        ? { ok: false, error: { status: 500, message: "Try again." } }
        : { ok: true, value: share({ pageId, token: "side-token" }) },
    );
    const { onChange } = mount();
    await userEvent.click(await screen.findByRole("checkbox", { name: "Sam's surprise" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Packing" }));
    await userEvent.click(screen.getByRole("button", { name: "Make public" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Sam's surprise is now public");
    expect(alert.textContent).toContain("Try again.");
    // The one that landed is no longer a choice; the one that did not is still ticked.
    expect(screen.queryByRole("checkbox", { name: "Sam's surprise" })).toBeNull();
    expect((screen.getByRole("checkbox", { name: "Packing" }) as HTMLInputElement).checked).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });
});
