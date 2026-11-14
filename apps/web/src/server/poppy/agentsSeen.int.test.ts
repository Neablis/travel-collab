// The console's Agents tab reads `agentsSeen`; a stranger hosting many documents must not make it unbounded.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { agentSessions } from "@/server/db/schema";
import { AGENTS_SEEN_CAP, agentsSeen } from "./agentsSeen";

describe("agentsSeen", () => {
  it("lists at most the cap, the most recently seen first", async () => {
    // A year on, so the 30-day window leaves out the Sessions other files in this run have written.
    const now = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    const total = AGENTS_SEEN_CAP + 10;
    const ids = Array.from({ length: total }, (_, i) => `https://cap-${i}-${randomUUID()}.test/agent.json`);
    await db.insert(agentSessions).values(
      ids.map((clientId, i) => ({
        id: randomUUID(),
        clientId,
        sid: "sid",
        agentUserId: "usr",
        agentId: null,
        accountId: null,
        createdAt: now,
        // Index 0 is the oldest, so the ten oldest must be the ones dropped.
        lastSeenAt: new Date(now.getTime() - (total - i) * 1000),
      })),
    );
    // Blocks always list, and other files in this run may have made some.
    const seen = (await agentsSeen(now)).filter((agent) => !agent.blocked);
    expect(seen).toHaveLength(AGENTS_SEEN_CAP);
    expect(seen[0]!.clientId).toBe(ids[total - 1]);
    expect(seen.map((agent) => agent.clientId)).not.toContain(ids[0]);
  });
});
