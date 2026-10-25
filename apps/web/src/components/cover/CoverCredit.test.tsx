import { fireEvent, render, screen } from "@testing-library/react";
import { tripCoverFactory } from "@tc/factories";
import { describe, expect, it } from "vitest";
import { CoverCredit } from "./CoverCredit";
import { CoverImage } from "./CoverImage";

const REFERRAL = "utm_source=caesura&utm_medium=referral";

describe("CoverCredit", () => {
  it("credits the photographer and Unsplash, both linked with the referral, each in a new tab", () => {
    render(<CoverCredit photo={tripCoverFactory.build({ photographerName: "Aiko Tanaka", photographerUrl: "https://unsplash.com/@aiko" })} />);

    expect(screen.getByText((_, el) => el?.tagName === "P" && el.textContent === "Photo by Aiko Tanaka on Unsplash")).toBeTruthy();
    const photographer = screen.getByRole("link", { name: "Aiko Tanaka" });
    const unsplash = screen.getByRole("link", { name: "Unsplash" });
    expect(photographer.getAttribute("href")).toBe(`https://unsplash.com/@aiko?${REFERRAL}`);
    expect(unsplash.getAttribute("href")).toBe(`https://unsplash.com/?${REFERRAL}`);
    for (const link of [photographer, unsplash]) {
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noopener");
    }
  });

  // A stored credit is shown to everyone on the trip; a link off Unsplash
  // must not become one, whatever got past the write.
  it("links Unsplash itself, not a stored URL that is off unsplash.com", () => {
    render(<CoverCredit photo={tripCoverFactory.build({ photographerName: "Mallory", photographerUrl: "javascript:alert(1)" })} />);
    expect(screen.getByRole("link", { name: "Mallory" }).getAttribute("href")).toBe(`https://unsplash.com/?${REFERRAL}`);
  });

  // A URL cover credits whoever the API named, and never Unsplash.
  it("credits a URL cover's named source, linked only when its link is http(s)", () => {
    const { unmount } = render(
      <CoverCredit photo={{ source: "url", credit: { name: "Port of Leith", url: "https://leith.example/photos" }, proxySrc: "/api/cover-image?u=a" }} />,
    );
    expect(screen.getByText((_, el) => el?.tagName === "P" && el.textContent === "Photo by Port of Leith")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Port of Leith" }).getAttribute("href")).toBe("https://leith.example/photos");
    expect(screen.queryByRole("link", { name: "Unsplash" })).toBeNull();
    unmount();
    render(<CoverCredit photo={{ source: "url", credit: { name: "Mallory", url: "javascript:alert(1)" }, proxySrc: "/api/cover-image?u=b" }} />);
    expect(screen.getByText("Mallory")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  // Decision 7's fallback box shows no photo, so it credits none.
  it("disappears with a photo that fails to load, and with a URL cover that has nothing to load", () => {
    const cover = tripCoverFactory.build();
    const { unmount } = render(
      <>
        <CoverImage photo={cover} sizes="100vw" />
        <CoverCredit photo={cover} />
      </>,
    );
    expect(screen.getByRole("link", { name: "Unsplash" })).toBeTruthy();
    fireEvent.error(screen.getByRole("img"));
    expect(screen.queryByRole("link", { name: "Unsplash" })).toBeNull();
    unmount();
    render(<CoverCredit photo={{ source: "url", credit: { name: "Port of Leith", url: null } }} />);
    expect(screen.queryByText("Port of Leith")).toBeNull();
  });

  // A failure is usually a dropped connection, not a deleted photo: the next
  // image of that src to load, here a remount retrying it, brings both back.
  it("comes back with its photo once an image of that src loads after failing", () => {
    const cover = tripCoverFactory.build({ photographerName: "Aiko Tanaka" });
    const { unmount } = render(<CoverImage photo={cover} sizes="100vw" />);
    fireEvent.error(screen.getByRole("img"));
    unmount();
    render(
      <>
        <CoverImage photo={cover} sizes="100vw" />
        <CoverCredit photo={cover} />
      </>,
    );
    expect(screen.queryByRole("link", { name: "Aiko Tanaka" })).toBeNull();
    fireEvent.load(screen.getByRole("img", { hidden: true }));
    expect(screen.getByRole("img")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Aiko Tanaka" })).toBeTruthy();
  });
});
