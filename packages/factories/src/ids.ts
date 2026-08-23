// Deterministic v4-shaped UUIDs derived from a Fishery sequence number.
// crypto.randomUUID() in a factory means a failing test's ids differ every
// run, which makes a diff unreadable and a snapshot impossible.
export function uuidFrom(sequence: number, salt = 0): string {
  const hex = (n: number, len: number) => (n >>> 0).toString(16).padStart(len, "0");
  const a = hex(sequence * 2654435761 + salt, 8);
  const b = hex(sequence + salt * 97, 4);
  const c = `4${hex(sequence, 4).slice(1)}`; // version 4
  const d = `a${hex(salt, 4).slice(1)}`; // variant 10xx
  const e = hex(sequence * 40503 + salt * 2246822519, 8) + hex(salt + sequence, 4);
  return `${a}-${b}-${c}-${d}-${e}`;
}
