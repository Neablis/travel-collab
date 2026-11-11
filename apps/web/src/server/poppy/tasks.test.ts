import { afterEach, describe, expect, it, vi } from "vitest";
import { EXPOSURE } from "@/server/public-api/exposure";
import { EXCLUDED_TASKS, tasksResponse } from "./tasks";

// What a Personal Agent reads before it starts a task (Poppy 9, 9.1). The list
// is kept beside `exposure.ts` because its `never` rows are where the decision
// "this is not offered" is already written down.

afterEach(() => vi.unstubAllEnvs());

describe("tasksResponse", () => {
  it("lists the tasks the ADR names, each in a phrase of at most 200 characters with a way to do it", () => {
    const { excluded_tasks } = tasksResponse();
    const phrases = excluded_tasks.map((t) => t.task);
    expect(phrases).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/billing/i),
        expect.stringMatching(/delete.*account/i),
        expect.stringMatching(/remove.*member|role/i),
      ]),
    );
    for (const entry of excluded_tasks) {
      expect(entry.task.length).toBeGreaterThan(0);
      expect(entry.task.length).toBeLessThanOrEqual(200);
      // 9.2: an alternative, when there is one, has instructions or references.
      if (entry.alternative !== undefined) expect(entry.alternative.instructions).toMatch(/\S/);
    }
    expect(new Set(phrases).size).toBe(phrases.length);
  });

  // v1 publishes invites, so telling an agent it cannot invite would be false.
  it("does not list inviting people, which v1 offers", () => {
    expect(tasksResponse().excluded_tasks.map((t) => t.task).join(" ")).not.toMatch(/invit/i);
  });

  // The account settings have no delete control, so any alternative would send the agent to nothing.
  it("gives deleting the account no alternative, since no control for it exists", () => {
    const entry = tasksResponse().excluded_tasks.find((t) => /delete.*account/i.test(t.task));
    expect(entry).toBeDefined();
    expect(entry).not.toHaveProperty("alternative");
  });

  it("takes every task's reasons from rows exposure.ts says are never, and does not send them", () => {
    expect(EXCLUDED_TASKS.some((t) => t.rows.length > 0)).toBe(true);
    for (const { task, rows } of EXCLUDED_TASKS) {
      for (const row of rows) expect(EXPOSURE[row]?.status, `${task}: ${row}`).toBe("never");
    }
    for (const entry of tasksResponse().excluded_tasks) expect(entry).not.toHaveProperty("rows");
  });

  it("names the feedback endpoint on the deployment's origin, not the request's", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "caesura.today");
    expect(tasksResponse().feedback).toEqual({ endpoint: "https://caesura.today/api/poppy/feedback" });
  });
});
