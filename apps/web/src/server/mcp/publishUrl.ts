import { deploymentOrigin } from "@/lib/deploymentOrigin";
import { dayPath } from "@/lib/playbookUrls";
import type { Playbook } from "@/server/public-api/playbooks";

// **Publish answers where the Playbook now lives** (M55 D11). The v1 Playbook
// has no URL in it, and a routine that publishes wants to hand one back; the
// path is the one the app links to, from the same function.

/** `publish_playbook`'s answer: the v1 answer, plus the day's public `url`. */
export function withPublicUrl(body: unknown): unknown {
  const written = body as { playbook: Playbook };
  return { ...written, url: `${deploymentOrigin()}${dayPath(written.playbook)}` };
}
