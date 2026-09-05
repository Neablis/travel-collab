import type React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Badge } from "./badge";
import { Button } from "./button";
import { DataText } from "./data-text";
import { Heading } from "./heading";
import { Input } from "./input";
import { NativeSelect } from "./native-select";

describe("ui primitives", () => {
  it("Heading renders the semantic tag in the display face", () => {
    render(<Heading level={2}>Trips</Heading>);
    // No `expect(h.tagName).toBe("H2")` — the `level: 2` query above already
    // resolves by heading level, so asserting the tag name after it restates
    // the query and cannot fail independently.
    const h = screen.getByRole("heading", { level: 2, name: "Trips" });
    expect(h.className).toContain("font-display");
  });

  // `Button` exposes its variant only as classes — there is no `data-variant`
  // to assert against, so the choice was between three literal token
  // assertions (`bg-brand`, `bg-danger`, ...) that break on every restyle, and
  // deleting the test, which would leave "the variant prop is wired at all"
  // unguarded. Asserting the three are *distinct*, with the default equal to
  // secondary, catches the regression that actually happens — a variant
  // silently ignored or collapsed onto the default — and survives a retoken.
  it("Button gives each variant its own appearance, and defaults to secondary", () => {
    const classesFor = (node: React.ReactElement): string => {
      const { unmount, container } = render(node);
      // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
      const cls = container.querySelector("button")!.className;
      unmount();
      return cls;
    };

    const fallback = classesFor(<Button>Edit trip</Button>);
    const secondary = classesFor(<Button variant="secondary">Edit trip</Button>);
    const primary = classesFor(<Button variant="primary">Add activity</Button>);
    const destructive = classesFor(<Button variant="destructive">Remove</Button>);

    expect(fallback).toBe(secondary);
    expect(new Set([secondary, primary, destructive]).size).toBe(3);
  });

  // SPEC §13.1: "44px targets, always ... Chips grow by `min-height`, never by
  // font size — the type scale is shared with desktop." Both halves are the
  // assertion. A `touch` built as a fixed `h-11` satisfies the first reading and
  // clips a wrapped two-line phone label; one built by bumping the font
  // satisfies neither.
  it("Button's touch size is a 44px floor in both axes, at md's type scale", () => {
    const classesForSize = (size: "md" | "touch"): string => {
      const { unmount } = render(<Button size={size}>Save</Button>);
      const cls = screen.getByRole("button", { name: "Save" }).className;
      unmount();
      return cls;
    };
    const touch = classesForSize("touch");
    const md = classesForSize("md");

    expect(touch).toContain("min-h-11");
    expect(touch).toContain("min-w-11");
    // No fixed height at all: `min-h-11` is only a floor if nothing pins the
    // box, and every hand-rolled 44px call site today has to write `h-auto`
    // first to undo exactly this.
    expect(touch.split(" ").filter((c) => /^h-/.test(c))).toEqual([]);

    // Compared against `md` rather than pinned to a literal, so it survives a
    // retoken and still catches the divergence — the control grows, the font
    // does not.
    const typeScale = (cls: string) => cls.split(" ").find((c) => /^text-(xs|sm|base|md|lg|xl|2xl)$/.test(c));
    expect(typeScale(md)).toBeDefined();
    expect(typeScale(touch)).toBe(typeScale(md));
  });

  it("Badge maps semantic variants to tint + ink pairs (conflicts are warning)", () => {
    render(<Badge variant="warning">2 conflicts</Badge>);
    const b = screen.getByText("2 conflicts");
    expect(b.className).toContain("bg-warning-tint");
    expect(b.className).toContain("text-warning-ink");
  });

  it("DataText is mono; Input and NativeSelect are native elements with the input border", () => {
    render(
      <>
        <DataText>18:00–20:00</DataText>
        <Input aria-label="Trip name" />
        <NativeSelect aria-label="Currency"><option>USD</option></NativeSelect>
      </>,
    );
    expect(screen.getByText("18:00–20:00").className).toContain("font-mono");
    expect(screen.getByLabelText("Trip name").tagName).toBe("INPUT");
    expect(screen.getByLabelText("Currency").tagName).toBe("SELECT");
    expect(screen.getByLabelText("Trip name").className).toContain("border-border-input");
  });
});
