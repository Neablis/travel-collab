CREATE TABLE "trip_presence" (
	"trip_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"seen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "trip_presence_trip_id_user_id_pk" PRIMARY KEY("trip_id","user_id")
);
