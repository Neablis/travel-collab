import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoverImage, coverSrc } from "./CoverImage";

const unsplash = {
  urls: {
    raw: "https://images.unsplash.com/photo-1?ixid=abc",
    regular: "https://images.unsplash.com/photo-1?ixid=abc&w=1080",
    small: "https://images.unsplash.com/photo-1?ixid=abc&w=400",
  },
  alt: "Maples over a temple roof",
  photographerName: "Aiko Tanaka",
};

describe("CoverImage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("hotlinks Unsplash's own URLs, sized through imgix on the raw one", () => {
    render(<CoverImage photo={unsplash} sizes="100vw" />);
    const img = screen.getByRole("img", { name: "Maples over a temple roof" });
    expect(img.getAttribute("src")).toBe(unsplash.urls.regular);
    expect(img.getAttribute("srcset")?.split(", ")[0]).toBe(
      "https://images.unsplash.com/photo-1?ixid=abc&w=400&q=80&fm=jpg&fit=crop 400w",
    );
  });

  it("starts the imgix query on a raw URL that has none", () => {
    expect(coverSrc("/offline-covers/dunes.svg", 800)).toBe("/offline-covers/dunes.svg?w=800&q=80&fm=jpg&fit=crop");
  });

  // Unsplash sends both `null` and `""` for a photo nobody described.
  it.each([null, ""])("says who took the photo when Unsplash's description is %j", (alt) => {
    render(<CoverImage photo={{ ...unsplash, alt }} sizes="100vw" />);
    expect(screen.getByRole("img", { name: "Photo by Aiko Tanaka" })).toBeTruthy();
  });

  it("loads lazily unless it is told it is above the fold", () => {
    const { unmount } = render(<CoverImage photo={unsplash} sizes="100vw" />);
    expect(screen.getByRole("img").getAttribute("loading")).toBe("lazy");
    unmount();
    render(<CoverImage photo={unsplash} sizes="100vw" eager />);
    expect(screen.getByRole("img").getAttribute("loading")).toBe("eager");
  });

  // Decision 9: one vertical value frames the photo on every surface.
  it("frames the photo at its stored vertical position", () => {
    render(<CoverImage photo={{ ...unsplash, position: 30 }} sizes="100vw" />);
    expect(screen.getByRole("img").style.objectPosition).toBe("center 30%");
  });

  // Decision 7: a photo that fails to load leaves the plain box, not a broken image.
  // Failures are remembered per src for the tab, so each failing test has its own.
  it("drops a photo that fails to load and keeps what is laid over it", () => {
    render(
      <CoverImage photo={{ ...unsplash, urls: { ...unsplash.urls, regular: "https://images.unsplash.com/gone-1" } }} sizes="100vw">
        <button type="button">Menu</button>
      </CoverImage>,
    );
    fireEvent.error(screen.getByRole("img"));
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByRole("button", { name: "Menu" })).toBeTruthy();
  });

  // ADR-081: a browser reads a URL cover from our origin only, never from `url`.
  it("loads a URL cover from its proxy path alone, and shows none without one", () => {
    const cover = { source: "url", alt: "A harbour at dusk", position: 50 } as const;
    const { unmount } = render(<CoverImage photo={{ ...cover, proxySrc: "/api/cover-image?u=x&s=y" }} sizes="100vw" />);
    const img = screen.getByRole("img", { name: "A harbour at dusk" });
    expect(img.getAttribute("src")).toBe("/api/cover-image?u=x&s=y");
    expect(img.getAttribute("srcset")).toBeNull();
    unmount();
    render(<CoverImage photo={cover} sizes="100vw" />);
    expect(screen.queryByRole("img")).toBeNull();
  });

  // M54 part 4: a photo fades in when it arrives rather than painting in rows.
  // `data-loaded` is what its opacity is keyed on.
  it("starts hidden and is shown once its photo has loaded", () => {
    render(<CoverImage photo={unsplash} sizes="100vw" />);
    const img = screen.getByRole("img");
    expect(img.hasAttribute("data-loaded")).toBe(false);
    fireEvent.load(img);
    expect(img.hasAttribute("data-loaded")).toBe(true);
  });

  // React attaches `onLoad` at hydration and does not replay one that fired
  // before it, so a server-rendered photo already in would stay hidden.
  it("is shown at once when its photo had loaded before it mounted", () => {
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
    vi.spyOn(HTMLImageElement.prototype, "currentSrc", "get").mockReturnValue("https://images.unsplash.com/requested");
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(1200);
    render(<CoverImage photo={unsplash} sizes="100vw" />);
    expect(screen.getByRole("img").hasAttribute("data-loaded")).toBe(true);
  });

  // A server-rendered photo can arrive long before a slow phone hydrates, and
  // hiding it until then left the first row of cards blank with the photo in.
  // So the server's copy is never hidden, and hydrating it does not hide one
  // still on the way either.
  it("shows a server-rendered photo in the HTML and keeps it shown through hydration", async () => {
    // Requested, so the browser may already be painting it.
    vi.spyOn(HTMLImageElement.prototype, "currentSrc", "get").mockReturnValue("https://images.unsplash.com/requested");
    const host = document.createElement("div");
    host.innerHTML = renderToString(<CoverImage photo={unsplash} sizes="100vw" />);
    document.body.append(host);
    try {
      expect(within(host).getByRole("img").hasAttribute("data-loaded")).toBe(true);
      let root: Root | undefined;
      await act(async () => {
        root = hydrateRoot(host, <CoverImage photo={unsplash} sizes="100vw" />);
      });
      expect(within(host).getByRole("img").hasAttribute("data-loaded")).toBe(true);
      act(() => root?.unmount());
    } finally {
      document.body.replaceChildren();
    }
  });

  // A lazy cover below the fold has painted nothing at hydration, so hiding it
  // cannot flash, and it fades in on scroll like one the client mounted.
  it("fades in a server-rendered lazy photo the browser had not requested at hydration", async () => {
    vi.spyOn(HTMLImageElement.prototype, "currentSrc", "get").mockReturnValue("");
    const host = document.createElement("div");
    host.innerHTML = renderToString(<CoverImage photo={unsplash} sizes="100vw" />);
    document.body.append(host);
    try {
      let root: Root | undefined;
      await act(async () => {
        root = hydrateRoot(host, <CoverImage photo={unsplash} sizes="100vw" />);
      });
      const img = within(host).getByRole("img");
      expect(img.hasAttribute("data-loaded")).toBe(false);
      fireEvent.load(img);
      expect(img.hasAttribute("data-loaded")).toBe(true);
      act(() => root?.unmount());
    } finally {
      document.body.replaceChildren();
    }
  });

  // A server-rendered photo can fail before hydration, and React attaches
  // `onError` only then, without replaying it: the box must still fall back.
  it("drops a photo that had already failed when it mounted, and keeps one that had loaded", () => {
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
    vi.spyOn(HTMLImageElement.prototype, "currentSrc", "get").mockReturnValue("https://images.unsplash.com/requested");
    const naturalWidth = vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(1200);
    const { unmount } = render(<CoverImage photo={unsplash} sizes="100vw" />);
    expect(screen.getByRole("img")).toBeTruthy();
    unmount();
    naturalWidth.mockReturnValue(0);
    render(<CoverImage photo={{ ...unsplash, urls: { ...unsplash.urls, regular: "https://images.unsplash.com/gone-2" } }} sizes="100vw" />);
    expect(screen.queryByRole("img")).toBeNull();
  });

  // A lazy image the browser has not requested yet has no width either. If a
  // browser called it complete, every cover below the fold would vanish.
  it("keeps a lazy photo the browser has not requested yet", () => {
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(0);
    vi.spyOn(HTMLImageElement.prototype, "currentSrc", "get").mockReturnValue("");
    render(<CoverImage photo={{ ...unsplash, urls: { ...unsplash.urls, regular: "https://images.unsplash.com/deferred-1" } }} sizes="100vw" />);
    expect(screen.getByRole("img")).toBeTruthy();
  });

  // Coming back online asks again for every photo that failed, with a new
  // request: the old element only ever holds the failed one.
  it("asks again for a failed photo when the browser comes back online", () => {
    render(<CoverImage photo={{ ...unsplash, urls: { ...unsplash.urls, regular: "https://images.unsplash.com/blip-1" } }} sizes="100vw" />);
    fireEvent.error(screen.getByRole("img"));
    const failed = screen.getByRole("img", { hidden: true });
    fireEvent(window, new Event("online"));
    expect(screen.getByRole("img")).not.toBe(failed);
  });

  // On a phone a `notOnPhone` image loads the blank GIF, not the photo, so its
  // load says nothing about whether the photo is back.
  it("keeps a failed photo hidden when a phone's blank stand-in loads", () => {
    const photo = { ...unsplash, urls: { ...unsplash.urls, regular: "https://images.unsplash.com/blank-1" } };
    render(
      <>
        <CoverImage photo={photo} sizes="100vw" />
        <CoverImage photo={photo} sizes="100vw" notOnPhone />
      </>,
    );
    fireEvent.error(screen.getAllByRole("img")[0]!);
    vi.spyOn(HTMLImageElement.prototype, "currentSrc", "get").mockReturnValue(
      "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
    );
    fireEvent.load(screen.getAllByRole("img", { hidden: true })[1]!);
    expect(screen.queryAllByRole("img")).toHaveLength(0);
  });

  // Only a copy that failed holds a dead request; the copy that loaded is kept,
  // not remounted, so the photo does not blink as it comes back.
  it("asks again from the copy that failed and keeps the copy that loaded", () => {
    const photo = { ...unsplash, urls: { ...unsplash.urls, regular: "https://images.unsplash.com/blip-2" } };
    render(
      <>
        <CoverImage photo={photo} sizes="100vw" />
        <CoverImage photo={photo} sizes="100vw" />
      </>,
    );
    fireEvent.error(screen.getAllByRole("img")[0]!);
    const [failed, loaded] = screen.getAllByRole("img", { hidden: true });
    fireEvent.load(loaded!);
    const [retried, kept] = screen.getAllByRole("img");
    expect(kept).toBe(loaded);
    expect(retried).not.toBe(failed);
  });
});
