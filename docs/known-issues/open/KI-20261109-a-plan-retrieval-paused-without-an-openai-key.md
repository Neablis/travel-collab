### KI-2026-11-09-a — plan retrieval is paused in production until there is an OpenAI key

- **Severity:** correctness.
- **Area:** Coolify `caesura-web` env (`RAG_PLAN_RETRIEVAL`, `OPENAI_API_KEY`), `/api/cron/embed-days`, `day_embeddings`.
- **Symptom / What happens:** production runs with `RAG_PLAN_RETRIEVAL=0`, so the assistant plans without retrieving similar days. `embed-days` still runs nightly and embeds nothing: its 2026-11-09 04:00Z run answered `200` with `"embedded":0,"pending":17`.
- **Why not fixed here:** the AI Gateway went with the blocked Vercel account (M59 part 4), Anthropic has no embedding model, and there is no `OPENAI_API_KEY` yet. Mitchell deferred it out of the M59 gate on 2026-11-09.
- **Fix path:** Mitchell adds `OPENAI_API_KEY` in Coolify (never in chat); set `RAG_PLAN_RETRIEVAL=1`; redeploy; run the embed-days scheduled task once by hand (Coolify → Scheduled Tasks → *Execute now*) and read `pending` fall to 0 in its execution log. Same model as before (`text-embedding-3-small`), so no re-index. `docs/ops/coolify-vps.md`, *Environment variables*.
- **Tripwire:** embed-days' execution log still reports `pending` above 0 a week after the key is set.
- **Cross-reference:** M59 (`docs/milestones/M59-self-host-on-coolify-vps.md`), PR 706.
- **First noted:** 2026-11-08, M59 plan follow-up; deferred 2026-11-09.
