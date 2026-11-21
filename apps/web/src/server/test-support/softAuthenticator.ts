import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import { isoBase64URL, isoCBOR } from "@simplewebauthn/server/helpers";

// A WebAuthn authenticator in software, for tests that must hand the server a
// REAL attestation and a REAL signed assertion: a stubbed `verify` would pass
// whatever the library did with it, and what the passkey tests are about is the
// server refusing the ones that are forged. ES256, no attestation, user
// verified: what a phone's Face ID produces, minus the phone.

const b64 = (bytes: Uint8Array) => isoBase64URL.fromBuffer(bytes as Uint8Array<ArrayBuffer>);
const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest();

export interface SoftAuthenticator {
  credentialId: string;
  /** A response to `navigator.credentials.create`, as the browser library serialises it. */
  attest(options: { challenge: string }, ctx: { origin: string; rpId: string }): Record<string, unknown>;
  /** A response to `navigator.credentials.get`. */
  assert(options: { challenge: string }, ctx: { origin: string; rpId: string }): Record<string, unknown>;
  /** The COSE public key, base64url, as the server stores it. */
  publicKey: string;
}

// `counterStaysZero` is what synced platform passkeys (Apple, Google) do: they
// report a sign count of 0 forever, so the library's counter check never fires.
/** A fresh software authenticator with its own ES256 key pair, which attests and asserts like a real one. */
export function softAuthenticator(overrides: { key?: KeyObject; counterStaysZero?: boolean } = {}): SoftAuthenticator {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const signingKey = overrides.key ?? privateKey;
  const jwk = publicKey.export({ format: "jwk" });
  const cose = isoCBOR.encode(
    new Map<number, number | Uint8Array>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, Buffer.from(jwk.x!, "base64url")],
      [-3, Buffer.from(jwk.y!, "base64url")],
    ]),
  );
  const credentialIdBytes = randomBytes(16);
  const counter = { n: 0 };

  const clientData = (type: string, challenge: string, origin: string) =>
    Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));

  const counterBytes = () => {
    const out = Buffer.alloc(4);
    out.writeUInt32BE(counter.n);
    return out;
  };

  return {
    credentialId: b64(credentialIdBytes),
    publicKey: b64(cose),
    attest(options, { origin, rpId }) {
      const idLength = Buffer.alloc(2);
      idLength.writeUInt16BE(credentialIdBytes.length);
      // flags: user present (1) | user verified (4) | attested credential data (64)
      const authData = Buffer.concat([
        sha256(rpId),
        Buffer.from([0x45]),
        counterBytes(),
        Buffer.alloc(16),
        idLength,
        credentialIdBytes,
        cose,
      ]);
      const attestationObject = isoCBOR.encode(
        new Map<string, string | Map<string, string> | Uint8Array>([
          ["fmt", "none"],
          ["attStmt", new Map()],
          ["authData", authData],
        ]),
      );
      return {
        id: b64(credentialIdBytes),
        rawId: b64(credentialIdBytes),
        type: "public-key",
        response: {
          clientDataJSON: b64(clientData("webauthn.create", options.challenge, origin)),
          attestationObject: b64(attestationObject),
          transports: ["internal"],
        },
        clientExtensionResults: {},
        authenticatorAttachment: "platform",
      };
    },
    assert(options, { origin, rpId }) {
      if (!overrides.counterStaysZero) counter.n += 1;
      const authData = Buffer.concat([sha256(rpId), Buffer.from([0x05]), counterBytes()]);
      const clientDataJSON = clientData("webauthn.get", options.challenge, origin);
      const signature = sign("sha256", Buffer.concat([authData, sha256(clientDataJSON)]), signingKey);
      return {
        id: b64(credentialIdBytes),
        rawId: b64(credentialIdBytes),
        type: "public-key",
        response: {
          clientDataJSON: b64(clientDataJSON),
          authenticatorData: b64(authData),
          signature: b64(signature),
        },
        clientExtensionResults: {},
      };
    },
  };
}
