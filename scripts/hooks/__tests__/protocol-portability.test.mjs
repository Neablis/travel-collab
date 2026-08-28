import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The protocol's whole portability claim is that three of its four documents
// name nothing about this repository. That claim is worth exactly as much as
// the test enforcing it, so here it is enforced.
//
// The forbidden-token list lives in adapter.json (portabilityForbiddenTokens)
// rather than being duplicated here, so there is exactly one copy to keep in
// sync when the list changes.

const PORTABLE = [
  ".claude/protocol/CONTRACT.md",
  ".claude/protocol/DISPATCH-TEMPLATE.md",
  ".claude/protocol/REPORT-TEMPLATE.md",
];

const adapter = JSON.parse(readFileSync(".claude/protocol/adapter.json", "utf8"));
const FORBIDDEN = adapter.portabilityForbiddenTokens;

test("the adapter's forbidden-token list is a non-empty array of strings", () => {
  assert.ok(Array.isArray(FORBIDDEN), "portabilityForbiddenTokens must be an array");
  assert.ok(FORBIDDEN.length > 0, "portabilityForbiddenTokens must not be empty");
  for (const token of FORBIDDEN) {
    assert.equal(typeof token, "string", `forbidden token ${JSON.stringify(token)} must be a string`);
  }
});

test("portable protocol files name nothing repo-specific", () => {
  for (const rel of PORTABLE) {
    const text = readFileSync(rel, "utf8");
    for (const token of FORBIDDEN) {
      assert.ok(
        !text.includes(token),
        `${rel} mentions "${token}" — repo-specific facts belong in ADAPTER.md`,
      );
    }
  }
});

test("the adapter carries the machine-readable half", () => {
  assert.ok(Array.isArray(adapter.exclusiveCommands), "exclusiveCommands must be an array");
  assert.ok(adapter.exclusiveCommands.length > 0, "at least one exclusive resource must be declared");
  for (const entry of adapter.exclusiveCommands) {
    assert.equal(typeof entry.resource, "string");
    assert.equal(typeof entry.symptom, "string");
    // `new RegExp(undefined)` does NOT throw — it compiles to /(?:)/ — so
    // doesNotThrow alone let a misspelled or omitted `pattern` key pass CI
    // green while resource-lease.mjs correctly skipped the entry, leaving
    // the resource silently unleased. The type check is what closes that.
    assert.equal(typeof entry.pattern, "string", `missing pattern for ${entry.resource}`);
    assert.doesNotThrow(() => new RegExp(entry.pattern), `bad pattern for ${entry.resource}`);
  }
});
