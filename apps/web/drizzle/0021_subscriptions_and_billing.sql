-- M21 links 1 and 4 — what an account pays for, and what we have already been told.
--
-- `subscriptions` is the Billing module's only store. It says what Stripe told
-- us, pinned to the plan version that was bought; it says nothing about what an
-- account may DO. That stays the Entitlements resolver's question, exactly as it
-- was before this milestone — M21 adds no entitlement and no gate.
--
-- ONE WRITER, AND IT IS THE WEBHOOK (M21 link 4). Nothing else in the product
-- inserts or updates a row in `subscriptions`, or writes `users.plan_id` off the
-- back of a payment. A checkout redirect is a hint, never a grant: a client
-- returning from Stripe proves only that a browser followed a URL, and deriving
-- entitlement from a success URL is the classic way a paywall becomes free.
--
-- `billing_events` is the idempotency guarantee, not a log of one. Stripe
-- retries until it gets a 2xx, and the primary key IS the claim: an
-- `INSERT ... ON CONFLICT DO NOTHING` that returns no row means this delivery
-- has already been applied. That check is atomic across concurrent serverless
-- invocations, where a read-then-write is not.
--
-- NOTHING MAY SWEEP `billing_events`. Deleting old rows re-opens replay for
-- exactly the events old enough that nobody is watching, which is the same
-- reasoning `entitlement_grants` carries one migration earlier. Stripe retries
-- for up to three days; the rows are four small columns.
--
-- `users.stripe_customer_id` is null until the first checkout and permanent
-- afterwards: a customer outlives every subscription it ever had, which is what
-- makes "open the portal for this account" answerable after a cancellation.
-- It is written by the checkout route rather than the webhook, and that is not a
-- breach of the rule above — a customer id is who you are at Stripe, not what
-- you are entitled to, and it must exist before a Checkout Session can name it.
--
-- No foreign keys, per the schema's standing convention (ADR-025).

CREATE TABLE "billing_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"event_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"stripe_subscription_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"plan_version" integer NOT NULL,
	"status" text NOT NULL,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"past_due_since" timestamp with time zone,
	"last_event_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_stripe_subscription" ON "subscriptions" USING btree ("stripe_subscription_id");--> statement-breakpoint
CREATE INDEX "subscriptions_user" ON "subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "subscriptions_status" ON "subscriptions" USING btree ("status");