import { describe, expect, it } from "vitest";
import { codeSamplesFor, exampleOf } from "./codeSamples";

const BODY = {
  type: "object",
  required: ["name", "public", "note"],
  properties: {
    name: { type: "string" },
    public: { type: "boolean" },
    note: { type: "string", enum: ["a", "b"] },
    optional: { type: "string" },
  },
};

describe("codeSamplesFor", () => {
  it("builds a bodyless GET from its method, path and a token placeholder", () => {
    const [curl, js, py] = codeSamplesFor({ method: "get", url: "/v1/account" });
    expect(curl!.source).toContain("curl -X GET 'https://caesura.today/api/v1/account'");
    expect(curl!.source).toContain("Bearer tc_YOUR_TOKEN");
    expect(curl!.source).not.toContain("-d ");
    expect(js!.source).toContain('fetch("https://caesura.today/api/v1/account"');
    expect(py!.source).toContain('"https://caesura.today/api/v1/account"');
    expect([curl!.lang, js!.lang, py!.lang]).toEqual(["Shell", "JavaScript", "Python"]);
  });

  it("carries the example body, required fields only, in each language's own literal", () => {
    const [curl, js, py] = codeSamplesFor({ method: "POST", url: "/v1/trips", body: BODY });
    expect(curl!.source).toContain('"public": false');
    expect(curl!.source).not.toContain("optional");
    expect(js!.source).toContain("body: JSON.stringify(");
    expect(py!.source).toContain('json={"name": "string", "public": False, "note": "a"}');
  });
});

describe("codeSamplesFor parameters", () => {
  it("writes a required query parameter, with its schema's example, and leaves out an optional one", () => {
    const query = {
      type: "object",
      required: ["q"],
      properties: { q: { type: "string", example: "Lisbon" }, limit: { type: "integer" } },
    };
    const [curl, js, py] = codeSamplesFor({ method: "GET", url: "/v1/geocode", query });
    expect(curl!.source).toContain("'https://caesura.today/api/v1/geocode?q=Lisbon'");
    expect(js!.source).toContain('fetch("https://caesura.today/api/v1/geocode?q=Lisbon"');
    expect(py!.source).toContain('"https://caesura.today/api/v1/geocode?q=Lisbon"');
    expect(curl!.source).not.toContain("limit");
  });

  it("replaces a path parameter with a named placeholder in every language", () => {
    const samples = codeSamplesFor({ method: "GET", url: "/v1/trips/{tripId}/days/{dayId}" });
    for (const sample of samples) {
      expect(sample.source).toContain("/v1/trips/YOUR_TRIP_ID/days/YOUR_DAY_ID");
      expect(sample.source).not.toContain("{tripId}");
    }
  });

  it("escapes a single quote in the curl body so the shell string stays closed", () => {
    const body = { type: "object", required: ["name"], properties: { name: { type: "string", example: "Mum's trip" } } };
    const [curl] = codeSamplesFor({ method: "POST", url: "/v1/trips", body });
    expect(curl!.source).toContain(`"name": "Mum'\\''s trip"`);
  });
});

describe("exampleOf", () => {
  it("prefers a declared example, then default, then the type", () => {
    expect(exampleOf({ type: "string", example: "x", default: "y" })).toBe("x");
    expect(exampleOf({ type: "string", default: "y" })).toBe("y");
    expect(exampleOf({ type: "integer", minimum: 1 })).toBe(1);
  });
});
