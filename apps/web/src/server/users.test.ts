// Unit half of M11 link 1 (ADR-025): the pure normalization that decides what
// an Auth.js sign-in payload means as durable identity. The DB half lives in
// users.int.test.ts.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { normalizeIdentity } from "./users";
import { witness } from "@/test-support/witness";

describe("normalizeIdentity", () => {
  it("keeps the Auth.js user id verbatim — it is what lands in actor_id", () => {
    // Both shapes the two live providers produce: Google's `sub`, and
    // dev-login's `dev-<username>` (lib/authConfig.ts).
    expect(normalizeIdentity({ id: "104928374651029384756", email: "a@example.com", name: "Ana" })?.id).toBe(
      "104928374651029384756",
    );
    expect(normalizeIdentity({ id: "dev-alice", name: "alice" })?.id).toBe("dev-alice");
  });

  it("refuses an identity with no usable id", () => {
    expect(normalizeIdentity({ name: "Ana", email: "a@example.com" })).toBeNull();
    expect(normalizeIdentity({ id: "   " })).toBeNull();
    expect(normalizeIdentity(null)).toBeNull();
    expect(normalizeIdentity(undefined)).toBeNull();
  });

  it("lowercases and trims email so one person is one row when link 3 looks them up by address", () => {
    expect(normalizeIdentity({ id: "u1", email: "  Ana.Lee@Example.COM " })?.email).toBe("ana.lee@example.com");
  });

  it("maps blank profile fields to null rather than empty strings", () => {
    // dev-login supplies no email or image at all; a Google account can have
    // a blank name. Absent and blank must not become two different states.
    const identity = normalizeIdentity({ id: "dev-bob", name: "  ", email: "", image: null });
    expect(identity).toEqual({ id: "dev-bob", email: null, name: null, image: null });
  });

  const rawField = fc.option(
    fc.oneof(fc.string(), fc.constantFrom("  Padded  ", "MiXeD@Example.com", "", "   ")),
    { nil: null },
  );

  it("[property] every identity it returns is trimmed, non-blank, and lowercase-emailed", () => {
    const w = witness("normalizeIdentity shape");
    const wAccepted = witness("normalizeIdentity accepted");
    fc.assert(
      fc.property(
        fc.record({ id: rawField, email: rawField, name: rawField, image: rawField }),
        (raw) => {
          const identity = normalizeIdentity(raw);
          w.tick();
          if (identity === null) {
            // The only reason to reject is an id that is absent or blank.
            expect((raw.id ?? "").trim()).toBe("");
            return;
          }
          wAccepted.tick();
          expect(identity.id).toBe(identity.id.trim());
          expect(identity.id.length).toBeGreaterThan(0);
          for (const value of [identity.email, identity.name, identity.image]) {
            if (value === null) continue;
            expect(value).toBe(value.trim());
            expect(value.length).toBeGreaterThan(0);
          }
          expect(identity.email).toBe(identity.email === null ? null : identity.email.toLowerCase());
        },
      ),
      { numRuns: 300 },
    );
    w.atLeast(300); // no guard clause skips a case, so this ticks exactly numRuns
    // Measured over 5 runs: 169-192 accepted of 300 generated. Floor set
    // below half the observed minimum, so an id generator that stopped
    // producing usable ids would collapse this rather than flap it.
    wAccepted.atLeast(75);
  });

  it("[property] normalizing an already-normalized identity changes nothing", () => {
    const w = witness("normalizeIdentity idempotence");
    fc.assert(
      fc.property(fc.record({ id: rawField, email: rawField, name: rawField, image: rawField }), (raw) => {
        const once = normalizeIdentity(raw);
        if (once === null) return;
        w.tick();
        expect(normalizeIdentity(once)).toEqual(once);
      }),
      { numRuns: 300 },
    );
    w.atLeast(75); // measured 169-185 of 300 over 5 runs; floor is below half the minimum
  });
});
