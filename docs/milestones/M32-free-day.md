# M32 — The assistant can say which day is free, in one call

**Status:** Minted 2026-10-04 from Mitchell's live turns, placed after M31 and built beside it
while M31's last two boxes wait on him. Small: one domain function, one tool's output, one
ledger column.

## Why this exists

Mitchell, 2026-10-04, on production, trip-scoped: *"Which day has the most free time?"*

The `ai.ask` record for that turn (`24691afd-…`, `zai/glm-4.7-flashx`, cheap tier):

- **Ten tool calls**: `read_trip`, then `find_free_time` once per day, `day: 1` through
  `day: 9`. One call with no `day` already searches the whole trip, but it returns a flat list
  of gaps with no per-day total, so the model added them up itself, one day at a time.
- **A wrong answer**: *"Day 8 has the most free time with 1,260 minutes (21 hours total)"*. The
  window defaulted to 00:00–24:00, so sleep counted as free, and an empty day scored 24 hours.
- **162 seconds** of latency, of which the tools took under half a second. The ledger could not
  say which of the three steps was slow: every step row carries the turn's timestamp, and none
  carries a duration.

Mitchell:

> *"The 162s model call is not normal, also it shouldnt have taken 10 find_free_time here, i
> asked what day is the most free, maybe we should have a tool that can find that quicker since
> its a common question, maybe a deterministic tool that takes a variety of scans of the day for
> open slots"*

Then, on the proposal: *"Hardcode 8-22 for now, make it a small milestone."*

## Decisions

1. **`find_free_time` answers the question rather than a new tool.** Every offered tool's schema
   is paid on every step of every turn, and ADR-022 earns a tool by a new computation or a new
   capability boundary. Ranking days is the same computation as finding gaps, summed per day.
2. **The day is 08:00–22:00, hard-coded** (Mitchell, 2026-10-04). Morning 08:00–12:00,
   afternoon 12:00–17:00, evening 17:00–22:00. There is no waking-hours preference to read; one
   can replace the constant later without changing the tool. An explicit `after` at or past
   22:00 opens the window to 24:00, and an explicit `before` at or before 08:00 opens it from
   00:00, so "anything after 11pm?" still has an answer.
3. **The arithmetic is in the domain** (`packages/domain/src/trip/freeTime.ts`), next to
   `findFreeGaps`, per ADR-022 §2. The tool translates and nothing else.
4. **A day's free minutes are the sum of the gaps the same call lists.** Ranking and gaps can
   never disagree, because the ranking is computed from the gap list.
5. **Untimed stops still occupy no time** (the existing rule), but each day's row counts them,
   so a day that is "free" only because nothing on it has a time can say so.

## Scope

1. **`summarizeFreeDays`** in the domain: per day, free minutes in total and per part of the
   day, the longest gap, and the count of untimed stops, ranked most free first (ties: longer
   longest gap, then earlier day).
2. **`find_free_time` returns `days`**, that ranking, beside `gaps`, and defaults to 08:00–22:00.
   Its description says one call answers "which day is most free", and never to call it once
   per day. The simulated model's waking-hours constant becomes the domain's.
3. **Per-step `duration_ms`** on `ai_usage_steps` (migration `0037`): wall time from the agent's
   start, or the previous step's end, to this step's end, tool calls included. With
   `ai_usage_tool_calls.duration_ms` beside it, model time is the difference.
4. **A known-issues entry** for the 162-second cheap-tier turn, open until a step duration says
   where the time went.
5. **The live set gains `q-most-free`**, *"which day has the most free time?"*, under a new id
   (the file's rule: prompts are added, never edited).

## Out of scope

- A per-account or per-trip waking-hours preference.
- Fixing the cheap-tier model's latency itself: that needs the step durations this adds first.
- M31's baseline, which is M31's.

## Exit gate

- [ ] **`summarizeFreeDays` ranks days by free time inside 08:00–22:00**, with the parts of the
      day, the longest gap and untimed stops. Unit tests, and a property test that a day's
      total equals the sum of its listed gaps and never exceeds the window. Each seen red.
- [ ] **One whole-trip `find_free_time` call answers "which day is most free"**: `days` is
      ranked, the default window is 08:00–22:00, and the late-night and early-morning openings
      hold. `readTools.test.ts`, seen red.
- [ ] **The context budget is re-measured.** `contextBudget.baseline.json` moves by the tool's
      new description and nothing else, and the commit says by how much.
- [ ] **Each step row carries `duration_ms`**, migration `0037`. A unit test of the recorder and
      the ledger integration test, each seen red. The PR names the migration, and
      `migrate-production` is dispatched after merge.
- [ ] **KI filed** for the 162-second turn; `q-most-free` added to the live set.
- [ ] **[walk]** On production after the dispatch: *"Which day has the most free time?"* on a
      multi-day trip is answered from **one** `find_free_time` call, names a day by its
      daytime hours, and the turn's step rows carry durations.
- [ ] A retro is appended at gate close.
