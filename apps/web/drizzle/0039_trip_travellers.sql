-- Who on a trip is travelling, and a revision for the events poll to notice
-- Access changes (travellers spec D1, D3, D11).
--
-- trip_travellers: a missing row means travelling (D2), so existing members
-- need no backfill and no live total moves on deploy. A table rather than a
-- trip_memberships column because the owner has no membership row (D5).
-- trip_invites.travelling: the choice made on the invite, which the accept
-- writes into trip_travellers; defaults true so old invites read as before.
-- trip_access_revs: one counter per trip bumped by every Access write; a
-- counter because revoke and remove DELETE rows, which a max(updated_at)
-- over the surviving rows cannot see.

CREATE TABLE "trip_access_revs" (
	"trip_id" uuid PRIMARY KEY NOT NULL,
	"rev" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_travellers" (
	"trip_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"travelling" boolean NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "trip_travellers_trip_id_user_id_pk" PRIMARY KEY("trip_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "trip_invites" ADD COLUMN "travelling" boolean DEFAULT true NOT NULL;