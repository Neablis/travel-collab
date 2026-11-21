import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

// **A secret this app must be able to read back** (ADR-092 §5). A TOTP secret is
// the one thing here `keyedDigest` cannot hold: verifying a code needs the secret
// itself. AES-256-GCM under a key derived from `MFA_SECRET_KEY`, with a fresh
// 12-byte nonce per seal, so the same secret never seals to the same string and a
// flipped byte fails authentication rather than decrypting to something else.

/** `MFA_SECRET_KEY` is unset or too short, so nothing can be sealed or unsealed. */
export class MfaSecretKeyMissingError extends Error {
  constructor() {
    super(
      "MFA_SECRET_KEY is not set (or is under 32 bytes). Authenticator-app secrets " +
        "are sealed with it, so without it enrolment fails closed. Generate one with " +
        "`openssl rand -base64 32`.",
    );
    this.name = "MfaSecretKeyMissingError";
  }
}

const MIN_KEY_BYTES = 32;
// A label, so the derived key belongs to this use alone.
const LABEL = "caesura mfa sealed secret v1";
const VERSION = "v1";
// Pinned on both sides: Node otherwise accepts a tag of 4 to 16 bytes on decrypt,
// which would leave a doctored row checked against 32 bits instead of 128.
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

// Read per call, not at import: a test sets it, and a missing key fails the
// request that needed it rather than the import of anything that touches this.
function key(): Buffer {
  const raw = process.env.MFA_SECRET_KEY ?? "";
  if (Buffer.byteLength(raw, "utf8") < MIN_KEY_BYTES) throw new MfaSecretKeyMissingError();
  return Buffer.from(hkdfSync("sha256", raw, Buffer.alloc(0), LABEL, 32));
}

/** Whether a key is set, for a route to refuse with 503 before it counts a code against a person. */
export function sealingAvailable(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

/**
 * `v1.<nonce>.<tag>.<ciphertext>`, each part base64url. Throws when the key is unset.
 * `aad` is GCM additional data: it is not stored, and `unseal` fails unless it is
 * given back unchanged, so a sealed value copied onto another row stops opening.
 * It is required, so a caller cannot seal a value unbound by forgetting it.
 */
export function seal(plaintext: string, aad: string): string {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key(), nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [VERSION, nonce, cipher.getAuthTag(), body].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
}

/** The plaintext `seal` made this from. Throws on a missing key, a wrong key, other `aad` or any altered byte. */
export function unseal(sealed: string, aad: string): string {
  const [version, nonce, tag, body, ...extra] = sealed.split(".");
  if (version !== VERSION || !nonce || !tag || body === undefined || extra.length > 0) {
    throw new Error("Not a sealed secret.");
  }
  const nonceBytes = Buffer.from(nonce, "base64url");
  const tagBytes = Buffer.from(tag, "base64url");
  if (nonceBytes.length !== NONCE_BYTES || tagBytes.length !== TAG_BYTES) throw new Error("Not a sealed secret.");
  const decipher = createDecipheriv("aes-256-gcm", key(), nonceBytes, { authTagLength: TAG_BYTES });
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(tagBytes);
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}
