// Deterministic ids for bundle content.
//
// A bundle names its rows by a human-readable `key` ("krabi-railay-day"), not
// by a uuid — a content author should not have to mint one, and a diff of two
// versions of a bundle should read as content rather than as ids. But every id
// the database stores is a uuid, and re-importing the same bundle has to land
// on the SAME uuid or the second import is a duplicate library rather than an
// update. So the key is hashed to a uuid, here, once.
//
// **No `node:crypto`.** This package's dependency rule is `@tc/contracts` + zod
// and nothing else (ADR-030), because a real bundled route imports it — a
// `createHash` import would drag Node's crypto into that graph. FNV-1a over
// four salted passes is plenty for what this is: the input space is a few
// hundred hand-written slugs, and a collision is a duplicate id in a checked-in
// fixture that `bundle.test.ts` fails on rather than something a user can
// provoke.

function fnv1a(input: string, seed: number): number {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // The FNV-1a 32-bit prime, 16777619, by shift-add — `Math.imul` keeps it
    // in 32 bits, which plain `*` does not.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

const hex8 = (n: number): string => n.toString(16).padStart(8, "0");

/**
 * A stable uuid for `namespace` + `key`.
 *
 * Shaped as a v4 uuid — version nibble `4`, variant nibble `8` — because every
 * column that takes one of these is `uuid` and every schema that validates one
 * is `z.string().uuid()`. It is not random and does not pretend to be; it is a
 * name, spelled the way this system spells names.
 */
export function bundleId(namespace: string, key: string): string {
  const salted = `${namespace}:${key}`;
  const a = fnv1a(salted, 0x811c9dc5);
  const b = fnv1a(salted, a ^ 0x9e3779b9);
  const c = fnv1a(salted, b ^ 0x85ebca6b);
  const d = fnv1a(salted, c ^ 0xc2b2ae35);
  const hex = `${hex8(a)}${hex8(b)}${hex8(c)}${hex8(d)}`;
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}
