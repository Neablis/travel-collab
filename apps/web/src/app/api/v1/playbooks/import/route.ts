import { importPlaybookDef } from "@/server/public-api/playbooks";
import { route } from "@/server/public-api/route";

// **A file becomes a Playbook of yours** (ADR-050, Pass C) — the Playbook twin
// of `/v1/trips/import`. A static segment beside `[playbookId]`: no Playbook id
// is ever the literal string `import`. What the file may and may not decide is
// on `importPlaybook`.
export const { POST } = route({ POST: importPlaybookDef });
