-- M47 part 1 — every Billing row says which Stripe mode it came from
-- (ADR-076 §1–3).
--
-- Production has only ever had a live key, and preview and local databases are
-- disposable, so every row that exists today is live. The two Stripe tables'
-- columns are added with `DEFAULT true` so that ADD COLUMN back-fills them, and
-- the default is then dropped: from here on a writer that forgets to name the
-- mode fails, rather than recording a test-mode row as revenue.
--
-- `users.plan_livemode` keeps its default. It means "the held plan is not from
-- a test checkout", which every account created by sign-in is.
--
-- `stripe_customers` takes over from `users.stripe_customer_id`, one customer
-- per account per mode. The existing ids are copied in as live. The old column
-- is left in place and unread; it is dropped once no deployed build reads it,
-- because production migrations are dispatched apart from deploys (ADR-004).

CREATE TABLE "stripe_customers" (
	"user_id" text NOT NULL,
	"livemode" boolean NOT NULL,
	"customer_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stripe_customers_user_id_livemode_pk" PRIMARY KEY("user_id","livemode")
);
--> statement-breakpoint
ALTER TABLE "billing_events" ADD COLUMN "livemode" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_events" ALTER COLUMN "livemode" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "livemode" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ALTER COLUMN "livemode" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "plan_livemode" boolean DEFAULT true NOT NULL;--> statement-breakpoint
INSERT INTO "stripe_customers" ("user_id", "livemode", "customer_id")
SELECT "id", true, "stripe_customer_id" FROM "users" WHERE "stripe_customer_id" IS NOT NULL;
