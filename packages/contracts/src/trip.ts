import { z } from "zod";

export const CreateTrip = z.object({
  type: z.literal("CreateTrip"),
  tripId: z.string().uuid(),
  name: z.string().min(1).max(200),
});
export type CreateTrip = z.infer<typeof CreateTrip>;

export const TripCreatedV1 = z.object({
  type: z.literal("TripCreated"),
  version: z.literal(1),
  payload: z.object({
    tripId: z.string().uuid(),
    name: z.string().min(1).max(200),
    createdBy: z.string().min(1),
  }),
});
export type TripCreatedV1 = z.infer<typeof TripCreatedV1>;

// Grows into a discriminated union as event types are added (M1+).
export const TripEvent = TripCreatedV1;
export type TripEvent = z.infer<typeof TripEvent>;

export const TripMember = z.object({
  userId: z.string().min(1),
  role: z.literal("owner"),
});
export type TripMember = z.infer<typeof TripMember>;

export const TripSummary = z.object({
  tripId: z.string().uuid(),
  name: z.string(),
  members: z.array(TripMember).min(1),
  createdAt: z.string(), // ISO 8601
});
export type TripSummary = z.infer<typeof TripSummary>;
