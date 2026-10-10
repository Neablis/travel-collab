import { describe, expect, it } from "vitest";
import { GET } from "./route";

/** The document as served for `origin`, split into its `Field: value` lines. */
async function fields(origin: string): Promise<Map<string, string[]>> {
  const res = GET(new Request(`${origin}/.well-known/security.txt`));
  expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  const out = new Map<string, string[]>();
  for (const line of (await res.text()).split("\n")) {
    const match = /^([A-Za-z-]+): (.+)$/.exec(line);
    if (match) out.set(match[1]!, [...(out.get(match[1]!) ?? []), match[2]!]);
  }
  return out;
}

describe("security.txt", () => {
  // RFC 9116 §2.5.3 and §2.5.5: Contact and Expires are the two required
  // fields, and an Expires a reader cannot parse is a file it must not trust.
  it("carries the required fields, with a parseable Expires", async () => {
    const doc = await fields("https://caesura.example");
    expect(doc.get("Contact")?.length).toBeGreaterThan(0);
    const [expires] = doc.get("Expires") ?? [];
    expect(Number.isNaN(Date.parse(expires ?? ""))).toBe(false);
  });

  it("sends vulnerabilities to email, then a private advisory, and other bugs to GitHub Issues", async () => {
    const doc = await fields("https://caesura.example");
    expect(doc.get("Contact")).toEqual([
      "mailto:mitchell@demarcosoftware.com",
      "https://github.com/Neablis/travel-collab/security/advisories/new",
      "https://github.com/Neablis/travel-collab/issues/new",
    ]);
  });

  it("names its own origin as canonical, so a preview does not claim production's", async () => {
    const doc = await fields("https://preview.example");
    expect(doc.get("Canonical")).toEqual(["https://preview.example/.well-known/security.txt"]);
  });
});
