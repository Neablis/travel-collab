import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GET as securityTxt } from "../../app/.well-known/security.txt/route";
import { SECURITY_CONTACTS } from "@/lib/securityContacts";
import { AiScreen } from "./AiScreen";
import { DevelopersScreen } from "./DevelopersScreen";
import { SecurityScreen } from "./SecurityScreen";

afterEach(cleanup);

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../app");

/** Every URL path the app serves with a `page.tsx` or `route.ts`, route groups dropped. */
function servedPaths(): Set<string> {
  const out = new Set<string>();
  const walk = (dir: string, segments: string[]): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const group = entry.name.startsWith("(") && entry.name.endsWith(")");
        walk(path.join(dir, entry.name), group ? segments : [...segments, entry.name]);
      } else if (entry.name === "route.ts" || entry.name === "page.tsx") {
        out.add(`/${segments.join("/")}`);
      }
    }
  };
  walk(APP, []);
  return out;
}

/** The ids a screen renders on its sections and headings: what a `#anchor` can land on. */
function anchorsOf(target: React.ReactElement): Set<string> {
  render(target);
  const ids = new Set([...screen.getAllByRole("region"), ...screen.getAllByRole("heading")].map((el) => el.id));
  cleanup();
  return ids;
}

describe("SecurityScreen", () => {
  it("has exactly one h1", () => {
    render(<SecurityScreen />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("covers sign-in, what an AI can do, taking access back, data, and reporting, in that order", () => {
    render(<SecurityScreen />);
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual([
      "How you sign in",
      "What an AI tool or a token can do",
      "Taking access back",
      "Your data",
      "Reporting a vulnerability",
      "Questions",
    ]);
  });

  it("names Google, every second factor and the recovery codes", () => {
    render(<SecurityScreen />);
    const text = screen.getByRole("region", { name: "How you sign in" }).textContent!;
    for (const word of [
      "Google",
      "passkey",
      "Face ID",
      "Touch ID",
      "Windows Hello",
      "Android",
      "authenticator app",
      "recovery codes",
    ]) {
      expect(text, word).toContain(word);
    }
  });

  // A link that 404s or scrolls nowhere is worse than none.
  it("links only to routes that exist and anchors the target page renders", () => {
    const served = servedPaths();
    const anchors: Record<string, Set<string>> = {
      "/developers": anchorsOf(<DevelopersScreen tools={[]} />),
      "/ai": anchorsOf(<AiScreen />),
    };
    render(<SecurityScreen />);
    const hrefs = screen
      .getAllByRole("link")
      .map((link) => link.getAttribute("href")!)
      .filter((href) => href.startsWith("/"));
    expect(hrefs).toContain("/ai");
    expect(hrefs).toContain("/developers#scopes");
    for (const href of hrefs) {
      const [pathname, hash] = href.split("#");
      expect(served.has(pathname!), href).toBe(true);
      if (hash !== undefined) expect(anchors[pathname!]?.has(hash), href).toBe(true);
    }
  });

  it("names no certification or compliance programme", () => {
    render(<SecurityScreen />);
    const text = (document.body.textContent ?? "").toLowerCase();
    expect(text.length).toBeGreaterThan(0);
    for (const word of ["soc 2", "soc2", "iso 27001", "hipaa", "gdpr", "certified", "certification", "compliant"]) {
      expect(text, word).not.toContain(word);
    }
  });

  // The page says what is true for the person, never how Caesura is built (M63 D11).
  it("says nothing about how Caesura is built or run", () => {
    render(<SecurityScreen />);
    const text = (document.body.textContent ?? "").toLowerCase();
    expect(text.length).toBeGreaterThan(0);
    for (const word of [
      "strict-transport-security",
      "content-security-policy",
      "hsts",
      "csp",
      "neon",
      "hetzner",
      "coolify",
      "vercel",
      "cloudflare",
      "google cloud",
      "next.js",
      "react",
      "drizzle",
      "github",
      "repository",
    ]) {
      expect(text, word).not.toContain(word);
    }
  });

  it("says a token is stored as a fingerprint that cannot be turned back into it", () => {
    render(<SecurityScreen />);
    const data = screen.getByRole("region", { name: "Your data" });
    expect(data.textContent).toContain("fingerprint");
    expect(data.textContent).toContain("cannot be turned back");
  });

  it("shows the same contacts as security.txt, and no others", async () => {
    render(<SecurityScreen />);
    const reporting = within(screen.getByRole("region", { name: "Reporting a vulnerability" }));
    const shown = reporting.getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(shown).toEqual(SECURITY_CONTACTS.map((contact) => contact.href));
    const contactLines = (await securityTxt().text()).split("\n").filter((line) => line.startsWith("Contact: "));
    expect(contactLines).toEqual(shown.map((href) => `Contact: ${href}`));
  });
});
