import { describe, expect, it } from "vitest";
import { pasteToStop } from "./pasteToStop";

describe("pasteToStop", () => {
  // The link Google's Share button gives on desktop. The `@` pair is where
  // the map was centred, and the `!3d!4d` pair is the place itself.
  it("reads a Google Maps place link's name and the place's own coordinates", () => {
    const link =
      "https://www.google.com/maps/place/Ichiran+Shibuya/@35.6612,139.6990,17z/data=!3m1!4b1!4m6!3m5!1s0x60188ca8!8m2!3d35.6613!4d139.7008!16s%2Fg%2F1tdgx7ry";
    expect(pasteToStop(link)).toEqual({
      title: "Ichiran Shibuya",
      location: { name: "Ichiran Shibuya", lat: 35.6613, lng: 139.7008 },
    });
  });

  it("falls back to the map's centre when the link has no pinned place", () => {
    expect(pasteToStop("https://www.google.com/maps/place/Kinkaku-ji/@35.0394,135.7292,15z")).toEqual({
      title: "Kinkaku-ji",
      location: { name: "Kinkaku-ji", lat: 35.0394, lng: 135.7292 },
    });
  });

  it("titles a place by the part before its address, and keeps the address on the place", () => {
    const link = "https://www.google.co.jp/maps/place/Ichiran+Shibuya,+1+Chome-22-7+Jinnan,+Shibuya+City/@35.66,139.70,17z";
    expect(pasteToStop(link)).toEqual({
      title: "Ichiran Shibuya",
      location: { name: "Ichiran Shibuya, 1 Chome-22-7 Jinnan, Shibuya City", lat: 35.66, lng: 139.7 },
    });
  });

  it("reads a search link's query, with no coordinates to give", () => {
    expect(pasteToStop("https://www.google.com/maps/search/?api=1&query=Fushimi%20Inari")).toEqual({
      title: "Fushimi Inari",
      location: { name: "Fushimi Inari" },
    });
    expect(pasteToStop("https://maps.google.com/?q=Nishiki+Market")).toEqual({
      title: "Nishiki Market",
      location: { name: "Nishiki Market" },
    });
  });

  // A dropped pin has coordinates and no name, as a Map double-click does,
  // and the editor treats it the same way: a place, and no title.
  it("makes a dropped pin a place with no title", () => {
    expect(pasteToStop("https://www.google.com/maps?q=35.0116,135.7681")).toEqual({
      title: "",
      location: { name: "35.0116, 135.7681", lat: 35.0116, lng: 135.7681 },
    });
  });

  it("reads an Apple Maps link's name and coordinates", () => {
    expect(pasteToStop("https://maps.apple.com/?q=Tsukiji%20Outer%20Market&ll=35.6655,139.7707")).toEqual({
      title: "Tsukiji Outer Market",
      location: { name: "Tsukiji Outer Market", lat: 35.6655, lng: 139.7707 },
    });
  });

  // Not followed (see the file's header): the link goes into the notes.
  it("keeps a short link in the notes rather than guessing at the place", () => {
    expect(pasteToStop("https://maps.app.goo.gl/AbC123xyz")).toEqual({ title: "", notes: "https://maps.app.goo.gl/AbC123xyz" });
  });

  it("keeps any other link in the notes", () => {
    expect(pasteToStop("https://example.com/ramen-guide")).toEqual({ title: "", notes: "https://example.com/ramen-guide" });
  });

  it("titles a stop with a line of text", () => {
    expect(pasteToStop("  Ramen at Ichiran \n")).toEqual({ title: "Ramen at Ichiran" });
  });

  it("titles a stop with the first line and keeps the rest as notes", () => {
    expect(pasteToStop("Ramen at Ichiran\n\nOpen 24h\nCash only")).toEqual({ title: "Ramen at Ichiran", notes: "Open 24h\nCash only" });
  });

  it("clips a title to what AddActivity accepts", () => {
    expect(pasteToStop("x".repeat(250))?.title).toHaveLength(200);
  });

  it("gives nothing for blank text", () => {
    expect(pasteToStop(" \n\t ")).toBeNull();
  });

  it("does not make a place of coordinates that cannot be one, and keeps the link", () => {
    const link = "https://www.google.com/maps?q=135.0,35.0";
    expect(pasteToStop(link)).toEqual({ title: "", notes: link });
  });

  // What Apple Maps' Share gives today: no `q` and no `ll`, the place's name
  // in `name`, its street address in `address`, and `coordinate`.
  it("reads a current Apple Maps share link's name, not its address, and its coordinates", () => {
    const link =
      "https://maps.apple.com/place?address=4%20Chome-16-2%20Tsukiji,%20Chuo%20City,%20Tokyo%20104-0045,%20Japan&coordinate=35.6655,139.7707&name=Tsukiji%20Outer%20Market&place-id=I6A2F1B3C4D5E6F70";
    expect(pasteToStop(link)).toEqual({
      title: "Tsukiji Outer Market",
      location: { name: "Tsukiji Outer Market", lat: 35.6655, lng: 139.7707 },
    });
  });

  // Google names a dropped pin by its coordinates in degrees, minutes and
  // seconds. That is no more a title than the decimal pair is.
  it("makes a dropped pin named in degrees and minutes a place with no title", () => {
    const link = "https://www.google.com/maps/place/35%C2%B000'41.8%22N+135%C2%B046'05.2%22E/@35.0116,135.7681,17z";
    expect(pasteToStop(link)).toEqual({
      title: "",
      location: { name: "35.0116, 135.7681", lat: 35.0116, lng: 135.7681 },
    });
  });

  it("reads a dropped pin's place from its degrees and minutes when the link has no other", () => {
    expect(pasteToStop("https://www.google.com/maps/place/35%C2%B000'41.8%22S+135%C2%B046'05.2%22W")).toEqual({
      title: "",
      location: { name: "-35.0116, -135.7681", lat: -35.011611, lng: -135.768111 },
    });
  });

  // Directions and a bare map view are not a place: the centre of the map is
  // wherever it was scrolled to.
  it("keeps a directions link in the notes", () => {
    const link = "https://www.google.com/maps/dir/Kyoto+Station/Kinkaku-ji/@35.0116,135.7292,13z";
    expect(pasteToStop(link)).toEqual({ title: "", notes: link });
  });

  it("keeps a bare map view in the notes", () => {
    const link = "https://www.google.com/maps/@35.0116,135.7681,15z";
    expect(pasteToStop(link)).toEqual({ title: "", notes: link });
  });
});
