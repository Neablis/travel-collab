import { z } from "zod";
import { readSlot } from "../external";
import { chip, inlineOf, type MacroDef } from "../registry-types";

// A widget that declares `needs: ["weather"]`, for tests only. No registered
// widget declares an outside input until T24's weather block, and the plumbing
// (the result state, the slot, the page-level need) has to be provable before
// it: a property test over the registry alone could never produce
// `unavailable`, and would go on passing whatever `readSlot` did.
export const weatherProbe: MacroDef<Record<string, never>, string> = {
  name: "test.weatherProbe",
  title: "Weather probe",
  shape: "single",
  // Not `.strict()`: the property sweep's params are mostly day bindings, and a
  // probe that refused them all would clear too few cases to prove anything.
  params: z.object({}) as unknown as z.ZodType<Record<string, never>>,
  inputs: [],
  needs: ["weather"],
  description: "Test-only: how many weather points the trip has.",
  emptyText: "no weather",
  preview: "The weather",
  resolve: (ctx) => {
    const slot = readSlot(ctx.external, "weather");
    if (slot.status !== "ok") return slot;
    return { status: "ok", value: `${slot.value.points.length} points` };
  },
  render: (value) => inlineOf(chip("value", value)),
};
