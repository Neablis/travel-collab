import { test } from "node:test";
import assert from "node:assert/strict";
import { decision } from "./fixture.mjs";

// `decision()` used to return null for BOTH "the hook allowed silently" and
// "the hook crashed with no JSON on stdout" (runHookRaw sets `json` to null
// in the latter case). Those are the expected value in every allow-path
// test in this suite, so a hook that exited non-zero with no output would
// pass those tests silently instead of failing loudly. A non-zero exit must
// throw so a crash cannot be mistaken for an allow decision.

test("decision throws when the hook exited non-zero, including status and stderr", () => {
  const res = { status: 1, stdout: "", stderr: "TypeError: boom", json: null };
  assert.throws(() => decision(res), /1/);
  assert.throws(() => decision(res), /boom/);
});

test("decision still returns null for a successful hook with no permission decision", () => {
  const res = { status: 0, stdout: "", stderr: "", json: null };
  assert.equal(decision(res), null);
});

test("decision still extracts the permission decision from a successful hook", () => {
  const res = {
    status: 0,
    stdout: "",
    stderr: "",
    json: { hookSpecificOutput: { permissionDecision: "ask" } },
  };
  assert.equal(decision(res), "ask");
});
