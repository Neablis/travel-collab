import { randomUUID } from "node:crypto";
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import type { Fetcher } from "@/server/external/remoteImage/fetchImage";
import type { Resolve } from "@/server/external/remoteImage/guard";

// **A Personal Agent for tests** (Poppy 4.1): an ES256 key, its CIMD document
// and key set, and assertions it signs. `fetch` serves both documents, so a
// test hands it to `resolveClient` and nothing touches the network. Tests only:
// the keys are generated per agent and the clock is the caller's.

/** A public address, so the guard's pre-flight passes without DNS. */
export const publicResolve: Resolve = async () => [{ address: "93.184.216.34", family: 4 }];

export interface TestAgent {
  clientId: string;
  jwksUri: string;
  document: Record<string, unknown>;
  jwks: { keys: JWK[] };
  /** Serves the document and the key set; any other URL is a 404. */
  fetch: Fetcher;
  /** A signed client assertion; `claims` and `header` override the valid defaults. */
  assertion(over?: { aud?: unknown; iss?: string; sub?: string; jti?: string | null; iat?: number; exp?: number; alg?: string }): Promise<string>;
}

/** A valid agent at `https://<host>/agent.json`; `document` overrides what its metadata says. */
export async function makeTestAgent(
  opts: { host?: string; issuer: string; now?: Date; document?: Record<string, unknown> },
): Promise<TestAgent> {
  const host = opts.host ?? `agent-${randomUUID()}.test`;
  const clientId = `https://${host}/agent.json`;
  const jwksUri = `https://${host}/jwks.json`;
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  const jwks = { keys: [{ ...(await exportJWK(publicKey)), kid: "k1", alg: "ES256", use: "sig" }] };
  const document = {
    client_id: clientId,
    client_name: "Test Agent",
    logo_uri: `https://${host}/logo.png`,
    jwks_uri: jwksUri,
    redirect_uris: [`https://${host}/oauth/callback`],
    token_endpoint_auth_method: "private_key_jwt",
    ...opts.document,
  };
  const served: Record<string, unknown> = { [clientId]: document, [jwksUri]: jwks };
  const fetch: Fetcher = async (url) =>
    url.href in served ? new Response(JSON.stringify(served[url.href]), { status: 200 }) : new Response("", { status: 404 });
  const nowSeconds = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  return {
    clientId,
    jwksUri,
    document,
    jwks,
    fetch,
    async assertion(over = {}) {
      const iat = over.iat ?? nowSeconds;
      // Another algorithm is signed by its own key, which is in the key set too:
      // what refuses it is the algorithm list, never a key that does not match.
      let key: CryptoKey = privateKey;
      let kid = "k1";
      if (over.alg !== undefined && over.alg !== "ES256") {
        const other = await generateKeyPair(over.alg, { extractable: true });
        kid = `k-${over.alg}`;
        jwks.keys.push({ ...(await exportJWK(other.publicKey)), kid, alg: over.alg, use: "sig" });
        key = other.privateKey;
      }
      const jwt = new SignJWT({ ...(over.jti === null ? {} : { jti: over.jti ?? randomUUID() }) })
        .setProtectedHeader({ alg: over.alg ?? "ES256", kid })
        .setIssuer(over.iss ?? clientId)
        .setSubject(over.sub ?? clientId)
        .setIssuedAt(iat)
        .setExpirationTime(over.exp ?? iat + 60);
      jwt.setAudience((over.aud ?? opts.issuer) as string);
      return jwt.sign(key);
    },
  };
}
