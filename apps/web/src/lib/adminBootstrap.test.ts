// The operator bootstrap — how the first admin exists at all (M20 link 7).
import { afterEach, describe, expect, it, vi } from "vitest";
import { bootstrapAdminIds, isBootstrapAdmin } from "./adminBootstrap";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("bootstrapAdminIds", () => {
  it("reads a comma-separated list of user ids", () => {
    vi.stubEnv("ADMIN_USER_IDS", "dev-ana, google-12345 ,dev-bo");
    expect(bootstrapAdminIds()).toEqual(["dev-ana", "google-12345", "dev-bo"]);
  });

  // Fails closed on everything malformed: an unparseable list is an empty
  // list, and an empty list promotes nobody. The same shape `aiLive()` and
  // `isDemoDataResetEnabled` take, for the same reason — a typo must never
  // resolve to "yes".
  it("promotes nobody when unset, empty or whitespace", () => {
    for (const value of [undefined, "", "   ", ",,,"]) {
      if (value === undefined) vi.stubEnv("ADMIN_USER_IDS", "");
      else vi.stubEnv("ADMIN_USER_IDS", value);
      expect(bootstrapAdminIds()).toEqual([]);
      expect(isBootstrapAdmin("dev-ana")).toBe(false);
    }
  });
});

describe("isBootstrapAdmin", () => {
  it("matches a whole id and never a prefix", () => {
    vi.stubEnv("ADMIN_USER_IDS", "dev-ana");
    expect(isBootstrapAdmin("dev-ana")).toBe(true);
    // The failure this refuses: `dev-anabelle` is a different person, and a
    // prefix match would hand them an operator console.
    expect(isBootstrapAdmin("dev-anabelle")).toBe(false);
    expect(isBootstrapAdmin("ana")).toBe(false);
    expect(isBootstrapAdmin("")).toBe(false);
  });

  // The ids are `users.id` — the Auth.js subject verbatim (ADR-025) — not the
  // username typed into a form. Getting that wrong would configure an operator
  // who never becomes one, and the symptom would be a 404 nobody can explain.
  it("takes the stored id, which for dev login carries its prefix", () => {
    vi.stubEnv("ADMIN_USER_IDS", "dev-ana");
    expect(isBootstrapAdmin("dev-ana")).toBe(true);
    expect(isBootstrapAdmin("ana")).toBe(false);
  });
});
