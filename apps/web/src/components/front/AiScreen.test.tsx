import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DevelopersScreen } from "./DevelopersScreen";
import { AI_FAQ, AiScreen } from "./AiScreen";
import { metadata } from "@/app/(front)/ai/page";

afterEach(cleanup);

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../app");

/** Every URL path the app serves with a `page.tsx` or `route.ts`, route groups dropped. */
function servedPaths(): Set<string> {
  const out = new Set<string>();
  const walk = (dir: string, segments: string[]): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        // Under `playbooks`, `[copy]` and `live` are the library's two renderings
        // of one URL tree (the proxy picks by session), not segments a visitor types.
        const inPlaybooks = segments[0] === "playbooks";
        const hidden =
          (entry.name.startsWith("(") && entry.name.endsWith(")")) ||
          (inPlaybooks && (entry.name === "[copy]" || entry.name === "live"));
        walk(path.join(dir, entry.name), hidden ? segments : [...segments, entry.name]);
      } else if (entry.name === "route.ts" || entry.name === "page.tsx") {
        out.add(`/${segments.join("/")}`);
      }
    }
  };
  walk(APP, []);
  return out;
}

// `/developers`' tab order, then the generic MCP client.
const PROMPT_TOOLS = ["Claude", "Gemini CLI", "Muse", "script", "MCP client"];

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
      "API tokens",
    ]) {
      expect(text, name).toContain(name);
    }
  });

  it("lists the MCP server and Poppy first in Ways in, as the generic ways", () => {
    render(<AiScreen />);
    const items = within(screen.getByRole("region", { name: "Ways in" })).getAllByRole("listitem");
    expect(items[0]!.textContent).toContain("MCP server");
    expect(items[1]!.textContent).toContain("Poppy");
  });

  // The external review of PR 788: a token-based tool (a script, say)
  // is listed under API tokens, not Connected apps, so naming only the second
  // sent a person to a list their tool is not on.
  it("names API tokens next to Connected apps, in the safety line too", () => {
    render(<AiScreen />);
    expect(screen.getByRole("region", { name: "Safe by design" }).textContent).toContain("API tokens");
  });

  it("links the playbook library for a reader who wants to see what a playbook is", () => {
    render(<AiScreen />);
    expect(screen.getByRole("link", { name: /playbook/i }).getAttribute("href")).toBe("/playbooks");
  });

  // ConsentScreen ticks every read scope and no write scope, Notebook's included.
  it("says reading starts ticked and anything that changes your data, Notebook included, starts unticked", () => {
    render(<AiScreen />);
    const faq = screen.getByRole("region", { name: "Questions" }).textContent ?? "";
    expect(faq).toContain("Reading starts ticked; anything that changes your data, Notebook included, starts unticked");
    expect(faq).not.toContain("switched off");
  });

  // Decision 1's target phrases, said once in plain words near the top. The
  // title, H1 and this sentence are words Mitchell approves on the preview.
  it("says what Caesura is, in the words people search, near the top and with no em dash", () => {
    render(<AiScreen />);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toContain("AI trip planner");
    const top = h1.parentElement?.textContent ?? "";
    for (const phrase of ["Claude trip planning", "trip planner MCP server", "travel planning API"]) {
      expect(top, phrase).toContain(phrase);
    }
    expect(top).not.toContain("—");
    const title = metadata.title as { absolute: string };
    expect(title.absolute).toContain("AI trip planner");
    expect(title.absolute).not.toContain("—");
  });

  it("has exactly one h1", () => {
    render(<AiScreen />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("gives one prompt per tool, each linking to its connect section, in the tab order", () => {
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
    const ids = new Set([...screen.getAllByRole("region", { hidden: true }), ...screen.getAllByRole("heading", { hidden: true })].map((el) => el.id));
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

  // The walk of PR 788 asked for lists that stand out: each question is an item
  // of one list, so a screen reader counts them and each can be set apart.
  it("lists the FAQ as one item per question, each headed by it", () => {
    render(<AiScreen />);
    const faq = within(screen.getByRole("region", { name: "Questions" }));
    const items = faq.getAllByRole("listitem");
    expect(items.map((item) => within(item).getByRole("heading", { level: 3 }).textContent)).toEqual(
      AI_FAQ.map(({ question }) => question),
    );
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

  // M63 D15 (Mitchell, 2026-11-22): ChatGPT was cut. The FAQ is the source of
  // the FAQPage JSON-LD, so it is read here as well as the page and its metadata.
  it("names no ChatGPT in its text, its links, its metadata or its FAQ", () => {
    render(<AiScreen />);
    expect(document.body.textContent).toContain("Gemini");
    expect(document.body.innerHTML).not.toMatch(/chatgpt/i);
    expect(JSON.stringify(metadata)).not.toMatch(/chatgpt/i);
    expect(JSON.stringify(AI_FAQ)).not.toMatch(/chatgpt/i);
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
      "OVHcloud",
      "Netcup",
      "Umami",
      "Plausible",
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
