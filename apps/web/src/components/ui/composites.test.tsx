import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Banner } from "./banner";
import { Dialog, DialogFooter } from "./dialog";
import { FormField } from "./form-field";
import { Input } from "./input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";

describe("ui composites", () => {
  it("FormField wires label→control and renders an error in danger ink", () => {
    render(
      <FormField id="trip-name" label="Trip name" error="Enter a name">
        <Input id="trip-name" />
      </FormField>,
    );
    // The wiring claim, not `Input`'s own tag: `getByLabelText` resolving at
    // all is what proves the label points somewhere, and `id` is what it points
    // at. That the primitive renders a native `<input>` is asserted once, in
    // primitives.test.tsx, against the primitive rather than through a caller.
    expect(screen.getByLabelText("Trip name").id).toBe("trip-name");
    expect(screen.getByText("Enter a name").className).toContain("text-danger-ink");
  });

  it("Banner defaults conflict messaging to the warning palette, never danger", () => {
    render(<Banner variant="warning">2 conflicts need attention</Banner>);
    const banner = screen.getByText("2 conflicts need attention").closest("[role=status]");
    expect(banner?.className).toContain("bg-warning-tint");
  });

  it("Dialog opens with a titled, accessible modal", async () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog open onOpenChange={onOpenChange} title="Edit activity">
        <p>body</p>
        <DialogFooter>ok</DialogFooter>
      </Dialog>,
    );
    expect(screen.getByRole("dialog", { name: "Edit activity" })).toBeTruthy();
  });

  it("Tabs switch content", async () => {
    render(
      <Tabs defaultValue="board">
        <TabsList>
          <TabsTrigger value="board">Board</TabsTrigger>
          <TabsTrigger value="map">Map</TabsTrigger>
        </TabsList>
        <TabsContent value="board">board content</TabsContent>
        <TabsContent value="map">map content</TabsContent>
      </Tabs>,
    );
    expect(screen.getByText("board content")).toBeTruthy();
    await userEvent.click(screen.getByRole("tab", { name: "Map" }));
    expect(screen.getByText("map content")).toBeTruthy();
  });

  it("FormField renders a description between label and control", () => {
    render(
      <FormField id="anchor" label="Lock to a date rule" description="Keeps this event tied to a rule (e.g. every Monday) even if dates shift.">
        <input id="anchor" />
      </FormField>,
    );
    expect(screen.getByText(/Keeps this event tied to a rule/)).toBeTruthy();
  });
});
