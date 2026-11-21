import { afterEach, describe, expect, it, vi } from "vitest";

const auth = vi.fn<() => Promise<unknown>>();
vi.mock("@/server/auth", () => ({ auth: () => auth() }));

import { GET } from "./route";

afterEach(() => auth.mockReset());

const call = (callbackUrl: string) =>
  GET(new Request(`https://app.example/api/session-expired?callbackUrl=${encodeURIComponent(callbackUrl)}`));

// A browser drops the tab before resolving, so "/<TAB>/evil.example" lands on https://evil.example/.
describe("GET /api/session-expired", () => {
  it("does not send a signed-in visitor off the site", async () => {
    auth.mockResolvedValue({ user: { id: "u" } });
    const location = (await call("/\t/evil.example")).headers.get("location")!;
    expect(location).toBe("/home");
  });

  it("returns a signed-in visitor to the page they were on", async () => {
    auth.mockResolvedValue({ user: { id: "u" } });
    expect((await call("/trips/abc?tab=days")).headers.get("location")).toBe("/trips/abc?tab=days");
  });
});
