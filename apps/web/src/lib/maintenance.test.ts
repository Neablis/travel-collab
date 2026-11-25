import { afterEach, describe, expect, it, vi } from "vitest";
import { isMaintenance, maintenanceResponse } from "./maintenance";

afterEach(() => vi.unstubAllEnvs());

describe("maintenance mode", () => {
  it("is on only for the exact value true, read at call time", () => {
    expect(isMaintenance()).toBe(false);
    for (const off of ["", "1", "TRUE", "false"]) {
      vi.stubEnv("MAINTENANCE_MODE", off);
      expect(isMaintenance()).toBe(false);
    }
    vi.stubEnv("MAINTENANCE_MODE", "true");
    expect(isMaintenance()).toBe(true);
  });

  it.each(["/api/v1/trips", "/api/mcp", "/api/cron/embed-days", "/.well-known/oauth-authorization-server", "/oauth/authorize"])(
    "answers %s with 503 JSON, Retry-After and noindex",
    async (path) => {
      const res = maintenanceResponse(path);
      expect(res.status).toBe(503);
      expect(res.headers.get("retry-after")).toBe("600");
      expect(res.headers.get("x-robots-tag")).toBe("noindex");
      expect(await res.json()).toEqual({ error: "maintenance" });
    },
  );

  it.each(["/", "/trips/x", "/apiary", "/oauthish"])("answers %s with the static notice, 503", async (path) => {
    const res = maintenanceResponse(path);
    expect(res.status).toBe(503);
    expect(res.headers.get("content-type")).toMatch(/^text\/html/);
    expect(res.headers.get("retry-after")).toBe("600");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    const html = await res.text();
    expect(html).toContain("We're moving to a new home.");
    expect(html).toContain("Nothing you've saved is lost.");
    expect(html).not.toMatch(/<a\s/i);
  });
});
