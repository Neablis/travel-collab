import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { softAuthenticator } from "@/server/test-support/softAuthenticator";
import {
  authenticationOptions,
  registrationOptions,
  rpId,
  verifyAuthentication,
  verifyRegistration,
  type StoredPasskey,
} from "./passkey";

const ORIGIN = "https://caesura.example";
const ctx = { origin: ORIGIN, rpId: "caesura.example" };
const NOW = new Date("2026-11-20T12:00:00Z");
const MINUTE = 60 * 1000;
const SID = "session-1";

beforeEach(() => vi.stubEnv("PUBLIC_ORIGIN", ORIGIN));
afterEach(() => vi.unstubAllEnvs());

async function registered(userId: string) {
  const device = softAuthenticator();
  const { options, ticket } = await registrationOptions({ id: userId, label: "sam@example.com" }, SID, [], NOW);
  const added = await verifyRegistration(userId, SID, device.attest(options, ctx) as unknown as RegistrationResponseJSON, ticket, NOW);
  expect(added).not.toBeNull();
  const stored: StoredPasskey = {
    id: "factor-1",
    credentialId: added!.credentialId,
    publicKey: added!.publicKey,
    counter: added!.counter,
    transports: added!.transports,
  };
  return { device, stored };
}

describe("passkey registration", () => {
  it("takes the relying party id from the deployment's origin, not from the request", async () => {
    expect(rpId()).toBe("caesura.example");
    const { options } = await registrationOptions({ id: "u1", label: "sam" }, SID, [], NOW);
    expect(options.rp.id).toBe("caesura.example");
  });

  it("refuses a registration made for another origin", async () => {
    const device = softAuthenticator();
    const { options, ticket } = await registrationOptions({ id: "u1", label: "sam" }, SID, [], NOW);
    const response = device.attest(options, { origin: "https://evil.example", rpId: "caesura.example" });
    expect(await verifyRegistration("u1", SID, response as unknown as RegistrationResponseJSON, ticket, NOW)).toBeNull();
  });

  it("refuses a challenge this account was not issued, and one that has expired", async () => {
    const device = softAuthenticator();
    const { options, ticket } = await registrationOptions({ id: "u1", label: "sam" }, SID, [], NOW);
    const response = device.attest(options, ctx) as unknown as RegistrationResponseJSON;
    expect(await verifyRegistration("someone-else", SID, response, ticket, NOW)).toBeNull();
    expect(await verifyRegistration("u1", SID, response, ticket, new Date(NOW.getTime() + 6 * MINUTE))).toBeNull();
    expect(await verifyRegistration("u1", SID, response, "not-a-ticket", NOW)).toBeNull();
    // And the same response is good for the right account inside its window.
    expect(await verifyRegistration("u1", SID, response, ticket, new Date(NOW.getTime() + MINUTE))).not.toBeNull();
  });
});

describe("passkey assertion", () => {
  it("accepts a signature by the registered key and hands back the counter to store", async () => {
    const { device, stored } = await registered("u1");
    const { options, ticket } = await authenticationOptions("u1", SID, [stored], NOW);
    const response = device.assert(options, ctx) as unknown as AuthenticationResponseJSON;
    expect(await verifyAuthentication("u1", SID, [stored], response, ticket, NOW)).toEqual({ factorId: "factor-1", counter: 1, issuedAt: NOW.getTime() });
  });

  it("refuses a signature made by a different key under the registered credential id", async () => {
    const { device, stored } = await registered("u1");
    const thief = softAuthenticator({ key: generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey });
    const { options, ticket } = await authenticationOptions("u1", SID, [stored], NOW);
    // Same credential id and public key as the real device, a signature that is not its own.
    const forged = device.assert(options, ctx) as unknown as AuthenticationResponseJSON;
    const wrongKey = thief.assert(options, ctx) as unknown as AuthenticationResponseJSON;
    forged.response.signature = wrongKey.response.signature;
    expect(await verifyAuthentication("u1", SID, [stored], forged, ticket, NOW)).toBeNull();
  });

  it("refuses another account's credential", async () => {
    const mine = await registered("u1");
    const theirs = await registered("u2");
    const { options, ticket } = await authenticationOptions("u1", SID, [mine.stored], NOW);
    const response = theirs.device.assert(options, ctx) as unknown as AuthenticationResponseJSON;
    expect(await verifyAuthentication("u1", SID, [mine.stored], response, ticket, NOW)).toBeNull();
  });

  it("refuses a challenge issued to another account", async () => {
    const { device, stored } = await registered("u1");
    const { options, ticket } = await authenticationOptions("u2", SID, [stored], NOW);
    const response = device.assert(options, ctx) as unknown as AuthenticationResponseJSON;
    expect(await verifyAuthentication("u1", SID, [stored], response, ticket, NOW)).toBeNull();
  });

  it("refuses a challenge that another session asked for", async () => {
    const { device, stored } = await registered("u1");
    const { options, ticket } = await authenticationOptions("u1", SID, [stored], NOW);
    const response = device.assert(options, ctx) as unknown as AuthenticationResponseJSON;
    expect(await verifyAuthentication("u1", "session-2", [stored], response, ticket, NOW)).toBeNull();
  });

  // This one is the library's sign-count check, and it needs an authenticator that
  // keeps a count. Replay by one that does not (a synced passkey) is refused where
  // the use is recorded: `mfa.int.test.ts`, *sign count stays at zero*.
  it("refuses a replay once the counter has moved on", async () => {
    const { device, stored } = await registered("u1");
    const { options, ticket } = await authenticationOptions("u1", SID, [stored], NOW);
    const response = device.assert(options, ctx) as unknown as AuthenticationResponseJSON;
    const first = await verifyAuthentication("u1", SID, [stored], response, ticket, NOW);
    expect(first).not.toBeNull();
    const afterUse = { ...stored, counter: first!.counter };
    expect(await verifyAuthentication("u1", SID, [afterUse], response, ticket, NOW)).toBeNull();
  });
});
