CREATE TABLE "saved_day_ranks" (
	"saved_day_id" uuid PRIMARY KEY NOT NULL,
	"score" double precision NOT NULL,
	"adds_recent" double precision NOT NULL,
	"comments_recent" double precision NOT NULL,
	"quality" double precision NOT NULL,
	"new_day_lift" double precision NOT NULL,
	"computed_at" timestamp with time zone NOT NULL
);
