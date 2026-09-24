import { afterEach, describe, expect, it, vi } from "vitest";
import { roundForExport } from "../roundedPoint";
import { getClimate, getForecast } from "./index";
import { UpstreamError } from "./ports";

// `EXTERNAL_DATA_OFFLINE` (Mitchell's policy: no automated test may call a real
// third party). The e2e server sets it, so a spec that renders weather gets
// the quiet "weather unavailable" rather than a call to met.no or
// power.larc.nasa.gov — whatever the developer's `.env.local` holds.

const ORIGINAL = process.env.EXTERNAL_DATA_OFFLINE;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.EXTERNAL_DATA_OFFLINE;
  else process.env.EXTERNAL_DATA_OFFLINE = ORIGINAL;
  vi.restoreAllMocks();
});

describe("EXTERNAL_DATA_OFFLINE", () => {
  it("makes the forecast unconfigured, so the route charges nothing for it", () => {
    process.env.EXTERNAL_DATA_OFFLINE = "true";
    expect(() => getForecast()).toThrow("EXTERNAL_DATA_OFFLINE is set");
  });

  it("makes the normals reject without a request leaving the process", async () => {
    process.env.EXTERNAL_DATA_OFFLINE = "true";
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(getClimate().normals(roundForExport(35.0116, 135.7681))).rejects.toBeInstanceOf(UpstreamError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
