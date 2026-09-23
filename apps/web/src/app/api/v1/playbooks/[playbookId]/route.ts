import { savedDayItem } from "@/server/public-api/library";
import { route } from "@/server/public-api/route";

// One Playbook: read it, publish or unpublish it, delete it. The same handlers
// as `/v1/library/{savedDayId}` (ADR-050) — a `playbookId` IS a `savedDayId`,
// and the DTO still calls it that.
export const { GET, PATCH, DELETE } = route(
  savedDayItem({
    param: "playbookId",
    summaries: {
      get: "Get one of your Playbooks, every day and stop in order",
      patch: "Publish a Playbook to Discover, or make it private again",
      delete: "Delete one of your Playbooks (a published Playbook must be unpublished first)",
    },
    missing: "No such playbook of yours.",
    published: "This playbook is published. Unpublish it before deleting it.",
  }),
);
