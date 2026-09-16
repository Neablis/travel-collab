// **How a domain refusal becomes an HTTP answer**, which is the one translation
// `commands.ts` owns and the one place a caller's retry logic is decided.
//
// A unit test rather than an integration one because the interesting input is a
// refusal the real pipeline will not produce on demand: losing an
// optimistic-concurrency race takes two writers and a collision, and what is
// being checked here is the mapping, not the race. `commands.int.test.ts` has
// the race.
import { describe, expect, it, vi } from "vitest";
import type { Actor } from "./actor";

const executeTripCommand = vi.fn();
const executeTripCommandBatch = vi.fn();
vi.mock("@/server/commands", () => ({
  executeTripCommand: (...args: unknown[]) => executeTripCommand(...args),
  executeTripCommandBatch: (...args: unknown[]) => executeTripCommandBatch(...args),
}));

const { runCommand } = await import("./commands");

const ACTOR = { userId: "u1", via: "session" } as Actor;
const COMMAND = { type: "SetTripName", tripId: "t1", name: "Kyoto" } as Parameters<
  typeof runCommand
>[1];

describe("a refusal becomes the status a caller can act on", () => {
  it("answers 409 when the append lost the race, not 400", async () => {
    executeTripCommand.mockResolvedValueOnce({
      ok: false,
      error: { code: "concurrency-conflict", message: "Someone else changed this trip. Retry." },
    });
    const outcome = await runCommand(ACTOR, COMMAND);
    // 400 tells an integrator to change the request. Nothing about the request
    // was wrong — it was early, and 409 is the one refusal worth retrying
    // verbatim. Every other route in this app has said 409 since M1.
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.status).toBe(409);
    expect(outcome.ok === false && outcome.message).toContain("Retry");
  });

  it("keeps 403 for the policy seam's refusal", async () => {
    executeTripCommand.mockResolvedValueOnce({
      ok: false,
      error: { code: "forbidden", message: "nope" },
    });
    const outcome = await runCommand(ACTOR, COMMAND);
    expect(outcome.ok === false && outcome.status).toBe(403);
    // And never the domain's own wording for it, which names internals.
    expect(outcome.ok === false && outcome.message).toBe("You do not have access to this trip.");
  });

  it("keeps 400 for everything the caller can fix", async () => {
    executeTripCommand.mockResolvedValueOnce({
      ok: false,
      error: { code: "unknown-day", message: "No such day on this trip." },
    });
    const outcome = await runCommand(ACTOR, COMMAND);
    expect(outcome.ok === false && outcome.status).toBe(400);
    expect(outcome.ok === false && outcome.message).toBe("No such day on this trip.");
  });
});
