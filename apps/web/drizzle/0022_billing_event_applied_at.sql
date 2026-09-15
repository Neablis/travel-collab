-- M21, after review — a webhook claim is provisional until the work finishes.
--
-- `billing_events` made the Stripe event id a primary key so that a redelivery
-- could not double-apply. That half was right and is unchanged. What it lacked
-- was any record that the work the claim covers actually RAN.
--
-- The gap: `claimEvent` writes the row before the handler does anything. If a
-- later step threw — retrieving the subscription, the insert, the held-plan
-- write — the endpoint answered 500, Stripe retried the same event id, the
-- claim reported "already have it", and the event's effect was never applied.
--
-- For `checkout.session.completed` that is terminal rather than merely lossy:
-- the `client_reference_id` that names the account rides on that event and on
-- no later one, so a paying account would sit on `free` with no retry path
-- left and nothing anywhere saying why.
--
-- With `applied_at`, a claim is provisional. A conflicting row that was never
-- stamped is re-claimable (the previous attempt died); only a stamped row is a
-- true replay. The re-claim is a conditional UPDATE, so two retries racing
-- after a failure still produce exactly one winner.
--
-- Nullable and backfilled to `now()` for rows that already exist: this branch
-- has never been dispatched anywhere, so in practice there are none outside a
-- local database and CI — and treating any that do exist as applied is the
-- safe direction, since those deliveries were answered 200.

ALTER TABLE "billing_events" ADD COLUMN "applied_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "billing_events" SET "applied_at" = now() WHERE "applied_at" IS NULL;
