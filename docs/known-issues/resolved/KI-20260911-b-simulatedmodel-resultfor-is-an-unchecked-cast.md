### KI-2026-09-11-b — `simulatedModel`'s `resultFor<T>` is an unchecked cast over the agent's untyped message history — RESOLVED

**Resolved 2026-09-12.** `resultFor<T>` now looks up the tool's `output` zod
schema off `ASSISTANT_TOOLS` (`apps/web/src/server/assistant/registry.ts`,
the same registry the real path is built from) and `safeParse`s the message
history's value through it, instead of casting. A shape that fails to parse
is treated the same as "this tool has no result yet" (`undefined`), which is
the graceful-degradation path every caller already had for a tool that had
not been called — so a malformed readout now degrades the answer instead of
throwing mid-map three frames away.

**Reproduced first**, with a test that called `simulatedModel().doGenerate`
with a `read_trip` result missing its (schema-required) `conflicts` field.
Before the fix that threw:
```
TypeError: Cannot read properties of undefined (reading 'length')
 ❯ askAnswer src/server/ai/simulatedModel.ts:345:44
    343|   // clash on day 9 inside an answer about day 3 is precisely the wand…
    344|   // M16's gate refuses.
    345|   if (!dayScoped && trip && trip.conflicts.length > 0) {
       |                                            ^
```
After the fix the same call returns the honest fallback sentence
("I couldn't read anything about this trip. AI is switched off…") instead of
throwing.

Fixing `resultFor` to validate against the real schema also surfaced that
`simulatedModel.test.ts`'s own `TRIP_READOUT` fixture (and two ad hoc `days`
arrays built from it) predated `TripDayReadout.cities` and therefore no
longer conformed to `TripReadoutSchema` — exactly the "stale assumption a
cast used to paper over" shape the KI describes, one level up, in the test
fixtures rather than production code (production's `read_trip` always
supplies `cities` via `citiesOfDay`, so this was never reachable at runtime).
Added `cities: []` to each day literal in that file so the fixtures describe
a real `TripReadout` again; no assertion was weakened.

That reproduction was kept as a **permanent regression test** —
`simulatedModel.test.ts`'s `"degrades to the honest fallback instead of
throwing when a tool result does not match its own schema"` — because the
repaired fixture alone does not guard the cast from coming back (a fixture
that already parses cleanly stays green whether `resultFor` parses or casts).
Proven red-first the repo's way: with `resultFor` reverted to
`found?.output as T | undefined`, running just that test gave
```
TypeError: Cannot read properties of undefined (reading 'length')
 ❯ askAnswer src/server/ai/simulatedModel.ts:372:44
    370|   // clash on day 9 inside an answer about day 3 is precisely the wand…
    371|   // M16's gate refuses.
    372|   if (!dayScoped && trip && trip.conflicts.length > 0) {
       |                                            ^
    373|     sentences.push(
    374|       `${trip.conflicts.length} conflict${trip.conflicts.length === 1 …
 ❯ askTurn src/server/ai/simulatedModel.ts:707:60
 ❯ step src/server/ai/simulatedModel.ts:736:61
 ❯ Object.doGenerate src/server/ai/simulatedModel.ts:744:41
 ❯ src/server/ai/simulatedModel.test.ts:295:21
```
(same throw, later line numbers — the cast-restoring edit was applied on top
of the fixed file, which had grown a doc comment above `resultFor` in the
meantime). Restoring the `safeParse` fix turned it green again.

The stale comment in `playbookCalls` that described `resultFor` as "a cast…
not a parsed readout" was also corrected — it was true when written and false
after this fix — without touching the `?? []` guard it explains, which stays
as defensive code now rather than load-bearing.

**Proof:** both throws above reproduced and then stopped; the full
`simulatedModel.test.ts` (54 tests, including the permanent regression case)
and `askChipCoverage.test.ts` (which drives the real `read_trip` through this
same model) both pass; `pnpm --filter web typecheck` and `pnpm --filter web
lint` are clean.

Files touched: `apps/web/src/server/ai/simulatedModel.ts`,
`apps/web/src/server/ai/simulatedModel.test.ts`.

The original entry follows, unchanged.

---

### (original) `simulatedModel`'s `resultFor<T>` is an unchecked cast over the agent's untyped message history

- **Severity:** cleanup (test-path only today — the simulated model never runs against a real provider — but it is the KI-9 shape in the one module KI-9's fix does not reach)
- **Area:** `apps/web/src/server/ai/simulatedModel.ts` (`resultFor<T>`)
- **Symptom:** the stand-in model reads prior tool results out of the agent's message history, which is untyped, and casts them to the readout type it expects. Nothing parses. A readout missing a field the cast promises is a runtime throw inside the simulated path, not a type error — found in P4 when a `TripReadout` whose `days[].cities` was absent threw while being mapped over, taking three `simulatedModel.test.ts` cases with it.
- **Why it matters despite being test-only:** the simulated model is what `ai-live: false` serves, which is **every deployment today** (ADR-019 — the flag defaults off). So this is the code path most users would actually hit, and the one the e2e suite asserts against. It is also the module most likely to break silently when a readout changes shape, because the cast makes the compiler agree with a stale assumption.
- **Why not fixed in P4:** a `?? []` was added at the single site P4 touched, deliberately, because the fix is a whole-module concern — every `resultFor` call site wants the same zod parse that `defineTool`'s required `output` schema already provides for the real path. **The schemas already exist**; this is wiring them into the stand-in, not writing them.
- **Fix path:** have `resultFor<T>` take the tool's `output` schema from the registry (`ASSISTANT_TOOLS`) and `safeParse` rather than cast, so a shape change fails in the stand-in the same way it fails in the real path.
- **Cross-reference:** KI-9 (the hub — `defineTool`'s required output schema closed the real path 2026-09-10 and did not reach this one), ADR-019 (the kill switch, and why this path is the default), ADR-043 (M9 Phase 0).
- **First noted:** 2026-09-11, by M9 Phase 0 P4.
