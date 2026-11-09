import { createHash, randomUUID } from "node:crypto";
import { calculateJwkThumbprint, exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import type { Fetcher } from "@/server/external/remoteImage/fetchImage";
import type { Resolve } from "@/server/external/remoteImage/guard";

// **A Personal Agent for tests** (Poppy 4.1): an ES256 key, its CIMD document
// and key set, and assertions it signs. `fetch` serves both documents, so a
// test hands it to `resolveClient` and nothing touches the network. Tests only:
// the keys are generated per agent and the clock is the caller's.

/** A public address, so the guard's pre-flight passes without DNS. */
export const publicResolve: Resolve = async () => [{ address: "93.184.216.34", family: 4 }];

/** What a Session JWT (Poppy 5.2) holds; every field overrides a valid default. */
export interface SessionOver {
  /** The request it is signed for; there is no default, since a Session JWT is for one URL. */
  htu: string;
  htm?: string;
  sid?: string;
  sub?: string;
  agentId?: string;
  aud?: unknown;
  iss?: string;
  iat?: number;
  jti?: string | null;
  /** The access token it rides with; sets `ath` to its hash unless `ath` says otherwise. */
  accessToken?: string;
  /** `null` leaves `ath` out; a string is sent as it is. */
  ath?: string | null;
  typ?: string;
  /** The delegated key's algorithm; the Session JWT is signed with it. */
  alg?: string;
  /** `kid` as sent; the key's thumbprint by default. */
  kid?: string;
  /** Overrides on the delegation, or `"none"` to send no `poppy_dlg`, or `"direct"` to sign with the agent's own key too. */
  delegation?: "none" | "direct" | DelegationOver;
  /** A delegation already made, so several JWTs carry the very same one, as an agent's do. */
  delegated?: Delegated;
}

export interface Delegated {
  /** The delegation, compact: what `poppy_dlg` carries. */
  dlg: string;
  key: CryptoKey;
  /** The key's thumbprint, which a Session JWT's `kid` is. */
  kid: string;
}

export interface DelegationOver {
  typ?: string;
  iss?: string;
  iat?: number;
  exp?: number;
  jti?: string;
  /** The `kid` it names; "k1" is in the key set. */
  kid?: string;
  /** Signed by a key the key set does not hold. */
  unknownSigner?: boolean;
}

/** The hash a Session JWT's `ath` carries (RFC 9449 section 4.2), computed here and not by the code under test. */
export const accessTokenHash = (token: string) => createHash("sha256").update(token).digest("base64url");

export interface TestAgent {
  clientId: string;
  jwksUri: string;
  document: Record<string, unknown>;
  jwks: { keys: JWK[] };
  /** Serves the document and the key set; any other URL is a 404. */
  fetch: Fetcher;
  delegate(over?: DelegationOver, alg?: string): Promise<Delegated>;
  /** A signed Session JWT with its delegation, as the agent would send in `Poppy-Session`. */
  session(over: SessionOver): Promise<string>;
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
  /** A delegated key and the delegation the agent's key set vouches for it with (Poppy 5.2). */
  async function delegate(dlg: DelegationOver = {}, alg = "ES256"): Promise<Delegated> {
    const pair = await generateKeyPair(alg, { extractable: true });
    const jwk = await exportJWK(pair.publicKey);
    const iat = dlg.iat ?? nowSeconds;
    // A signer outside the key set is a fresh key; otherwise the agent's own.
    const signer = dlg.unknownSigner ? (await generateKeyPair("ES256", { extractable: true })).privateKey : privateKey;
    const signed = await new SignJWT({ cnf: { jwk }, jti: dlg.jti ?? randomUUID() })
      .setProtectedHeader({ alg: "ES256", typ: dlg.typ ?? "poppy-delegation+jwt", kid: dlg.kid ?? "k1" })
      .setIssuer(dlg.iss ?? clientId)
      .setIssuedAt(iat)
      .setExpirationTime(dlg.exp ?? iat + 3600)
      .sign(signer);
    return { dlg: signed, key: pair.privateKey, kid: await calculateJwkThumbprint(jwk) };
  }
  return {
    clientId,
    jwksUri,
    document,
    jwks,
    fetch,
    delegate,
    async session(over) {
      const iat = over.iat ?? nowSeconds;
      const alg = over.alg ?? "ES256";
      const header: Record<string, unknown> = { typ: over.typ ?? "poppy-session+jwt", alg };
      let signer: CryptoKey;
      if (over.delegation === "direct") {
        // Signed with a key from `jwks_uri` itself: what a delegation exists to avoid.
        header.kid = "k1";
        signer = privateKey;
      } else {
        const delegated = over.delegated ?? (await delegate({ ...(typeof over.delegation === "object" ? over.delegation : {}), iat }, alg));
        header.kid = over.kid ?? delegated.kid;
        if (over.delegation !== "none") header.poppy_dlg = delegated.dlg;
        signer = delegated.key;
      }
      const ath = over.ath === undefined ? (over.accessToken === undefined ? null : accessTokenHash(over.accessToken)) : over.ath;
      const jwt = new SignJWT({
        sid: over.sid ?? "sid-" + randomUUID(),
        sub: over.sub ?? "usr_test",
        ...(over.agentId === undefined ? {} : { agent_id: over.agentId }),
        htm: over.htm ?? "GET",
        htu: over.htu,
        ...(over.jti === null ? {} : { jti: over.jti ?? randomUUID() }),
        ...(ath === null ? {} : { ath }),
      })
        .setProtectedHeader(header as { alg: string })
        .setIssuer(over.iss ?? clientId)
        .setAudience((over.aud ?? opts.issuer) as string)
        .setIssuedAt(iat);
      return jwt.sign(signer);
    },
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
