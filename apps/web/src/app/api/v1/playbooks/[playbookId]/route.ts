import { savedDayDelete } from "@/server/public-api/library";
import { getPlaybookDef, patchPlaybookDef } from "@/server/public-api/playbooks";
import { route } from "@/server/public-api/route";

// One Playbook. A `playbookId` IS a `savedDayId`, and the DTO still calls it
// that (ADR-050). `DELETE` is `/v1/library/{savedDayId}`'s; `GET` also reads
// anybody's published Playbook, and `PATCH` edits content under `version` —
// neither of which the frozen library item does (ADR-050, Pass A).
export const { GET, PATCH, DELETE } = route({
  GET: getPlaybookDef,
  PATCH: patchPlaybookDef,
  DELETE: savedDayDelete({
    param: "playbookId",
    summary: "Delete one of your Playbooks (a published Playbook must be unpublished first)",
    missing: "No such playbook of yours.",
    published: "This playbook is published. Unpublish it before deleting it.",
  }),
});
