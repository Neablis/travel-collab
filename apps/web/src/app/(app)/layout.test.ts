import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

const served = vi.fn();
vi.mock("@/server/servedSession", () => ({ servedForApp: () => served() }));

import { EARLY_LOCK_SCRIPT } from "@/lib/pwaLock";
import AppLayout from "./layout";

/**
 * Every inline script in the layout's tree. A server component, so it is called
 * and its tree read, as `app/layout.test.ts` does, rather than rendered.
 */
async function inlineScripts(noSessionCookie: boolean): Promise<string[]> {
  served.mockResolvedValue({ noSessionCookie, served: null });
  const found: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node === null || typeof node !== "object") return;
    const element = node as ReactElement<{ children?: unknown; dangerouslySetInnerHTML?: { __html: string } }>;
    if (element.type === "script" && element.props.dangerouslySetInnerHTML) {
      found.push(element.props.dangerouslySetInnerHTML.__html);
    }
    walk(element.props?.children);
  };
  walk(await AppLayout({ children: null }));
  return found;
}

// The early lock hides the page until `PwaLockGate` shows it again. Without its
// script the server's paint shows under a cold lock; on a request with no session
// it would hide a page whose gate never locks, and leans on its fail-safe alone.
describe("(app) layout", () => {
  it("inlines the early lock for a request with a session", async () => {
    expect(await inlineScripts(false)).toEqual([EARLY_LOCK_SCRIPT]);
  });

  it("inlines no early lock for a request with no session cookie", async () => {
    expect(await inlineScripts(true)).toEqual([]);
  });
});
