// The operator bootstrap — how the first admin exists at all (M20 link 7).
import { afterEach, describe, expect, it, vi } from "vitest";
import { bootstrapAdminIds, isBootstrapAdmin } from "./adminBootstrap";

const savedAdminIds = process.env.ADMIN_USER_IDS;

afterEach(() => {
  vi.unstubAllEnvs();
  // `vi.unstubAllEnvs` restores what `stubEnv` changed; a `delete` is not a stub
  // and has to be put back by hand, or the unset-case test above leaks into
  // every file that runs after it in the same worker.
  if (savedAdminIds === undefined) delete process.env.ADMIN_USER_IDS;
  else process.env.ADMIN_USER_IDS = savedAdminIds;
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
  // **The UNSET case is a different branch from the empty one**, and the first
  // version of this test never reached it: it mapped `undefined` to `""`, so
  // `typeof raw !== "string"` — the branch its own name claimed to cover — ran
  // in no test at all. Caught by CodeRabbit on PR #174, and it is precisely the
  // defect this repo's review instructions single out ("flag tests that assert
  // nothing on the path they claim to cover").
  it("promotes nobody when the variable is not set at all", () => {
    delete process.env.ADMIN_USER_IDS;
    expect(process.env.ADMIN_USER_IDS).toBeUndefined();
    expect(bootstrapAdminIds()).toEqual([]);
    expect(isBootstrapAdmin("dev-ana")).toBe(false);
  });

  it("promotes nobody when it is empty, whitespace or only separators", () => {
    for (const value of ["", "   ", ",,,"]) {
      vi.stubEnv("ADMIN_USER_IDS", value);
      expect(bootstrapAdminIds(), value).toEqual([]);
      expect(isBootstrapAdmin("dev-ana"), value).toBe(false);
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
