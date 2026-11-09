import { describe, expect, it } from "vitest";
import { createMemoryClient } from "@/server/cache/memory";
import { createRedisCache } from "@/server/cache/redis";
import { makeTestAgent } from "@/server/poppy/testAgent";
import { verifyClientAssertion } from "./clientAssertion";

// RFC 7523 as Poppy 4.1 narrows it. Each case is a way a stolen or misaddressed
// assertion could be accepted: another server's audience (the token endpoint
// included), a weak algorithm, a long life, a second use.

const ISSUER = "https://caesura.test";
const NOW = new Date("2026-11-09T12:00:00Z");
const nowSeconds = NOW.getTime() / 1000;

async function setup() {
  const agent = await makeTestAgent({ issuer: ISSUER, now: NOW });
  const cache = createRedisCache(createMemoryClient());
  const verify = (assertion: string) =>
    verifyClientAssertion(assertion, { clientId: agent.clientId, issuer: ISSUER, keys: agent.jwks.keys, now: NOW, cache });
  return { agent, verify };
}

describe("verifyClientAssertion", () => {
  it("accepts a fresh ES256 assertion for this issuer", async () => {
    const { agent, verify } = await setup();
    expect(await verify(await agent.assertion())).toEqual({ ok: true });
  });

  it("refuses any aud but the issuer, character for character", async () => {
    const { agent, verify } = await setup();
    for (const aud of [`${ISSUER}/api/oauth/token`, `${ISSUER}/`, "https://other.test", [ISSUER]]) {
      expect(await verify(await agent.assertion({ aud })), JSON.stringify(aud)).toMatchObject({ ok: false });
    }
  });

  it("accepts PS384, which Poppy 4.1 says a Company SHOULD", async () => {
    const { agent, verify } = await setup();
    expect(await verify(await agent.assertion({ alg: "PS384" }))).toEqual({ ok: true });
  });

  it("refuses an algorithm that is neither ES256 nor PS384", async () => {
    const { agent, verify } = await setup();
    expect(await verify(await agent.assertion({ alg: "ES384" }))).toMatchObject({ ok: false });
  });

  it("refuses a long-lived assertion, an expired one, and one for another client", async () => {
    const { agent, verify } = await setup();
    expect(await verify(await agent.assertion({ exp: nowSeconds + 3600 }))).toMatchObject({ ok: false });
    expect(await verify(await agent.assertion({ iat: nowSeconds - 600, exp: nowSeconds - 300 }))).toMatchObject({ ok: false });
    // A future `iat` keeps a 5 minute `exp - iat` valid for as long as it is dated ahead.
    expect(await verify(await agent.assertion({ iat: nowSeconds + 86400, exp: nowSeconds + 86400 + 60 }))).toMatchObject({ ok: false });
    expect(await verify(await agent.assertion({ iss: "https://other.test/agent.json" }))).toMatchObject({ ok: false });
    expect(await verify(await agent.assertion({ sub: "https://other.test/agent.json" }))).toMatchObject({ ok: false });
  });

  it("refuses an assertion with no jti, and a jti presented twice", async () => {
    const { agent, verify } = await setup();
    expect(await verify(await agent.assertion({ jti: null }))).toMatchObject({ ok: false });
    const once = await agent.assertion();
    expect(await verify(once)).toEqual({ ok: true });
    expect(await verify(once)).toMatchObject({ ok: false });
  });
});
