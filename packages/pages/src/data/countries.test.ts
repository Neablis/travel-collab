import { describe, expect, it } from "vitest";
import { COUNTRIES, CURRENCY_NAMES, countryFacts } from "./countries";

// The table is compiled by hand from public facts, so it can carry a typo that
// nothing else would notice: a card telling someone Japan runs at 110 V, or that
// the UK drives on the right, renders just as confidently as the truth. These
// pin the values a traveller is most likely to check and most likely to be hurt
// by, for the countries trips here most often visit.

describe("the know-before-you-go table", () => {
  it.each([
    ["JP", { plugs: ["A", "B"], volts: [100], hertz: [50, 60], drives: "left", emergency: ["110", "119"], currencies: ["JPY"], callingCode: "+81" }],
    ["GB", { plugs: ["G"], volts: [230], hertz: [50], drives: "left", emergency: ["999", "112"], currencies: ["GBP"], callingCode: "+44" }],
    ["US", { plugs: ["A", "B"], volts: [120], hertz: [60], drives: "right", emergency: ["911"], currencies: ["USD"], callingCode: "+1" }],
    ["FR", { plugs: ["C", "E"], volts: [230], hertz: [50], drives: "right", emergency: ["112", "17", "15", "18"], currencies: ["EUR"], callingCode: "+33" }],
    ["IT", { plugs: ["C", "F", "L"], volts: [230], hertz: [50], drives: "right", emergency: ["112", "113", "118", "115"], currencies: ["EUR"], callingCode: "+39" }],
    ["DE", { plugs: ["C", "F"], volts: [230], hertz: [50], drives: "right", emergency: ["112", "110"], currencies: ["EUR"], callingCode: "+49" }],
    ["AU", { plugs: ["I"], volts: [230], hertz: [50], drives: "left", emergency: ["000", "112"], currencies: ["AUD"], callingCode: "+61" }],
    ["IN", { plugs: ["C", "D", "M"], volts: [230], hertz: [50], drives: "left", emergency: ["112", "100", "102", "101"], currencies: ["INR"], callingCode: "+91" }],
    // Two voltages: 127 V in most of the north and 220 V in the south, and a
    // traveller with a 120 V-only appliance needs to see both.
    ["BR", { plugs: ["C", "N"], volts: [127, 220], hertz: [60], drives: "right", emergency: ["190", "192", "193"], currencies: ["BRL"], callingCode: "+55" }],
    ["ZA", { plugs: ["C", "D", "M", "N"], volts: [230], hertz: [50], drives: "left", emergency: ["10111", "10177", "112"], currencies: ["ZAR"], callingCode: "+27" }],
  ])("%s carries the well-known values", (code, expected) => {
    expect(countryFacts(code)).toMatchObject(expected);
  });

  it("covers every inhabited country and territory, keyed by a real alpha-2", () => {
    // ICU knows every ISO 3166-1 region (and `XK`), so an unknown code comes
    // back as itself — a typo'd key, or a row filed under the wrong code.
    const regions = new Intl.DisplayNames(["en"], { type: "region" });
    const codes = Object.keys(COUNTRIES);
    for (const code of codes) {
      expect(code, "not uppercase alpha-2").toMatch(/^[A-Z]{2}$/);
      expect(regions.of(code), `${code} is not a region ICU knows`).not.toBe(code);
    }
    // 249 assigned codes, less the six uninhabited ones the header names, plus
    // `XK`. A floor rather than an equality so adding a row never fails this.
    expect(codes.length).toBeGreaterThanOrEqual(244);
  });

  it("gives every row every required field, in its own vocabulary", () => {
    let checked = 0;
    for (const [code, facts] of Object.entries(COUNTRIES)) {
      expect(facts.name, code).not.toBe("");
      expect(facts.plugs.length, `${code} plugs`).toBeGreaterThan(0);
      for (const plug of facts.plugs) expect("ABCDEFGHIJKLMNO", `${code} plug ${plug}`).toContain(plug);
      expect(facts.volts.length, `${code} volts`).toBeGreaterThan(0);
      for (const v of facts.volts) expect(v, `${code} volts`).toBeGreaterThanOrEqual(100);
      expect(facts.hertz.length, `${code} hertz`).toBeGreaterThan(0);
      for (const hz of facts.hertz) expect([50, 60], `${code} hertz`).toContain(hz);
      expect(["left", "right"], `${code} drives`).toContain(facts.drives);
      expect(facts.callingCode, `${code} calling code`).toMatch(/^\+\d{1,3}$/);
      expect(facts.currencies.length, `${code} currencies`).toBeGreaterThan(0);
      for (const c of facts.currencies) expect(CURRENCY_NAMES, `${code} currency ${c}`).toHaveProperty(c);
      // `null` is the honest "not sure"; an EMPTY list would render as a blank
      // that looks like a fact.
      if (facts.emergency !== null) {
        expect(facts.emergency.length, `${code} emergency`).toBeGreaterThan(0);
        for (const n of facts.emergency) expect(n, `${code} emergency`).toMatch(/^\d{2,5}$/);
      }
      if (facts.tipping !== null) expect(facts.tipping.length, `${code} tipping`).toBeLessThanOrEqual(40);
      checked += 1;
    }
    expect(checked).toBe(Object.keys(COUNTRIES).length);
    expect(checked).toBeGreaterThanOrEqual(244);
  });

  it("names no currency that no country uses", () => {
    const used = new Set(Object.values(COUNTRIES).flatMap((facts) => facts.currencies));
    expect(Object.keys(CURRENCY_NAMES).filter((code) => !used.has(code))).toEqual([]);
  });

  it("looks a code up case-insensitively and answers nothing for an unknown one", () => {
    expect(countryFacts("jp")?.name).toBe("Japan");
    expect(countryFacts("AQ")).toBeUndefined();
  });
});
