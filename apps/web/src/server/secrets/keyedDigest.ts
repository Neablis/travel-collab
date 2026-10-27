import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

// **The one way this app stores a secret it issued** (ADR-083 §2).
//
// API tokens, and the OAuth server's access tokens, refresh tokens and
// authorization codes, are all stored as `keyedDigest(secret)` and looked up by
// it. One helper, so there is one rule to reason about and one place a scanner
// finding is answered.
//
// **HMAC, not a slow KDF.** Every secret this digests is 32 bytes of
// `randomBytes`: there is no space to guess through, so a work factor buys
// nothing. Scrypt cost ~37ms of CPU on every authenticated request, and an OAuth
// server would pay it again on every refresh. If a scanner raises
// `js/insufficient-password-hash` against this, it is dismissed citing ADR-083.
//
// **Keyed, so the database alone cannot verify a secret.** A stolen backup does
// not let anyone confirm which row a leaked plaintext belongs to.

/** The pepper is missing, so no secret can be issued or verified. */
export class ApiTokenPepperMissingError extends Error {
  constructor() {
    super(
      "API_TOKEN_PEPPER is not set. API tokens are keyed with it, so without it " +
        "no token can be minted or verified. Generate one with " +
        "`openssl rand -base64 32` and set it wherever this app runs. " +
        "Changing it invalidates every existing token, by design.",
    );
    this.name = "ApiTokenPepperMissingError";
  }
}

// A fixed label, so the derived key belongs to this use alone: the pepper could
// later key something else without the two digests ever being comparable. A new
// label is a new key, which invalidates every stored digest exactly as rotating
// the pepper does.
const LABEL = "caesura api secret digest v1";

/**
 * The pepper, read per call rather than captured at module load, so a test can
 * set it and a missing value fails the request that needed it rather than the
 * import of anything that transitively touches this module.
 */
function pepper(): string {
  const value = process.env.API_TOKEN_PEPPER ?? "";
  // **Fails closed.** An empty pepper would still produce a stable digest, so
  // tokens would keep working while the key this exists for silently did not.
  if (value === "") throw new ApiTokenPepperMissingError();
  return value;
}

function derivedKey(): Buffer {
  return Buffer.from(hkdfSync("sha256", pepper(), Buffer.alloc(0), LABEL, 32));
}

/** `HMAC-SHA256(HKDF(API_TOKEN_PEPPER, LABEL), secret)`, hex. */
export function keyedDigest(secret: string): string {
  return createHmac("sha256", derivedKey()).update(secret, "utf8").digest("hex");
}

/**
 * Compare two digests without leaking where they differ.
 *
 * The lookup is an indexed equality select, so this is belt-and-braces over a
 * comparison Postgres already made, but a credential comparison that is only
 * *sometimes* constant-time is the inconsistency that becomes a finding later.
 */
export function digestsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  // `timingSafeEqual` throws on a length mismatch. Every digest here is 64 hex
  // characters, so a mismatch is a corrupted row, not a probe worth hiding.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
