import { describe, expect, it } from "vitest";
import { settingsSectionFrom, tripSettingsHref, withoutSettingsParam } from "./tripSettingsLink";

describe("Trip settings deep links", () => {
  it("round-trips every section through the href it builds", () => {
    for (const section of ["people", "cover"] as const) {
      const href = tripSettingsHref("t1", section);
      expect(settingsSectionFrom(href.slice(href.indexOf("?")))).toBe(section);
    }
  });

  it("opens nothing for an absent or unknown section", () => {
    expect(settingsSectionFrom("")).toBeNull();
    expect(settingsSectionFrom("?view=Plan")).toBeNull();
    expect(settingsSectionFrom("?settings=budget")).toBeNull();
  });

  it("drops only its own param", () => {
    expect(withoutSettingsParam("?settings=cover")).toBe("");
    expect(withoutSettingsParam("?view=Plan&settings=people")).toBe("?view=Plan");
  });
});
