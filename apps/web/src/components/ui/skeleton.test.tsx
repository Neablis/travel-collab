import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RegionError, Skeleton, SkeletonRegion } from "./skeleton";

afterEach(cleanup);

// §3b, in the handoff's own words: "Placeholders are outlines, never invented
// values — nothing on a loading page is ever mistaken for data."
describe("Skeleton — rule 3, outlines never fills", () => {
  it("draws a hairline outline and no background at all", () => {
    render(<Skeleton className="h-4 w-1/2" data-testid="sk" />);
    const el = screen.getByTestId("sk");
    expect(el.className).toContain("border-hairline");
    // The assertion that carries the rule: a `bg-*` here is a value the reader
    // never gave us, rendered as if they had.
    expect(el.className).not.toMatch(/\bbg-/);
  });

  it("is hidden from screen readers, so the region's own label is what is read", () => {
    render(<Skeleton className="h-4 w-8" data-testid="sk" />);
    expect(screen.getByTestId("sk").getAttribute("aria-hidden")).toBe("true");
  });

  it("carries the handoff's three stagger bands on data-sk", () => {
    render(
      <>
        <Skeleton className="h-2 w-2" data-testid="sk" />
        <Skeleton className="h-2 w-2" delay={2} data-testid="sk" />
        <Skeleton className="h-2 w-2" delay={3} data-testid="sk" />
      </>,
    );
    expect(screen.getAllByTestId("sk").map((n) => n.getAttribute("data-sk"))).toEqual(["1", "2", "3"]);
  });
});

// The wall that does not otherwise exist. The colour wall greps for raw hex and
// bracket values; a filled placeholder is neither, so `bg-hairline` on a
// `Skeleton` would ship clean and break rule 3 in silence on whichever surface
// reached for it first. This sweep is the enforcement.
describe("no call site fills a placeholder", () => {
  const SRC = join(import.meta.dirname, "..", "..");

  function tsxFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = join(dir, e.name);
      if (e.isDirectory()) return tsxFiles(full);
      return e.isFile() && full.endsWith(".tsx") ? [full] : [];
    });
  }

  it("passes no bg-* class to a Skeleton anywhere in apps/web/src", () => {
    const offenders: string[] = [];
    let callSites = 0;
    for (const file of tsxFiles(SRC)) {
      if (file.endsWith("skeleton.test.tsx")) continue;
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/<Skeleton\b[^>]*>/g)) {
        callSites += 1;
        if (/\bbg-[a-z]/.test(m[0])) offenders.push(`${file}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
    // Without this the sweep passes vacuously the day someone renames the
    // primitive, which is exactly when it would be needed.
    expect(callSites).toBeGreaterThan(0);
  });
});

describe("SkeletonRegion", () => {
  // §3b's claim is that regions arrive separately. One "Loading…" for a page
  // that is three-quarters painted is a lie to anyone who cannot see it.
  it("names the region it is standing in for", () => {
    render(
      <SkeletonRegion label="Loading your trips">
        <Skeleton className="h-4 w-8" />
      </SkeletonRegion>,
    );
    const region = screen.getByRole("status", { name: "Loading your trips" });
    expect(region.getAttribute("aria-busy")).toBe("true");
  });
});

describe("RegionError — rule 2, a retry in place", () => {
  it("says the rest of the page is still good, and retries on click", () => {
    const onRetry = vi.fn();
    render(<RegionError title="Your trips didn't load" onRetry={onRetry} />);
    expect(screen.getByRole("alert")).toBeTruthy();
    // Without this sentence a region-sized failure reads as a page-sized one,
    // and the reader reloads a page that is mostly fine.
    expect(screen.getByText(/Everything else on the page is current/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
