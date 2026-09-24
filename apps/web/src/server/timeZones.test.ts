import { describe, expect, it } from "vitest";
import { AIRPORT_CODES_BY_ZONE } from "./airportTimeZones.generated";
import { timeZoneAt, timeZoneOfAirport } from "./timeZones";

describe("timeZoneOfAirport", () => {
  it("knows the airports a home is usually near, including a half-hour zone", () => {
    expect(timeZoneOfAirport("SFO")).toBe("America/Los_Angeles");
    expect(timeZoneOfAirport("NRT")).toBe("Asia/Tokyo");
    expect(timeZoneOfAirport("LHR")).toBe("Europe/London");
    expect(timeZoneOfAirport("DEL")).toBe("Asia/Kolkata");
  });

  it("answers null for no code and for a code that is no airport", () => {
    expect(timeZoneOfAirport(null)).toBeNull();
    expect(timeZoneOfAirport("QQQ")).toBeNull();
  });

  // The table packs codes three letters at a time. A value whose length is not
  // a multiple of three, or a code filed under two zones, would shift or shadow
  // the codes after it without any single lookup failing loudly.
  it("is a table of whole, distinct codes under zones this runtime knows", () => {
    const seen = new Set<string>();
    for (const [zone, codes] of Object.entries(AIRPORT_CODES_BY_ZONE)) {
      expect(codes.length % 3, zone).toBe(0);
      expect(() => new Intl.DateTimeFormat("en", { timeZone: zone }), zone).not.toThrow();
      for (let i = 0; i < codes.length; i += 3) {
        const code = codes.slice(i, i + 3);
        expect(code).toMatch(/^[A-Z]{3}$/);
        expect(seen.has(code), code).toBe(false);
        seen.add(code);
      }
    }
    // 9,054 when generated on 2026-09-24: a floor, so a generator run over a
    // truncated download fails here rather than shipping.
    expect(seen.size).toBeGreaterThan(9000);
  });
});

describe("timeZoneAt", () => {
  it("finds the zone of a city, a half-hour one and a quarter-hour one included", () => {
    expect(timeZoneAt(35.6812, 139.7671)).toBe("Asia/Tokyo");
    expect(timeZoneAt(64.1466, -21.9426)).toBe("Atlantic/Reykjavik");
    expect(timeZoneAt(28.6139, 77.209)).toBe("Asia/Kolkata");
    expect(timeZoneAt(27.7172, 85.324)).toBe("Asia/Kathmandu");
  });

  it("answers null for a pair that is not a point, rather than throwing", () => {
    expect(timeZoneAt(Number.NaN, 0)).toBeNull();
    expect(timeZoneAt(95, 0)).toBeNull();
  });
});
