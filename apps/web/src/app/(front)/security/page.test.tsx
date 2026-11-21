import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JsonLdNode } from "@/lib/jsonLd";

// The page's JSON-LD, captured as data rather than parsed out of a script tag.
const jsonLd = vi.fn<(data: JsonLdNode | JsonLdNode[]) => void>();
vi.mock("@/components/JsonLd", () => ({
  JsonLd: ({ data }: { data: JsonLdNode | JsonLdNode[] }) => {
    jsonLd(data);
    return null;
  },
}));

import SecurityPage, { metadata } from "./page";

afterEach(() => {
  cleanup();
  jsonLd.mockReset();
});

const HERE = path.dirname(fileURLToPath(import.meta.url));

describe("/security metadata", () => {
  it("keeps the title to 60 characters and the description to 160", () => {
    const title =
      typeof metadata.title === "object" && metadata.title !== null && "absolute" in metadata.title
        ? metadata.title.absolute
        : String(metadata.title);
    expect(title.length).toBeGreaterThan(0);
    expect(title.length).toBeLessThanOrEqual(60);
    expect(String(metadata.description).length).toBeGreaterThan(0);
    expect(String(metadata.description).length).toBeLessThanOrEqual(160);
  });

  it("has a canonical and an og:url for /security", () => {
    expect(metadata.alternates?.canonical).toBe("/security");
    expect(metadata.openGraph?.url).toBe("/security");
  });

  it("ships its own share image, with alt text", () => {
    expect(readFileSync(path.join(HERE, "opengraph-image.alt.txt"), "utf8").trim().length).toBeGreaterThan(0);
    expect(readFileSync(path.join(HERE, "opengraph-image.png")).length).toBeGreaterThan(0);
  });

  // The picture reads "Your account, your data" over "Security at Caesura"; the alt must say the same.
  it("describes the image it ships: the file's alt and the metadata's agree, and name no AI line the picture lacks", () => {
    const alt = readFileSync(path.join(HERE, "opengraph-image.alt.txt"), "utf8").trim();
    const images = metadata.openGraph?.images;
    const first = Array.isArray(images) ? images[0] : images;
    expect(typeof first === "object" && first !== null && "alt" in first ? first.alt : undefined).toBe(alt);
    expect(alt).not.toContain("AI");
  });
});

describe("/security structured data", () => {
  it("is a WebPage plus a FAQPage whose questions are the visible ones", () => {
    render(<SecurityPage />);
    const nodes = jsonLd.mock.calls[0]![0] as JsonLdNode[];
    expect(nodes.map((node) => node["@type"])).toEqual(["WebPage", "FAQPage"]);

    const visible = within(screen.getByRole("region", { name: "Questions" }))
      .getAllByRole("heading", { level: 3 })
      .map((h) => h.textContent);
    const marked = (nodes[1]!.mainEntity as { name: string }[]).map((q) => q.name);
    expect(visible.length).toBeGreaterThan(0);
    expect(marked).toEqual(visible);
  });
});
