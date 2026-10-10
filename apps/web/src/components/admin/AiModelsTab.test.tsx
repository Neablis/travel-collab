import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { AdminAiModelsReport } from "@/lib/adminAiModels";
import { AiModelsTab } from "./AiModelsTab";

// The AI models tab's three states (spec § States: `healthy`, `ledger-gap`,
// `no-usage`) and the one colour rule it carries — failed % above 5% in danger
// ink (spec § AI models 4). The aggregates themselves are held against
// Postgres in `aiModels.int.test.ts`; this is what the screen does with them.

afterEach(cleanup);

const DAY = 24 * 60 * 60 * 1000;
const START = Date.parse("2026-09-06T12:00:00.000Z");

/** A month of healthy usage, in the shape `aiModelsReport` returns. */
function healthyReport(overrides: Partial<AdminAiModelsReport> = {}): AdminAiModelsReport {
  return {
    windowDays: 30,
    turns: 300,
    previousTurns: 240,
    accounts: 12,
    medianStepsPerTurn: 2,
    measuredTurns: 300,
    toolCalls: { total: 900, medianPerTurn: 3, p95PerTurn: 11, failed: 18, repaired: 6 },
    contextPerStep: { median: 6200, p95: 24_000 },
    failedTurns: 6,
    worstDay: null,
    days: Array.from({ length: 30 }, (_, i) => ({
      day: new Date(START + i * DAY).toISOString(),
      turns: 10,
      failed: i % 5 === 0 ? 1 : 0,
    })),
    taskClasses: { question: 180, change: 120, compose: 0, offTopic: 0 },
    escalatedTurns: 51,
    contextByStep: [
      { step: "1", median: 3100, p95: 5200, turns: 300 },
      { step: "2", median: 4900, p95: 8900, turns: 200 },
      { step: "8+", median: 16_300, p95: 36_200, turns: 4 },
    ],
    cacheReadShare: 0.71,
    turnsOver32k: 4,
    growthPerStep: 1900,
    models: [
      {
        model: "zai/glm-5.3-flash",
        roles: ["cheap"],
        calls: 500,
        tokensIn: 3_100_000,
        medianDurationMs: 1900,
        costMicroUsd: 41_200_000,
        unpriced: 0,
        turnPriced: 0,
        cacheReadShare: 0.7,
      },
      {
        model: "zai/glm-4.7-flash",
        roles: ["classifier"],
        calls: 290,
        tokensIn: 58_000,
        medianDurationMs: null,
        costMicroUsd: 800_000,
        unpriced: 0,
        turnPriced: 0,
        cacheReadShare: null,
      },
    ],
    tools: [
      {
        tool: "read_trip",
        calls: 400,
        turns: 260,
        failed: 4,
        repaired: 0,
        medianDurationMs: 38,
        medianOutputBytes: 14_200,
        reachedProposal: null,
      },
      {
        tool: "AddActivity",
        calls: 100,
        turns: 60,
        // 6% — over the 5% line.
        failed: 6,
        repaired: 3,
        medianDurationMs: 51,
        medianOutputBytes: 400,
        reachedProposal: { reached: 91, of: 100 },
      },
      {
        tool: "MoveActivity",
        calls: 100,
        turns: 40,
        // Exactly 5% — not above it.
        failed: 5,
        repaired: 1,
        medianDurationMs: 47,
        medianOutputBytes: 300,
        reachedProposal: { reached: 88, of: 100 },
      },
    ],
    rarelyCalled: [
      { tool: "delete_day", calls: 0 },
      { tool: "set_budget", calls: 2 },
    ],
    unpricedTurns: 0,
    ledgerGap: { turns: 0, since: null },
    ...overrides,
  };
}

describe("the AI models tab", () => {
  it("draws the strip, the models and the tool calls when healthy", () => {
    render(<AiModelsTab report={healthyReport()} />);

    expect(screen.getByTestId("ai-turns").textContent).toContain("300");
    // 300 against 240 over the same span before.
    expect(screen.getByTestId("ai-turns").textContent).toContain("+25%");
    expect(screen.getByTestId("ai-turns").textContent).toContain(
      "Last 30 UTC days, today so far, from 12 accounts; the change is against the same span before.",
    );
    expect(screen.getByTestId("ai-tool-calls").textContent).toContain("p95 11");
    expect(screen.getByTestId("ai-context").textContent).toContain("6.2k");
    expect(screen.getByRole("heading", { name: "Models" })).toBeTruthy();
    expect(screen.getByTestId("ai-model-zai/glm-5.3-flash").textContent).toContain("$41.2000");
    expect(screen.getByTestId("ai-model-zai/glm-4.7-flash").textContent).toContain("classifier");
    expect(screen.getAllByRole("row").map((row) => row.getAttribute("data-testid")).filter(Boolean)).toEqual([
      "ai-tool-read_trip",
      "ai-tool-AddActivity",
      "ai-tool-MoveActivity",
    ]);
    // A read tool cannot propose: a dash, not 0%.
    expect(within(screen.getByTestId("ai-tool-read_trip")).getByTestId("ai-tool-proposal").textContent).toBe("—");
    expect(within(screen.getByTestId("ai-tool-AddActivity")).getByTestId("ai-tool-proposal").textContent).toBe("91%");
    expect(screen.getByTestId("ai-rarely-called").textContent).toContain("delete_day (0 calls) and set_budget (2)");
    expect(screen.queryByTestId("ai-ledger-gap")).toBeNull();
    expect(screen.queryByTestId("ai-models-unpriced")).toBeNull();
    // Cost and counts read different windows, and the panel says which.
    expect(screen.getByTestId("ai-models-window").textContent).toBe(
      "Costs are Financial's last 30 × 24 hours, so they add up to its cost column; steps and calls are the 30 UTC days above.",
    );
    // A slope across columns, named as one — not one turn's growth.
    expect(screen.getByTestId("ai-context-note").textContent).toContain(
      "Median input goes from 3.1k at step 1 to 16k at step 8+, about 1.9k a column",
    );
  });

  it("says which costs are a floor, and why, on turn models and the classifier alike", () => {
    const [turnModel, classifier] = healthyReport().models;
    render(
      <AiModelsTab
        report={healthyReport({
          models: [
            { ...turnModel!, unpriced: 3, turnPriced: 2 },
            { ...classifier!, unpriced: 1 },
          ],
          unpricedTurns: 4,
        })}
      />,
    );

    expect(screen.getByTestId("ai-model-zai/glm-5.3-flash").textContent).toContain(
      "3 steps have no published rate or no reported usage, so their turns are priced from the turn's own totals",
    );
    expect(screen.getByTestId("ai-model-zai/glm-5.3-flash").textContent).toContain(
      "Includes 2 turns admitted on it and priced from their own totals",
    );
    expect(screen.getByTestId("ai-model-zai/glm-4.7-flash").textContent).toContain(
      "1 call has no published rate or no reported usage, so its turn is left out of every cost here.",
    );
    expect(screen.getByTestId("ai-models-unpriced").textContent).toBe(
      "4 turns could not be priced at all — no rate, no reported usage, or simulated — as in Financial, so these costs are a floor.",
    );
  });

  // The off-topic share is the one to watch after a prompt change, so it must
  // appear once anything was refused — and not clutter the panel before.
  it("shows the off-topic share only once a turn was refused", () => {
    const { container, rerender } = render(<AiModelsTab report={healthyReport()} />);
    expect(container.textContent).not.toContain("refused as off-topic");
    rerender(<AiModelsTab report={healthyReport({ taskClasses: { question: 150, change: 120, compose: 0, offTopic: 30 } })} />);
    expect(container.textContent).toMatch(/10%\s*refused as off-topic/);
  });

  it("puts a tool's failed share in danger ink only above 5%", () => {
    render(<AiModelsTab report={healthyReport()} />);
    const tone = (tool: string) =>
      within(screen.getByTestId(`ai-tool-${tool}`)).getByTestId("ai-tool-failed").getAttribute("data-tone");

    expect(tone("AddActivity")).toBe("danger");
    expect(tone("MoveActivity")).toBe("normal");
    expect(tone("read_trip")).toBe("normal");
  });

  it("warns above the tab when turns have no step rows", () => {
    render(
      <AiModelsTab report={healthyReport({ ledgerGap: { turns: 142, since: "2026-10-05T09:40:00.000Z" } })} />,
    );

    expect(screen.getByTestId("ai-ledger-gap").textContent).toContain(
      "142 turns since 5 Oct 09:40 UTC have no step or tool-call rows",
    );
    // Cost falls back to the turn row, so the banner does not list it as short.
    expect(screen.getByTestId("ai-ledger-gap").textContent).toContain("turn counts are right, and so is cost");
    // A warning over the body, not instead of it: turn counts are still right.
    expect(screen.getByTestId("ai-turns")).toBeTruthy();
  });

  it("replaces the whole body with an empty box when nobody asked anything", () => {
    render(
      <AiModelsTab
        report={healthyReport({ turns: 0, accounts: 0, measuredTurns: 0, tools: [], models: [], unpricedTurns: 0 })}
      />,
    );

    expect(screen.getByRole("heading", { name: "No assistant turns in the last 30 days" })).toBeTruthy();
    expect(screen.queryByTestId("ai-turns")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Tool calls" })).toBeNull();
    expect(screen.queryByTestId("ai-models-window")).toBeNull();
  });

  it("keeps Models under the empty box when Financial's longer window priced turns", () => {
    // No turn in the 30 UTC days, but one in the up-to-a-day Financial reaches
    // further back: its cost is in Financial's column, so it shows here too.
    const priced = healthyReport().models[0]!;
    render(
      <AiModelsTab
        report={healthyReport({ turns: 0, accounts: 0, measuredTurns: 0, tools: [], models: [{ ...priced, calls: 0 }] })}
      />,
    );

    expect(screen.getByRole("heading", { name: "No assistant turns in the last 30 days" })).toBeTruthy();
    expect(screen.getByTestId(`ai-model-${priced.model}`)).toBeTruthy();
    expect(screen.getByTestId("ai-models-window")).toBeTruthy();
    expect(screen.queryByTestId("ai-turns")).toBeNull();
  });
});
