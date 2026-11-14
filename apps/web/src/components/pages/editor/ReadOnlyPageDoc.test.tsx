import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PageDoc, type PageMark } from "@tc/contracts";
import { PublicPageDoc, ReadOnlyPageDoc } from "./ReadOnlyPageDoc";

// KI-2026-11-05-b: the read-only renderers printed every text node bare, so
// what an editor made bold, italic or linked read as plain text to a viewer
// and to a stranger on the public page.

afterEach(cleanup);

function docOf(...runs: { text: string; marks?: PageMark[] }[]): PageDoc {
  return PageDoc.parse({
    type: "doc",
    content: [{ type: "paragraph", content: runs.map((run) => ({ type: "text", ...run })) }],
  });
}

describe("ReadOnlyPageDoc marks", () => {
  it("draws bold, italic and a link the way the editor wrote them", () => {
    render(
      <ReadOnlyPageDoc
        doc={docOf(
          { text: "loud", marks: [{ type: "bold" }] },
          { text: " and " },
          { text: "slanted", marks: [{ type: "italic" }] },
          { text: " see " },
          { text: "the map", marks: [{ type: "link", attrs: { href: "https://example.com/map" } }] },
        )}
      />,
    );
    expect(screen.getByText("loud").tagName).toBe("STRONG");
    expect(screen.getByText("slanted").tagName).toBe("EM");
    const link = screen.getByRole("link", { name: "the map" });
    expect(link.getAttribute("href")).toBe("https://example.com/map");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("nests marks on one run rather than keeping only the first", () => {
    render(<ReadOnlyPageDoc doc={docOf({ text: "both", marks: [{ type: "bold" }, { type: "italic" }] })} />);
    const text = screen.getByText("both");
    expect([text.tagName, text.parentElement?.tagName].sort()).toEqual(["EM", "STRONG"]);
  });

  it.each(["javascript:alert(1)", " JavaScript:alert(1)", "data:text/html,hi", "/relative", "vbscript:x"])(
    "keeps the text and drops a link whose href is %j",
    (href) => {
      render(<ReadOnlyPageDoc doc={docOf({ text: "click", marks: [{ type: "link", attrs: { href } }] })} />);
      expect(screen.getByText("click")).toBeTruthy();
      expect(screen.queryByRole("link")).toBeNull();
    },
  );

  it("links a mailto href", () => {
    render(
      <ReadOnlyPageDoc doc={docOf({ text: "write", marks: [{ type: "link", attrs: { href: "mailto:a@example.com" } }] })} />,
    );
    expect(screen.getByRole("link", { name: "write" }).getAttribute("href")).toBe("mailto:a@example.com");
  });
});

describe("PublicPageDoc marks", () => {
  // What `publicView.ts` ships: bare typographic marks, never a link's attrs.
  it("draws the bare bold and italic marks the server sends", () => {
    render(
      <PublicPageDoc
        doc={{
          accents: { cities: {}, days: {} },
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "loud", marks: [{ type: "bold" }] },
                { type: "text", text: "slanted", marks: [{ type: "italic" }] },
              ],
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("loud").tagName).toBe("STRONG");
    expect(screen.getByText("slanted").tagName).toBe("EM");
  });
});
