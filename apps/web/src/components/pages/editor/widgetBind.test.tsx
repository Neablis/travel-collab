import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { tripDetailFixture } from "@tc/factories";
import { fieldChoices, type WidgetInput } from "@tc/pages";
import { WidgetBindControls, bindSummary, optionsFor } from "./widgetBind";

afterEach(cleanup);

// The `field` input's control (M14 field widget, build step 5). No registered
// widget declares one yet — T10 adds the first — so the widget here is a
// test-only declaration: `WidgetBindControls` takes its `inputs` from the
// caller, which is the same seam the insert step uses for a preset.
const FIELD: WidgetInput = { name: "field", type: "field", label: "Field", of: "stop" };
const detail = tripDetailFixture();

function Harness({ initial = {}, layout = "stacked" as const }: { initial?: Record<string, unknown>; layout?: "inline" | "stacked" }) {
  const [params, setParams] = useState<Record<string, unknown>>(initial);
  return (
    <>
      <WidgetBindControls
        name="cost"
        params={params}
        detail={detail}
        globals={null}
        onChange={setParams}
        layout={layout}
        idPrefix="t"
        inputs={[FIELD]}
        title="One stop's detail"
      />
      <output data-testid="params">{JSON.stringify(params)}</output>
    </>
  );
}

const stored = () => JSON.parse(screen.getByTestId("params").textContent ?? "{}") as Record<string, unknown>;

describe("optionsFor a field input", () => {
  it("offers the manifest's fields by label and group, and stores the path", () => {
    const options = optionsFor(FIELD, {}, detail, null);
    expect(options.map((o) => o.value)).toEqual(fieldChoices("stop").map((c) => c.path));
    expect(options.find((o) => o.value === "stop.cost")).toEqual({ value: "stop.cost", label: "Cost", group: "The stop" });
    // There is no "every field", so there is no "All" row to pick.
    expect(options.some((o) => o.value === "")).toBe(false);
  });

  it("keeps a stale path visible without printing it", () => {
    // Resolve-time validation means a removed field can still be in a
    // document; the control must say so rather than show the raw path.
    const options = optionsFor(FIELD, { field: "stop.gone" }, detail, null);
    const stale = options.find((o) => o.value === "stop.gone");
    expect(stale?.label).toBeDefined();
    expect(stale?.label).not.toContain("stop.gone");
  });

  it("summarises a bound field by its label", () => {
    expect(bindSummary("cost", { field: "stop.cost" }, detail, null, [FIELD])).toBe("Cost");
  });
});

describe("the field picker", () => {
  it("searches by label, groups the list, and writes the chosen path", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const box = screen.getByRole("combobox", { name: "One stop's detail: field" });
    await user.click(box);
    const list = screen.getByRole("listbox");
    // Grouped under the object's heading, one option per published field.
    const group = within(list).getByRole("group", { name: "The stop" });
    expect(within(group).getAllByRole("option")).toHaveLength(fieldChoices("stop").length);
    // Never a raw path, anywhere a person can read.
    expect(list.textContent).not.toMatch(/stop\./);

    await user.type(box, "cos");
    expect(within(list).getAllByRole("option").map((o) => o.textContent)).toEqual(["Cost"]);
    await user.keyboard("{ArrowDown}{Enter}");

    expect(stored()).toEqual({ field: "stop.cost" });
    expect(screen.queryByRole("listbox")).toBeNull();
    // The box shows the label it stored the path for.
    expect((box as HTMLInputElement).value).toBe("Cost");
  });

  it("picks by click, and Escape leaves the stored field alone", async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ field: "stop.title" }} layout="inline" />);
    const box = screen.getByRole("combobox", { name: "One stop's detail: field" });
    expect((box as HTMLInputElement).value).toBe("Name");

    await user.click(box);
    await user.type(box, "zzz");
    expect(screen.getByRole("listbox").textContent).toContain("No field matches");
    await user.keyboard("{Escape}");
    expect((box as HTMLInputElement).value).toBe("Name");
    expect(stored()).toEqual({ field: "stop.title" });

    await user.click(box);
    await user.click(screen.getByRole("option", { name: "Notes" }));
    expect(stored()).toEqual({ field: "stop.notes" });
  });
});
