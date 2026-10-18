import { describe, expect, it } from "vitest";
import manifest from "./manifest";

// ADR-078: the installed app opens on Home, which moved to `/home`, and keeps
// the identity it had when `start_url` was `/` — an install's `id` defaults to
// its start_url, so without `id` every existing install would be another app.
describe("manifest", () => {
  it("opens on Home and keeps the identity installs already have", () => {
    const { id, start_url } = manifest();
    expect(start_url).toBe("/home");
    expect(id).toBe("/");
  });
});
