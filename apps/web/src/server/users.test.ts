// Unit half of M11 link 1 (ADR-025): the pure normalization that decides what
// an Auth.js sign-in payload means as durable identity. The DB half lives in
// users.int.test.ts.
import { randomUUID } from "node:crypto";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { normalizeIdentity } from "./users";
import { witness } from "@/test-support/witness";

/** A sign-in payload of the shape Auth.js actually delivers. */
const signIn = (subject: string | null, user: Record<string, unknown> = {}) => ({
  user,
  account: { providerAccountId: subject },
});

describe("normalizeIdentity", () => {
  it("keeps the provider's subject verbatim — it is what lands in actor_id", () => {
    // Both shapes the two live providers produce, each already namespaced by
    // the provider that minted it (lib/authConfig.ts): Google's
    // `google-<sub>`, and dev-login's `dev-<username>`.
    expect(normalizeIdentity(signIn("google-104928374651029384756", { email: "a@example.com", name: "Ana" }))?.id).toBe(
      "google-104928374651029384756",
    );
    expect(normalizeIdentity(signIn("dev-alice", { name: "alice" }))?.id).toBe("dev-alice");
  });

  it("refuses an identity with no usable subject", () => {
    expect(normalizeIdentity({ user: { name: "Ana", email: "a@example.com" } })).toBeNull();
    expect(normalizeIdentity(signIn("   "))).toBeNull();
    expect(normalizeIdentity(signIn(null))).toBeNull();
    expect(normalizeIdentity(null)).toBeNull();
    expect(normalizeIdentity(undefined)).toBeNull();
  });

  it("lowercases and trims email so one person is one row when link 3 looks them up by address", () => {
    expect(normalizeIdentity(signIn("u1", { email: "  Ana.Lee@Example.COM " }))?.email).toBe("ana.lee@example.com");
  });

  it("maps blank profile fields to null rather than empty strings", () => {
    // dev-login supplies no image at all; a Google account can have a blank
    // name. Absent and blank must not become two different states.
    const identity = normalizeIdentity(signIn("dev-bob", { name: "  ", email: "", image: null }));
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
          const identity = normalizeIdentity(signIn(raw.id, raw));
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
        const once = normalizeIdentity(signIn(raw.id, raw));
        if (once === null) return;
        w.tick();
        expect(normalizeIdentity(signIn(once.id, once))).toEqual(once);
      }),
      { numRuns: 300 },
    );
    w.atLeast(75); // measured 169-185 of 300 over 5 runs; floor is below half the minimum
  });
});

// The bug these tests could not see, found 2026-09-05 by 13 `users` rows in
// production carrying one Google address.
//
// `user.id` in an Auth.js sign-in payload is NOT the provider's subject. For
// every OAuth sign-in @auth/core builds the user with `id: crypto.randomUUID()`
// and keeps the real subject on `account.providerAccountId`:
//
//   @auth/core@0.41.3 lib/actions/callback/oauth/callback.js:216-236
//     const user = { ...userFromProfile,
//       // The user's id is intentionally not set based on the profile id, as
//       // the user should remain independent of the provider [...]
//       id: crypto.randomUUID(), ... }
//
// That branch is only bypassed by an adapter's `getUserByAccount`
// (lib/actions/callback/index.js:55-66), and ADR-025 deliberately has none.
// So keying identity off `user.id` minted a NEW account on every Google
// sign-in, and sent each one back through the M11a invite gate as a stranger.
// Dev login was untouched — the credentials branch keeps `user.id` verbatim
// (callback/index.js:238) — which is why the whole suite stayed green over it.
//
// `SignInUser` now has no `id` field, so the original mistake no longer
// compiles. These pin the RUNTIME half of that: Auth.js still delivers the
// stray UUID, and it must go on being ignored.
describe("normalizeIdentity takes the durable id from the account, not the user", () => {
  const SUB = "google-104928374651029384756";

  // Built through a variable rather than a literal, so TypeScript's
  // excess-property check does not hide the field production really sends.
  const authJsUser = (extra: { name?: string | null; email?: string | null; image?: string | null } = {}) => ({
    id: randomUUID(),
    name: "Mitchell",
    ...extra,
  });

  it("uses the provider's subject and ignores the throwaway user id", () => {
    const identity = normalizeIdentity({
      user: authJsUser({ name: "Mitchell", email: "m@example.com" }),
      account: { providerAccountId: SUB },
    });
    expect(identity?.id).toBe(SUB);
  });

  // The regression proper: this is precisely what "my account disappeared" was.
  it("converges every sign-in by one person on one id, though Auth.js re-rolls user.id each time", () => {
    const ids = new Set(
      Array.from(
        { length: 5 },
        () =>
          normalizeIdentity({ user: authJsUser({ name: "Mitchell" }), account: { providerAccountId: SUB } })!.id,
      ),
    );
    expect([...ids]).toEqual([SUB]);
  });

  it("keeps dev-login's id shape, which is already that provider's own subject", () => {
    const identity = normalizeIdentity({
      user: { name: "alice" },
      account: { providerAccountId: "dev-alice" },
    });
    expect(identity?.id).toBe("dev-alice");
  });

  // Fail-closed (ADR-025 §4): no durable subject means no row. Falling back to
  // `user.id` here is the bug itself, so the absence of a fallback is the fix.
  it("refuses a payload with no account subject rather than falling back to the random user id", () => {
    const user = authJsUser({ name: "Ana", email: "ana@example.com" });
    expect(normalizeIdentity({ user, account: null })).toBeNull();
    expect(normalizeIdentity({ user })).toBeNull();
    expect(normalizeIdentity({ user, account: { providerAccountId: "   " } })).toBeNull();
  });

  it("still reads the profile fields from the user, which is where they live", () => {
    const identity = normalizeIdentity({
      user: authJsUser({ name: "  Mitchell  ", email: "M@Example.COM", image: "https://img" }),
      account: { providerAccountId: SUB },
    });
    expect(identity).toEqual({ id: SUB, name: "Mitchell", email: "m@example.com", image: "https://img" });
  });
});
