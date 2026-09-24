import { exportPlaybookDef } from "@/server/public-api/playbooks";
import { route } from "@/server/public-api/route";

// **A Playbook, as a file you can take with you** (ADR-050, Pass C) — the
// Playbook twin of `/v1/trips/{tripId}/export`, answered RAW (not enveloped) so
// the response body is the file `POST /v1/playbooks/import` takes back.
// Readable on `GET /v1/playbooks/{playbookId}`'s terms.
export const { GET } = route({ GET: exportPlaybookDef });
