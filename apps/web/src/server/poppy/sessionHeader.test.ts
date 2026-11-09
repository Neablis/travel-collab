import { describe, expect, it, vi } from "vitest";
import { createMemoryClient } from "@/server/cache/memory";
import { createRedisCache } from "@/server/cache/redis";
import { makeTestAgent, type SessionOver } from "./testAgent";
import { verifySessionHeader } from "./sessionHeader";

// Poppy 5.2 and 5.3. Each refusal is a way a copied, replayed or misaddressed
// Session JWT could be believed: a key that was never delegated, a JWT meant
// for another company, another request or another token.

const ISSUER = "https://caesura.test";
const ORIGIN = "https://caesura.test";
const URL_ = `${ORIGIN}/api/v1/discover/playbooks`;
const NOW = new Date("2026-11-09T12:00:00Z");
const nowSeconds = NOW.getTime() / 1000;

async function setup() {
  const agent = await makeTestAgent({ issuer: ISSUER, now: NOW });
  const loadKeys = vi.fn(async () => ({ ok: true as const, keys: agent.jwks.keys }));
  const tokenClientId = vi.fn<(token: string) => Promise<string | null>>(async () => agent.clientId);
  const cache = createRedisCache(createMemoryClient());
  /** Verify `over` as a request for `url`; `token` is the bearer the request carries. */
  const verify = async (over: Partial<SessionOver> = {}, opts: { token?: string; method?: string; url?: string } = {}) => {
    const url = opts.url ?? URL_;
    const jwt = await agent.session({ htu: URL_, ...over });
    const request = new Request(url.replace(ORIGIN, "http://internal.local"), {
      method: opts.method ?? "GET",
      headers: { "poppy-session": jwt },
    });
    return verifySessionHeader(request, opts.token, { now: NOW, issuer: ISSUER, origin: ORIGIN, cache, loadKeys, tokenClientId });
  };
  return { agent, verify, loadKeys, tokenClientId };
}

const refused = (reason: string) => ({ ok: false, reason: expect.stringContaining(reason) });

describe("verifySessionHeader", () => {
  it("accepts a delegated Session JWT and names the client, Session and User", async () => {
    const { agent, verify } = await setup();
    expect(await verify({ sid: "s1", sub: "usr_1", agentId: "agt_1" })).toEqual({
      ok: true,
      claims: { clientId: agent.clientId, sid: "s1", userId: "usr_1", agentId: "agt_1" },
    });
  });

  it("refuses a JWT with no delegation, and one signed directly with a key from jwks_uri", async () => {
    const { verify } = await setup();
    expect(await verify({ delegation: "none" })).toMatchObject(refused("delegation"));
    expect(await verify({ delegation: "direct" })).toMatchObject(refused("delegation"));
  });

  describe("the delegation, in the order of 5.2", () => {
    it("checks the signature first: a bad signature is named before a bad typ", async () => {
      const { verify } = await setup();
      expect(await verify({ delegation: { unknownSigner: true, typ: "JWT" } })).toMatchObject(refused("delegation signature"));
      expect(await verify({ delegation: { kid: "nope" } })).toMatchObject(refused("delegation signature"));
    });

    it("then its typ, its iss, its expiry and its 24 hour ceiling", async () => {
      const { verify } = await setup();
      expect(await verify({ delegation: { typ: "poppy-session+jwt" } })).toMatchObject(refused("delegation typ"));
      expect(await verify({ delegation: { iss: "https://other.test/agent.json" } })).toMatchObject(refused("delegation iss"));
      expect(await verify({ delegation: { iat: nowSeconds - 7200, exp: nowSeconds - 60 } })).toMatchObject(refused("delegation expired"));
      expect(await verify({ delegation: { exp: nowSeconds + 24 * 3600 + 1, iat: nowSeconds } })).toMatchObject(refused("delegation lifetime"));
    });

    it("then the Session JWT's own signature and that its kid is the delegated key's thumbprint", async () => {
      const { verify } = await setup();
      expect(await verify({ kid: "not-the-thumbprint" })).toMatchObject(refused("kid"));
    });

    it("keeps a verified delegation until it expires, by its jti", async () => {
      const { agent, verify, loadKeys } = await setup();
      const delegated = await agent.delegate();
      expect((await verify({ delegated })).ok).toBe(true);
      expect((await verify({ delegated })).ok).toBe(true);
      // The first verification fetched the key set; the second found the delegation cached.
      expect(loadKeys).toHaveBeenCalledTimes(1);
    });
  });

  it("refuses a typ that is not poppy-session+jwt, and an algorithm that is not ES256", async () => {
    const { verify } = await setup();
    expect(await verify({ typ: "JWT" })).toMatchObject(refused("typ"));
    expect(await verify({ alg: "ES384" })).toMatchObject(refused("alg"));
  });

  it("refuses an aud that is not the issuer, as one string, character for character", async () => {
    const { verify } = await setup();
    for (const aud of ["https://other.test", `${ISSUER}/`, [ISSUER]]) {
      expect(await verify({ aud }), JSON.stringify(aud)).toMatchObject(refused("aud"));
    }
  });

  it("refuses an htm or htu that is not this request, and ignores the query", async () => {
    const { verify } = await setup();
    expect(await verify({}, { method: "POST" })).toMatchObject(refused("htm"));
    expect(await verify({ htu: `${ORIGIN}/api/v1/other` })).toMatchObject(refused("htu"));
    expect(await verify({ htu: "https://evil.test/api/v1/discover/playbooks" })).toMatchObject(refused("htu"));
    expect((await verify({ htu: `${URL_}?limit=5` }, { url: `${URL_}?cursor=x` })).ok).toBe(true);
  });

  it("takes an iat within a minute either side and refuses beyond it", async () => {
    const { verify } = await setup();
    expect((await verify({ iat: nowSeconds - 59 })).ok).toBe(true);
    expect((await verify({ iat: nowSeconds + 59 })).ok).toBe(true);
    expect(await verify({ iat: nowSeconds - 61, delegation: { iat: nowSeconds - 100 } })).toMatchObject(refused("iat"));
    expect(await verify({ iat: nowSeconds + 61 })).toMatchObject(refused("iat"));
  });

  it("refuses a Session JWT missing a claim 5.2 requires", async () => {
    const { verify } = await setup();
    expect(await verify({ jti: null })).toMatchObject({ ok: false });
    expect(await verify({ sid: "" })).toMatchObject({ ok: false });
    expect(await verify({ sub: "" })).toMatchObject({ ok: false });
  });

  describe("with an access token", () => {
    it("takes an ath that is the token's hash, from the client the token was issued to", async () => {
      const { verify } = await setup();
      expect((await verify({ accessToken: "tco_abc" }, { token: "tco_abc" })).ok).toBe(true);
    });

    it("refuses a missing ath and a wrong one", async () => {
      const { verify } = await setup();
      expect(await verify({}, { token: "tco_abc" })).toMatchObject(refused("ath"));
      expect(await verify({ accessToken: "tco_other" }, { token: "tco_abc" })).toMatchObject(refused("ath"));
    });

    it("refuses an ath when the request carries no token", async () => {
      const { verify } = await setup();
      expect(await verify({ accessToken: "tco_abc" })).toMatchObject(refused("ath"));
    });

    it("refuses a token issued to another client_id than iss, or to none", async () => {
      const { verify, tokenClientId } = await setup();
      tokenClientId.mockResolvedValueOnce("https://other.test/agent.json");
      expect(await verify({ accessToken: "tco_abc" }, { token: "tco_abc" })).toMatchObject(refused("client"));
      tokenClientId.mockResolvedValueOnce(null);
      expect(await verify({ accessToken: "tco_abc" }, { token: "tco_abc" })).toMatchObject(refused("client"));
    });
  });

  it("refuses a client whose keys cannot be had", async () => {
    const { agent } = await setup();
    const jwt = await agent.session({ htu: URL_ });
    const outcome = await verifySessionHeader(new Request(URL_, { headers: { "poppy-session": jwt } }), undefined, {
      now: NOW,
      issuer: ISSUER,
      origin: ORIGIN,
      cache: createRedisCache(createMemoryClient()),
      loadKeys: async () => ({ ok: false, reason: "not a Personal Agent" }),
    });
    expect(outcome).toMatchObject(refused("not a Personal Agent"));
  });
});
