import { savedDayItem } from "@/server/public-api/library";
import { route } from "@/server/public-api/route";

// One saved day: read it, publish or unpublish it, delete it. The handlers are
// shared with `/v1/playbooks/{playbookId}` (ADR-050); only the words are ours.
export const { GET, PATCH, DELETE } = route(
  savedDayItem({
    param: "savedDayId",
    summaries: {
      get: "Get one of your saved days",
      patch: "Publish a saved day to Discover, or make it private again",
      delete: "Delete one of your saved days (a published day must be unpublished first)",
    },
    missing: "No such saved day of yours.",
    published: "This day is published. Unpublish it before deleting it.",
  }),
);
