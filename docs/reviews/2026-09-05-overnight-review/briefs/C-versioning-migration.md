# Stream C — Versioning, history, and migration durability

Question: **Have we built something that breaks on the first major change or
pivot?** Mitchell: *"Is versioning and history built well enough to migrate
existing notebooks and trips easily as we add new features and won't break all
the users' hard-earned trips?"*

Read first:
- ADR-001, 003, 005, 016, 017, 027, 028, 036, 038, 040
- `packages/contracts/src/{events,history,trip,activity,pageDoc,saved,share,manifest}.ts` and `docs/contracts/CHANGELOG.md`
- `packages/domain/src/**` — reducers, replay, command handlers
- `apps/web/src/server/{eventStore,projections,history,commands,cloneTrip,savedDays,savedDayAdds,demoTrip}.ts`, `access/sharedView.ts`
- `apps/web/src/server/db/schema.ts`, `apps/web/drizzle/*.sql` + `meta/_journal.json`, `apps/web/scripts/vercel-build-migrate.mjs`, `.github/workflows/migrate-production.yml`, `docs/guidelines/environments-and-deploys.md`
- The golden rebuild test (grep "rebuild" in `apps/web/src/server/**/*.test.ts` and `packages/domain/test`)
- `packages/contracts/test/fixtures/pageDocV2.ts` and the migration tests

Concretely:
1. **Event schema evolution.** Is there an event `version` field? If a
   reducer's input shape changes (rename a field, split an event, change
   money representation — ADR-008), how do the stored events from July get
   replayed? Is there an upcaster layer, or does Zod reject the old rows?
   Trace: what happens today if `parseEvent` fails on one stored row —
   does the whole trip fail to load, or is the row skipped silently?
2. **Projection rebuild.** Is there a rebuild command/script an operator can
   run against production? Does the golden test cover every event kind
   (compare the kinds in contracts to the fixture's kinds)? What about pages
   (ADR-036 says notebook history is event-sourced per page — is it, in
   code, or is it CRUD with a `content` column)?
3. **PageDoc migrations.** `PAGE_DOC_MIGRATIONS` v1→v2: is migration on read
   only, so a document is re-migrated on every open and never written back?
   What writes it back (autosave 800ms)? Is a v1 doc migrated by a client
   that then saves it as v2 — and if two clients differ in version? Is there
   a test that every stored doc in the fixtures parses at CURRENT version? Is
   `v` required or optional on read? What is the plan for v3 (a node type
   added) — does adding a node require a migration or only a version bump,
   and is that written down?
4. **Drizzle migrations and production.** `migrate-production` is a manual
   dispatch (AGENTS.md DoD). What guards a merged-but-undispatched migration
   — is there a drift check at deploy or health? Does `vercel-build-migrate`
   still run anything? Are migrations reversible / is there any down path?
   Can two agents generate migrations in parallel and collide on the journal
   index? Check the snapshot files in `drizzle/meta/` for consistency with
   `schema.ts` (`drizzle-kit check` if runnable).
5. **Clone, share-pin, kept-day snapshots.** Each copies or pins a trip at a
   moment. When the event schema or the reducer changes, do pinned shares
   (ADR-027 "replay the log") replay with today's reducer (semantics drift)
   or a stored snapshot? Kept days (ADR-040) store a snapshot — in which
   contract version, and who migrates it?
6. **Soft delete, undo, revert, fork lineage** — do compensating events
   (ADR-005) survive a reducer change? Is `seq` global or per trip; any
   assumption of contiguity?
7. **Identity coupling.** Trips reference users by id; what happens to a
   trip, invites, shares, saved days, pages when a user is deleted or an
   email changes? Any cascade in the schema that would delete history?
8. **What would a pivot cost?** Pick two plausible pivots — (a) trips become
   multi-owner organisations; (b) activities gain a second time zone / move
   to a different money model — and list which layers change and what
   migration each needs. Report as a `### Pivot cost` section.

Report **Verified sound** carefully here; Mitchell needs to know what is safe
as much as what is not.
