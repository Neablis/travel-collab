import { describe, expect, it } from "vitest";
import { CreateSnapshotInput, RenameSnapshotInput, SNAPSHOT_NAME_MAX } from "../src/index.ts";

// The name rule is the one thing these schemas decide; the table's CHECK holds
// the same bound (migration 0045), so a name this accepts is one Postgres takes.
describe.each([
  ["CreateSnapshotInput", CreateSnapshotInput],
  ["RenameSnapshotInput", RenameSnapshotInput],
] as const)("%s", (_, schema) => {
  it("trims the name, and takes one of exactly the maximum length", () => {
    expect(schema.parse({ name: "  Before Kyoto  " }).name).toBe("Before Kyoto");
    expect(schema.parse({ name: "x".repeat(SNAPSHOT_NAME_MAX) }).name).toHaveLength(80);
  });

  it.each([[""], ["   "], ["x".repeat(SNAPSHOT_NAME_MAX + 1)]])("refuses %j", (name) => {
    expect(schema.safeParse({ name }).success).toBe(false);
  });
});
