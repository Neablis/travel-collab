// Deterministic v4-shaped UUIDs derived from a Fishery sequence number.
// crypto.randomUUID() in a factory means a failing test's ids differ every
// run, which makes a diff unreadable and a snapshot impossible.

// A hex group is a *fixed-width* field, so it has to be clamped on both ends.
// `padStart` alone only pads short — it never truncates — so before KI-38 a
// value that outgrew its digit budget silently widened its own group and the
// function returned a string with the right dash *positions* but wrong group
// *lengths* (`9e377d99-17ae9-4001-...`, 5 digits in group `b`): not a v4 UUID
// and not something `z.string().uuid()` accepts. That was live, not latent —
// `tripDetailFactory` passes salts >= 1000 and `salt * 97` clears 0x10000 at
// sequence 1, so every activity/backlog id it built was malformed. Masking
// (rather than throwing on out-of-range, as KI-38 first proposed) is what
// keeps those callers working: `% 16 ** len` is the identity for any value
// already inside its budget, so every id that was well-formed before is
// byte-identical after, and only the already-broken ones change.
const hexGroup = (n: number, len: number) => ((n >>> 0) % 16 ** len).toString(16).padStart(len, "0");

// `n >>> 0` maps anything non-integral or negative onto some unrelated uint32
// (NaN and -0 and 4294967296 all collapse to 0), which is the same class of
// silent-wrong-output this function just stopped committing. Callers pass
// Fishery sequence numbers and small literal salts; anything else is misuse.
function assertIndex(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`uuidFrom: ${name} must be a non-negative safe integer, got ${value}`);
  }
}

export function uuidFrom(sequence: number, salt = 0): string {
  assertIndex("sequence", sequence);
  assertIndex("salt", salt);
  const a = hexGroup(sequence * 2654435761 + salt, 8);
  const b = hexGroup(sequence + salt * 97, 4);
  const c = `4${hexGroup(sequence, 4).slice(1)}`; // version 4
  const d = `a${hexGroup(salt, 4).slice(1)}`; // variant 10xx
  const e = hexGroup(sequence * 40503 + salt * 2246822519, 8) + hexGroup(salt + sequence, 4);
  return `${a}-${b}-${c}-${d}-${e}`;
}
