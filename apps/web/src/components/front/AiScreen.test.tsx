import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DevelopersScreen } from "./DevelopersScreen";
import { AiScreen } from "./AiScreen";
import { metadata } from "@/app/(front)/ai/page";

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

const PROMPT_TOOLS = ["Claude", "MCP client", "ChatGPT", "Gemini", "Poppy", "script"];

describe("AiScreen", () => {
  it("names every surface a person can reach their AI through", () => {
    render(<AiScreen />);
    // The "Ways in" list, not the whole page: "Poppy" also names a prompt label.
    const text = screen.getByRole("region", { name: "Ways in" }).textContent ?? "";
    for (const name of [
      "assistant",
      "MCP server",
      "scoped tokens",
      "public API",
      "Poppy",
      "llms.txt",
      "agents.md",
      "Connected apps",
    ]) {
      expect(text, name).toContain(name);
    }
  });

  it("has exactly one h1", () => {
    render(<AiScreen />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("gives one prompt per tool, each linking to its connect section, Claude's first", () => {
    render(<AiScreen />);
    const prompts = within(screen.getByRole("region", { name: "Try asking" }));
    const items = prompts.getAllByRole("listitem");
    expect(items).toHaveLength(PROMPT_TOOLS.length);
    for (const [i, tool] of PROMPT_TOOLS.entries()) {
      const link = within(items[i]!).getByRole("link", { name: new RegExp(tool, "i") });
      expect(link.getAttribute("href"), tool).toMatch(/^\/developers#connect-[a-z]+$/);
    }
    expect(within(items[0]!).getByText("Turn my Lisbon trip into a three-day playbook and publish it.")).toBeDefined();
  });

  // Every internal link goes to a page that exists, or to an anchor the
  // developers page renders: a link that 404s or scrolls nowhere is worse than none.
  it("links only to routes that exist and anchors /developers renders", () => {
    const served = servedPaths();
    render(<AiScreen />);
    const hrefs = screen
      .getAllByRole("link")
      .map((link) => link.getAttribute("href")!)
      .filter((href) => href.startsWith("/"));
    expect(hrefs.length).toBeGreaterThan(PROMPT_TOOLS.length);
    cleanup();
    render(<DevelopersScreen tools={[]} />);
    // An anchor is an id on a section or a heading; read them off both.
    const ids = new Set([...screen.getAllByRole("region"), ...screen.getAllByRole("heading")].map((el) => el.id));
    for (const href of hrefs) {
      const [pathname, hash] = href.split("#");
      expect(served.has(pathname!), href).toBe(true);
      if (hash !== undefined) {
        expect(pathname, href).toBe("/developers");
        expect(ids.has(hash), href).toBe(true);
      }
    }
  });

  it("has no scope table of its own, and links to the one on /developers", () => {
    render(<AiScreen />);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("link", { name: /scopes/i }).getAttribute("href")).toBe("/developers#scopes");
  });

  it("states the safety line and points at Connected apps", () => {
    render(<AiScreen />);
    const safety = screen.getByRole("region", { name: "Safe by design" });
    expect(safety.textContent).toContain("can never do more than you can");
    expect(safety.textContent).toContain("Connected apps");
  });

  it("answers 'Is my data safe' in one line plus a link to /security", () => {
    render(<AiScreen />);
    const faq = within(screen.getByRole("region", { name: "Questions" }));
    const questions = faq.getAllByRole("heading", { level: 3 });
    expect(questions.length).toBeGreaterThanOrEqual(4);
    expect(questions.length).toBeLessThanOrEqual(5);
    expect(faq.getByRole("link", { name: /security/i }).getAttribute("href")).toBe("/security");
  });

  // One place for safety (M63 D12): /ai points at /security and does not restate it.
  it("leaves how sign-in and storage are protected to /security", () => {
    render(<AiScreen />);
    const text = (document.body.textContent ?? "").toLowerCase();
    expect(text.length).toBeGreaterThan(0);
    for (const word of ["passkey", "authenticator", "recovery code", "fingerprint", "encrypted", "vulnerab"]) {
      expect(text, word).not.toContain(word);
    }
  });

  it("says nothing about how Caesura is built", () => {
    render(<AiScreen />);
    const text = document.body.textContent ?? "";
    // The page metadata is public too, so the same words are barred from it.
    const meta = `${JSON.stringify(metadata.title)} ${String(metadata.description)}`;
    for (const word of [
      "github",
      "repository",
      "Neon",
      "Hetzner",
      "Coolify",
      "Vercel",
      "Next.js",
      "Scalar",
      "Strict-Transport-Security",
      "Content-Security-Policy",
    ]) {
      expect(text.toLowerCase(), word).not.toContain(word.toLowerCase());
      expect(meta.toLowerCase(), word).not.toContain(word.toLowerCase());
    }
    // Case-sensitive: the page names `agents.md`, the file, but never the repo's AGENTS.md.
    expect(text).not.toContain("AGENTS.md");
  });
});
