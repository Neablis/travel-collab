import { ViewTransition, type ReactElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { AppHeader } from "@/components/AppHeader";
import { PhoneTabBar } from "@/components/nav/PhoneTabBar";
import { AppShell } from "./AppShell";

/**
 * The elements from the shell's root down to the first one `match` accepts,
 * or `null`. `AppShell` calls no hook of its own, so its tree is read by
 * calling it rather than rendering it: what this file asserts is where each
 * piece sits, which is the whole of what decides what a route change fades.
 */
function pathTo(node: ReactNode, match: (element: ReactElement) => boolean): ReactElement[] | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = pathTo(child as ReactNode, match);
      if (found) return found;
    }
    return null;
  }
  if (node === null || typeof node !== "object" || !("props" in node)) return null;
  const element = node as ReactElement<{ children?: ReactNode; fallback?: ReactNode }>;
  if (match(element)) return [element];
  const below = pathTo(element.props.children, match);
  return below ? [element, ...below] : null;
}

const viewTransitionsOn = (path: ReactElement[]) =>
  path.filter((e) => e.type === ViewTransition).map((e) => (e.props as { name?: string }).name ?? "(page)");

const PAGE = <p>the page</p>;
const shell = AppShell({ noSessionCookie: true, served: null, children: PAGE });

// Decision 18 (ADR-082 §3): the page body cross-fades on a route change and
// the chrome around it holds still. If the boundary moved up a level the
// header would fade with every page; if it went, nothing would.
describe("AppShell's route cross-fade", () => {
  it("puts the page inside the view transition", () => {
    expect(viewTransitionsOn(pathTo(shell, (e) => e === PAGE) ?? [])).toEqual(["(page)"]);
  });

  it("names the header and the phone tab bar out of it, so they hold still", () => {
    expect(viewTransitionsOn(pathTo(shell, (e) => e.type === AppHeader) ?? [])).toEqual(["app-header"]);
    expect(viewTransitionsOn(pathTo(shell, (e) => e.type === PhoneTabBar) ?? [])).toEqual(["phone-tab-bar"]);
  });
});
