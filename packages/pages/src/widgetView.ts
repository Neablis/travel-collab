import { z } from "zod";
import type { WidgetInput } from "./registry-types";

// "Show as" — the one setting `day.weather` and `day.sun` share. Declared once
// so the two widgets cannot drift apart on its label, its options or what an
// absent value means: a widget saved before the setting existed has no `view`,
// and reads as the graphic.

/** How a block with two readings draws: the graphic by default, the table on request. */
export type WidgetView = "graphic" | "table";

/** The stored param. Absent is `"graphic"`. */
export const viewParam = z.enum(["graphic", "table"]).optional();

/** The settings panel's control for it — "Show as", not `cost.chart`'s "Variation". */
export const VIEW_INPUT = {
  name: "view", type: "choice", label: "Show as", default: "graphic",
  options: [{ value: "graphic", label: "Graphic" }, { value: "table", label: "Table" }],
} as const satisfies WidgetInput;
