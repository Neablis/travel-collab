### KI-2026-09-07-a — two migration snapshots were never committed, so the next migration anyone generates duplicates `0018` and fails on apply

- **Severity:** correctness (a broken artefact is produced by the standard command, and it fails at apply time against production rather than at generate time). Nothing is broken *today*; the damage is dealt to the next person who runs `db:generate`.
- **Area:** `apps/web/drizzle/meta/` (missing `0016_snapshot.json` and `0018_snapshot.json`), `apps/web/drizzle/meta/_journal.json` (19 entries), `apps/web/src/server/db/schema.ts:299` (`sourceBundle: text("source_bundle")`).
- **What is wrong:** the journal declares **19** migrations, ending `0018_saved_day_source_bundle`, but `meta/` holds only **17** snapshots. `0016` and `0018` are absent. Drizzle generates a new migration by diffing `schema.ts` against the *newest snapshot it can find*, which is `0017` — and `0017` predates `source_bundle`:

  ```
  $ ls apps/web/drizzle/meta/ | tail -3
  0015_snapshot.json
  0017_snapshot.json
  _journal.json

  $ node -e "const j=require('./apps/web/drizzle/meta/_journal.json');
             console.log('entries:', j.entries.length, 'last:', j.entries.at(-1).tag)"
  entries: 19 last: 0018_saved_day_source_bundle

  $ grep -c source_bundle apps/web/drizzle/meta/0017_snapshot.json
  0

  $ grep -n source_bundle apps/web/src/server/db/schema.ts
  299:    sourceBundle: text("source_bundle"),
  ```

- **The consequence, reproduced:** running `drizzle-kit generate` on an otherwise untouched tree emits `drizzle/0019_lowly_punisher.sql` containing exactly

  ```sql
  ALTER TABLE "saved_days" ADD COLUMN "source_bundle" text;
  ```

  — a duplicate of `0018`. On any database that already has `0018` applied (which is every database that is current), that fails with *column already exists*. So **the next migration anyone writes is broken before they have written a line of it**, and they will discover it at apply time, not at generate time. The generating agent in this sweep reverted its reproduction; `git status` was clean afterwards.

- **Why this is not caught by anything:** `drizzle-kit check` passes, because it reads the snapshots it *has* and never reads `_journal.json` — measured this session, including against a journal with a duplicated `idx`, where it still printed `Everything's fine 🐶🔥` and exited 0. The new `scripts/check-migration-journal.mjs` wall (KI-2026-09-05-k, resolved 2026-09-07) checks `when` ordering and journal shape, **not** snapshot presence.

- **Why a snapshot-presence rule was deliberately NOT added to that wall:** it would make `pnpm lint` red on `main` today. The wall landed in the same change; shipping a wall that fails on the tree it lands in is how a wall gets disabled instead of obeyed. Regenerating the two snapshots is its own change with its own verification, which is why it is filed here rather than folded in.

- **Fix path:** restore `0016_snapshot.json` and `0018_snapshot.json` — recover them from the history of the branches that introduced `0016` and `0018` if they exist there, rather than synthesising them, since a hand-built snapshot that disagrees with what was actually applied is worse than none. Then confirm `drizzle-kit generate` on an unchanged tree emits **nothing**, and only then add a snapshot-presence rule (every `_journal.json` entry has a matching `NNNN_snapshot.json`) to `scripts/check-migration-journal.mjs`, where it belongs and where a test already exists to hold it.

- **Open question, inherited — and PARTLY ANSWERED 2026-09-07 by KI-2026-09-06-h.** This entry originally said whether `0016` and `0018` ever reached production was the same unanswered question KI-2026-09-05-k records. It is now narrower and stranger than that. KI-2026-09-06-h established that Preview and Production shared one `DATABASE_URL`, so `vercel-build-migrate.mjs` ran `drizzle-kit migrate` **against the live database on every preview build** — and that **migrations 0015-0018 reached production that way**, never through the dispatch-gated workflow built for it. So `0016` and `0018` are very likely applied to the served database, by the path nobody designed.
  That makes the missing snapshots worse rather than better: the migrations are applied, so the duplicate `0019` this entry predicts would fail with *column already exists* against the database that is actually served. KI-2026-09-06-h's own item 6 records that this account is not fully established ("treat as unresolved"), so confirm with `migration-pending` rather than assuming it.
- **Detector:** `gh workflow run migration-pending.yml` reports `N/19 applied` and names every pending tag, without applying anything. Note it reads `PRODUCTION_DATABASE_URL`, which KI-2026-09-06-h item 2 says **points at the wrong database** — so until that secret is repointed, a green answer from it is about the unread database, not the served one.

- **Cross-reference:** KI-2026-09-05-k (resolved 2026-09-07 — the detector and the journal wall; this entry is the defect that work found and deliberately did not fix); **KI-2026-09-06-h** (preview and production shared one database — why these migrations are probably already applied, and why the detector's secret is pointed at the wrong database); ADR-004 (manual dispatch); `docs/guidelines/environments-and-deploys.md`.
- **First noted:** 2026-09-07, by the `ki-fixer` closing KI-2026-09-05-k, and independently re-verified in the sweep's integration branch before filing.
