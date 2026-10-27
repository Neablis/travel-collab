import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

// **The one way this app stores a secret it issued** (ADR-083 §2).
//
// API tokens, and the OAuth server's access tokens, refresh tokens and
// authorization codes, are all stored as `keyedDigest(secret)` with its key
// version beside the digest, and looked up by `keyedDigestCandidates`. One
// helper, so there is one rule to reason about and one place a scanner finding
// is answered.
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
        "To change it without invalidating existing tokens, move the old value " +
        "to API_TOKEN_PEPPER_PREVIOUS.",
    );
    this.name = "ApiTokenPepperMissingError";
  }
}

// The floor `openssl rand -base64 32` clears with room to spare (44 bytes).
const MIN_PEPPER_BYTES = 32;

/** A pepper is set but too short to be a key nobody can guess. */
export class ApiTokenPepperTooShortError extends Error {
  constructor(variable: string) {
    super(
      `${variable} is shorter than ${MIN_PEPPER_BYTES} bytes. A short pepper can be ` +
        "guessed, and a guessed pepper lets a stolen database confirm leaked tokens. " +
        "Generate one with `openssl rand -base64 32`.",
    );
    this.name = "ApiTokenPepperTooShortError";
  }
}

// A fixed label, so the derived key belongs to this use alone: the pepper could
// later key something else without the two digests ever being comparable. A new
// label is a new key, which invalidates every stored digest, and no
// `API_TOKEN_PEPPER_PREVIOUS` can bring them back.
const LABEL = "caesura api secret digest v1";
// A second label for the key's name, so the stored name reveals nothing of the key.
const VERSION_LABEL = "caesura api secret key version v1";

/** A digest and the key it was made under: what a row stores. */
export interface KeyedSecretDigest {
  /**
   * Eight hex characters derived from the pepper, never configured by hand. A
   * hand-set id can be left unchanged when the key changes, and two keys would
   * then share a name.
   */
  keyVersion: string;
  digest: string;
}

/**
 * A pepper variable, read per call rather than captured at module load, so a
 * test can set it and a bad value fails the request that needed it rather than
 * the import of anything that transitively touches this module. `null` when
 * unset or blank; the caller decides whether that is allowed.
 */
function readPepper(variable: string): string | null {
  const value = process.env[variable] ?? "";
  if (value === "") return null;
  if (Buffer.byteLength(value, "utf8") < MIN_PEPPER_BYTES) {
    throw new ApiTokenPepperTooShortError(variable);
  }
  return value;
}

function currentPepper(): string {
  const value = readPepper("API_TOKEN_PEPPER");
  // **Fails closed.** An empty pepper would still produce a stable digest, so
  // tokens would keep working while the key this exists for silently did not.
  if (value === null) throw new ApiTokenPepperMissingError();
  return value;
}

function digestUnder(pepper: string, secret: string): KeyedSecretDigest {
  const key = Buffer.from(hkdfSync("sha256", pepper, Buffer.alloc(0), LABEL, 32));
  const version = Buffer.from(hkdfSync("sha256", pepper, Buffer.alloc(0), VERSION_LABEL, 4));
  return {
    keyVersion: version.toString("hex"),
    digest: createHmac("sha256", key).update(secret, "utf8").digest("hex"),
  };
}

/** `HMAC-SHA256(HKDF(API_TOKEN_PEPPER, LABEL), secret)`, hex. What minting stores. */
export function keyedDigest(secret: string): KeyedSecretDigest {
  return digestUnder(currentPepper(), secret);
}

/**
 * Every digest `secret` could be stored under: the current key's, then
 * `API_TOKEN_PEPPER_PREVIOUS`'s when one is set.
 *
 * **This is what keeps a rotation from logging everyone out.** A token minted
 * before the pepper changed is still found under the previous key until that
 * key is dropped (GitLab's `sha256_candidates`). Lookups use this; minting
 * never does.
 */
export function keyedDigestCandidates(secret: string): KeyedSecretDigest[] {
  return candidatePeppers().map((pepper) => digestUnder(pepper, secret));
}

/**
 * The current pepper, then `API_TOKEN_PEPPER_PREVIOUS` when it is set and
 * differs. Exported for `legacyScrypt.ts`, whose rows were salted with whichever
 * of the two was current before 0069; nothing else reads a pepper directly.
 */
export function candidatePeppers(): string[] {
  const current = currentPepper();
  const previous = readPepper("API_TOKEN_PEPPER_PREVIOUS");
  return previous !== null && previous !== current ? [current, previous] : [current];
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
