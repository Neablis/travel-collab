import { describe, expect, it } from "vitest";
import { directionsUrl } from "./directions";

const destination = (url: string) => new URL(url).searchParams.get("destination");
const travelmode = (url: string) => new URL(url).searchParams.get("travelmode");

// M52 decision 16: Google Maps' universal URL, which opens the app where it is installed.
describe("directionsUrl", () => {
  it("routes to a placed stop's coordinates", () => {
    const url = directionsUrl({ name: "Tasca do Chico", lat: 38.7118, lng: -9.1442, precision: "venue" });
    expect(url).toMatch(/^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&/);
    expect(destination(url)).toBe("38.7118,-9.1442");
  });

  // A city-precision pin is the middle of town: the name and address find the
  // place, and the pin would send someone to the town square.
  it("routes by name and address when the coordinates are only the city's", () => {
    const url = directionsUrl({
      name: "Tasca do Chico", lat: 38.72, lng: -9.14, precision: "city",
      address: { countryCode: "PT", lines: ["Rua do Diário de Notícias 39"], locality: "Lisboa" },
    });
    expect(destination(url)).toBe("Tasca do Chico, Rua do Diário de Notícias 39, Lisboa");
  });

  it("routes by name when there are no coordinates at all", () => {
    expect(destination(directionsUrl({ name: "Tasca do Chico", city: "Lisbon" }))).toBe("Tasca do Chico, Lisbon");
  });

  it("travels the way the leg leading in does, and leaves a flight to the app", () => {
    const place = { name: "Sintra", lat: 38.8, lng: -9.39 };
    expect(travelmode(directionsUrl(place, "train"))).toBe("transit");
    expect(travelmode(directionsUrl(place, "walk"))).toBe("walking");
    expect(travelmode(directionsUrl(place, "flight"))).toBeNull();
    expect(travelmode(directionsUrl(place))).toBeNull();
  });
});
