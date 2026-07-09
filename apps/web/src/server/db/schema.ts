import {
  bigserial,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { TripDetail, TripMember } from "@tc/contracts";

export const events = pgTable(
  "events",
  {
    globalSeq: bigserial("global_seq", { mode: "number" }).primaryKey(),
    streamId: uuid("stream_id").notNull(),
    seq: integer("seq").notNull(),
    type: text("type").notNull(),
    version: integer("version").notNull(),
    payload: jsonb("payload").notNull(),
    actorId: text("actor_id").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (t) => [uniqueIndex("events_stream_seq").on(t.streamId, t.seq)],
);

export const tripSummaries = pgTable("trip_summaries", {
  tripId: uuid("trip_id").primaryKey(),
  name: text("name").notNull(),
  members: jsonb("members").$type<TripMember[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
});

export const tripDetails = pgTable("trip_details", {
  tripId: uuid("trip_id").primaryKey(),
  doc: jsonb("doc").$type<TripDetail>().notNull(),
});
