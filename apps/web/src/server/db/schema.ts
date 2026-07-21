import {
  bigserial,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { Origin, TripDetail, TripMember, PageContent, PageContext } from "@tc/contracts";

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
    batchId: uuid("batch_id").notNull(),
    origin: jsonb("origin").$type<Origin>().notNull(),
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

export const pages = pgTable(
  "pages",
  {
    id: uuid("id").primaryKey(),
    tripId: uuid("trip_id").notNull(),
    title: text("title").notNull(),
    context: jsonb("context").$type<PageContext>().notNull(),
    content: jsonb("content").$type<PageContent>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
    actorId: text("actor_id").notNull(),
  },
  (t) => [index("pages_trip").on(t.tripId)],
);
