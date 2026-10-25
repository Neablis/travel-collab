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

  // KI-2026-10-24-h. Either side of the date line in the South Pacific the
  // coarse grid draws its borders a few tenths of a degree off, which is a
  // calendar day: Pago Pago (UTC-11) came back as Apia (UTC+13), Fakaofo
  // (UTC+13) as Pago Pago. Real places, each checked against its tz zone.
  it("puts the towns on either side of the Samoan date line in their own zones", () => {
    expect(timeZoneAt(-14.2794, -170.7006), "Pago Pago").toBe("Pacific/Pago_Pago");
    expect(timeZoneAt(-14.335, -170.784), "Leone, Tutuila").toBe("Pacific/Pago_Pago");
    expect(timeZoneAt(-14.2793, -170.5629), "Aunu'u").toBe("Pacific/Pago_Pago");
    expect(timeZoneAt(-14.2333, -169.5083), "Ta'u").toBe("Pacific/Pago_Pago");
    expect(timeZoneAt(-11.0556, -171.0833), "Swains Island").toBe("Pacific/Pago_Pago");
    expect(timeZoneAt(-13.8333, -171.7667), "Apia").toBe("Pacific/Apia");
    expect(timeZoneAt(-14.057, -171.412), "Lalomanu, Upolu").toBe("Pacific/Apia");
    expect(timeZoneAt(-13.73, -172.2), "Salelologa, Savai'i").toBe("Pacific/Apia");
    expect(timeZoneAt(-9.3803, -171.2181), "Fakaofo").toBe("Pacific/Fakaofo");
    expect(timeZoneAt(-9.1667, -171.8167), "Nukunonu").toBe("Pacific/Fakaofo");
    expect(timeZoneAt(-8.5425, -172.5167), "Atafu").toBe("Pacific/Fakaofo");
    expect(timeZoneAt(-21.139, -175.204), "Nuku'alofa").toBe("Pacific/Tongatapu");
    expect(timeZoneAt(-19.0544, -169.9187), "Alofi").toBe("Pacific/Niue");
    expect(timeZoneAt(-13.2825, -176.1736), "Mata-Utu").toBe("Pacific/Wallis");
    expect(timeZoneAt(-18.1416, 178.4419), "Suva").toBe("Pacific/Fiji");
  });

  it("answers null for a pair that is not a point, rather than throwing", () => {
    expect(timeZoneAt(Number.NaN, 0)).toBeNull();
    expect(timeZoneAt(95, 0)).toBeNull();
  });
});
