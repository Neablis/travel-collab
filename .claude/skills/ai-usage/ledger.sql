-- The ai-usage skill's database queries (M31 Phase 1, ADR-062 §5).
--
-- Read-only. Each query is self-contained and starts with the same `window`
-- CTE. Change `since` there, and nothing else, to move the window. Run one
-- query at a time through the Neon MCP `run_sql` on the branch you mean
-- (production's, for live traffic), or all of them with
-- `psql "$DATABASE_URL" -f .claude/skills/ai-usage/ledger.sql`.
--
-- Simulated turns (ai-live off, `turn_model = 'simulated/no-op'`) are
-- excluded everywhere: they spend nothing and their tool calls are scripted.
--
-- Tables: ai_usage (one row per turn; id is the turn id), ai_usage_steps
-- (turn_id, step_index), ai_usage_tool_calls (turn_id, call_id). Turns written
-- before 0035 have no child rows and are invisible to the per-step and
-- per-tool queries, which is correct: nothing was measured for them.
--
-- No dollars here. A price is `modelRates.ts` joined to these token counts,
-- in TypeScript (`costPerAccount`, `microUsdForSteps`). The `ai-usage` skill
-- explains why it is not done in SQL.

-- 1. Tool failure rate, per tool.
--    failed_rate counts `failed` and `repaired` together: either way the
--    model got the call wrong. `refused-by-grant` is separate, because it
--    is a model reaching for a tool the step did not hold, not a broken call.
WITH window_ AS (SELECT now() - interval '7 days' AS since)
SELECT c.tool,
       count(*) AS calls,
       count(*) FILTER (WHERE c.outcome = 'failed') AS failed,
       count(*) FILTER (WHERE c.outcome = 'repaired') AS repaired,
       count(*) FILTER (WHERE c.outcome = 'refused-by-grant') AS refused_by_grant,
       round(count(*) FILTER (WHERE c.outcome IN ('failed', 'repaired'))::numeric / nullif(count(*), 0), 3) AS failed_rate
FROM ai_usage_tool_calls c
JOIN ai_usage u ON u.id = c.turn_id
CROSS JOIN window_ w
WHERE c.created_at >= w.since AND u.turn_model NOT LIKE 'simulated/%'
GROUP BY c.tool
ORDER BY failed_rate DESC NULLS LAST, calls DESC;

-- 2. Duration per tool, p50 and p75, over calls that ran.
WITH window_ AS (SELECT now() - interval '7 days' AS since)
SELECT c.tool,
       count(*) AS ran,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY c.duration_ms) AS p50_ms,
       percentile_cont(0.75) WITHIN GROUP (ORDER BY c.duration_ms) AS p75_ms,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY c.output_bytes) AS p50_output_bytes
FROM ai_usage_tool_calls c
JOIN ai_usage u ON u.id = c.turn_id
CROSS JOIN window_ w
WHERE c.created_at >= w.since AND c.duration_ms IS NOT NULL AND u.turn_model NOT LIKE 'simulated/%'
GROUP BY c.tool
ORDER BY p75_ms DESC;

-- 3. How often each tool is called per measured turn. A tool near zero is
--    paying its schema's tokens on every step for nothing (ADR-022's rule for
--    earning a tool). Tools offered but never called are not in this table;
--    `uncalledTools` on the `ai.ask` line is where those are listed.
WITH window_ AS (SELECT now() - interval '7 days' AS since),
     turns AS (
       SELECT u.id FROM ai_usage u CROSS JOIN window_ w
       WHERE u.created_at >= w.since AND u.turn_model NOT LIKE 'simulated/%'
         AND EXISTS (SELECT 1 FROM ai_usage_steps s WHERE s.turn_id = u.id)
     )
SELECT c.tool,
       count(*) AS calls,
       round(count(*)::numeric / nullif((SELECT count(*) FROM turns), 0), 3) AS calls_per_turn
FROM ai_usage_tool_calls c
WHERE c.turn_id IN (SELECT id FROM turns)
GROUP BY c.tool
ORDER BY calls_per_turn DESC;

-- 4. Tokens per turn, p50 and p75, with the cached-read share.
--    Agent steps only; the classifier's round-trip is on ai_usage itself.
WITH window_ AS (SELECT now() - interval '7 days' AS since),
     per_turn AS (
       SELECT s.turn_id,
              sum(s.tokens_in) AS tokens_in,
              sum(s.cache_read_tokens) AS cache_read,
              sum(s.tokens_out) AS tokens_out
       FROM ai_usage_steps s
       JOIN ai_usage u ON u.id = s.turn_id
       CROSS JOIN window_ w
       WHERE s.created_at >= w.since AND u.turn_model NOT LIKE 'simulated/%'
       GROUP BY s.turn_id
     )
SELECT count(*) AS turns,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY tokens_in + tokens_out) AS p50_tokens,
       percentile_cont(0.75) WITHIN GROUP (ORDER BY tokens_in + tokens_out) AS p75_tokens,
       round(sum(cache_read)::numeric / nullif(sum(tokens_in), 0), 3) AS cached_share
FROM per_turn;

-- 5. Proposal-reached rate: of turns that could change the trip and called a
--    write tool, how many put something in front of the user to approve.
WITH window_ AS (SELECT now() - interval '7 days' AS since),
     writing AS (
       SELECT u.id,
              bool_or(c.reached_proposal) AS reached
       FROM ai_usage u
       JOIN ai_usage_tool_calls c ON c.turn_id = u.id
       CROSS JOIN window_ w
       WHERE u.created_at >= w.since AND u.turn_model NOT LIKE 'simulated/%'
         AND c.reached_proposal IS NOT NULL
       GROUP BY u.id
     )
SELECT count(*) AS writing_turns,
       count(*) FILTER (WHERE reached) AS reached,
       round(count(*) FILTER (WHERE reached)::numeric / nullif(count(*), 0), 3) AS reached_rate
FROM writing;

-- 6. Escalation: how many turns escalated, and what the escalated steps spent.
WITH window_ AS (SELECT now() - interval '7 days' AS since),
     turns AS (
       SELECT s.turn_id, bool_or(s.escalated) AS escalated
       FROM ai_usage_steps s
       JOIN ai_usage u ON u.id = s.turn_id
       CROSS JOIN window_ w
       WHERE s.created_at >= w.since AND u.turn_model NOT LIKE 'simulated/%'
       GROUP BY s.turn_id
     )
SELECT (SELECT count(*) FROM turns) AS turns,
       (SELECT count(*) FROM turns WHERE escalated) AS escalated_turns,
       round((SELECT count(*) FROM turns WHERE escalated)::numeric / nullif((SELECT count(*) FROM turns), 0), 3) AS escalation_rate,
       (SELECT sum(s.tokens_in + s.tokens_out) FROM ai_usage_steps s
          WHERE s.escalated AND s.turn_id IN (SELECT turn_id FROM turns)) AS tokens_after_escalation;

-- 7. Turn latency and outcome, p50 and p75, from ai_usage itself.
WITH window_ AS (SELECT now() - interval '7 days' AS since)
SELECT u.outcome,
       count(*) AS turns,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY u.latency_ms) AS p50_ms,
       percentile_cont(0.75) WITHIN GROUP (ORDER BY u.latency_ms) AS p75_ms
FROM ai_usage u
CROSS JOIN window_ w
WHERE u.created_at >= w.since AND u.latency_ms IS NOT NULL AND u.turn_model NOT LIKE 'simulated/%'
GROUP BY u.outcome
ORDER BY turns DESC;
