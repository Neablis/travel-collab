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
    const h = screen.getByRole("heading", { level: 2, name: "Trips" });
    expect(h.tagName).toBe("H2");
    expect(h.className).toContain("font-display");
  });

  it("Button defaults to secondary; primary carries brand; destructive carries danger", () => {
    const { rerender } = render(<Button>Edit trip</Button>);
    expect(screen.getByRole("button", { name: "Edit trip" }).className).toContain("border-border-strong");
    rerender(<Button variant="primary">Add activity</Button>);
    expect(screen.getByRole("button", { name: "Add activity" }).className).toContain("bg-brand");
    rerender(<Button variant="destructive">Remove</Button>);
    expect(screen.getByRole("button", { name: "Remove" }).className).toContain("bg-danger");
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
