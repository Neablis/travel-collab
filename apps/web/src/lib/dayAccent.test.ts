import { describe, expect, it } from "vitest";
import { dayAccents } from "./dayAccent";

describe("dayAccents", () => {
  it("gives the handoff's headline trip three distinct colours", () => {
    const [tokyo, kyoto, osaka] = dayAccents(["Tokyo", "Kyoto", "Osaka"]);
    expect(new Set([tokyo!.solid, kyoto!.solid, osaka!.solid]).size).toBe(3);
  });

  it("gives the same city the same colour throughout a trip", () => {
    const a = dayAccents(["Rochester", "Niagara Falls", "Rochester"]);
    expect(a[0]).toEqual(a[2]);
  });

  it("uses an explicit neutral for a day with no known city", () => {
    expect(dayAccents([null])[0]!.solid).toBe("neutral");
  });

  it("does not spend a colour bucket on the unknown-city case", () => {
    const [, kyoto, osaka] = dayAccents([null, "Kyoto", "Osaka"]);
    expect(kyoto!.solid).not.toBe("neutral");
    expect(osaka!.solid).not.toBe("neutral");
    expect(kyoto!.solid).not.toBe(osaka!.solid);
  });

  it("degrades without throwing when there are more cities than families", () => {
    const many = ["a", "b", "c", "d", "e", "f", "g", "h"];
    expect(() => dayAccents(many)).not.toThrow();
    expect(dayAccents(many)).toHaveLength(8);
  });

  it("is order-independent for the same set of cities", () => {
    const forward = dayAccents(["Tokyo", "Kyoto"]);
    const backward = dayAccents(["Kyoto", "Tokyo"]);
    expect(forward[0]!.solid).toBe(backward[1]!.solid);
    expect(forward[1]!.solid).toBe(backward[0]!.solid);
  });
});
