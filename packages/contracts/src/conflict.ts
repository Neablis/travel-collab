import { z } from "zod";

// Shape exists from day one (AGENTS.md invariant 3); rules arrive in M1.
export const Conflict = z.object({
  id: z.string(),
  kind: z.string(),
  severity: z.enum(["info", "warn", "error"]),
  subjects: z.array(z.string()),
  description: z.string(),
  resolutions: z.array(z.string()),
});
export type Conflict = z.infer<typeof Conflict>;
