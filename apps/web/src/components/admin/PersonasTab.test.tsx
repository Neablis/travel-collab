import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PersonaReport } from "@/lib/adminPersonas";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
const fetchTurnTrace = vi.fn();
vi.mock("@/lib/apiClient", () => ({ fetchTurnTrace: (id: string) => fetchTurnTrace(id) }));

import { PersonasTab } from "./PersonasTab";

afterEach(() => {
  cleanup();
  push.mockReset();
  fetchTurnTrace.mockReset();
});

const zero = { turns: 0, costPerTurnMicroUsd: null, costPerOutcomeMicroUsd: null };
const REPORT: PersonaReport = {
  windowDays: 30,
  turns: 3,
  outcomeTurns: 1,
  switches: 1,
  costPerTurnMicroUsd: 1200,
  costPerOutcomeMicroUsd: 3600,
  nodes: [
    { id: "schedule", label: "Schedule", tools: ["read_trip", "move_stop"], entryPages: ["trip", "day"], turns: 2, costPerTurnMicroUsd: 1500, costPerOutcomeMicroUsd: 3000, switchesOut: 1, unusedTools: ["move_stop"] },
    { id: "discover", label: "Discover", tools: ["search_places"], entryPages: [], ...zero, switchesOut: 0, unusedTools: ["search_places"] },
  ],
  edges: [
    { from: "schedule", to: "discover", kind: "switch", via: "switch_persona", guard: ["role=propose"], count: 1, turns: 1, costPerTurnMicroUsd: 2000, costPerOutcomeMicroUsd: 2000 },
    { from: "schedule", to: null, kind: "hand-off", via: "nowhere", guard: [], count: 0, ...zero },
  ],
  recent: [{ turnId: "11111111-1111-4111-8111-111111111111", at: "2052-06-29T12:00:00.000Z", personaPath: ["schedule", "discover"], outcome: "completed", outcomeKinds: ["proposal_applied"], costMicroUsd: 2000 }],
};

describe("the Personas tab", () => {
  it("labels each persona and edge with the window's numbers, and names the hand-off to nowhere", () => {
    render(<PersonasTab report={REPORT} />);
    const schedule = within(screen.getByTestId("persona-schedule"));
    expect(schedule.getByText("trip, day")).toBeTruthy();
    expect(schedule.getByText("$0.0015")).toBeTruthy();
    expect(schedule.getByText("$0.0030")).toBeTruthy();
    expect(schedule.getByText("move_stop")).toBeTruthy();
    const switchEdge = within(screen.getByTestId("edge-schedule-switch_persona"));
    expect(switchEdge.getByText("role=propose")).toBeTruthy();
    expect(switchEdge.getByText("$0.0020", { selector: "td:nth-of-type(6)" })).toBeTruthy();
    expect(within(screen.getByTestId("edge-schedule-nowhere")).getByText(/to nowhere via/)).toBeTruthy();
  });

  it("shows no money for a persona with no turns, not a zero cost or NaN", () => {
    render(<PersonasTab report={REPORT} />);
    const discover = within(screen.getByTestId("persona-discover"));
    expect(discover.getByText("a switch only")).toBeTruthy();
    expect(discover.queryByText(/\$/)).toBeNull();
    expect(screen.queryByText(/NaN/)).toBeNull();
  });

  it("reads n/a, not a free $0.0000, for turns with no priced turn or no outcome", () => {
    render(<PersonasTab report={{ ...REPORT, costPerTurnMicroUsd: null, costPerOutcomeMicroUsd: null, nodes: [{ ...REPORT.nodes[0]!, costPerTurnMicroUsd: null, costPerOutcomeMicroUsd: null }, REPORT.nodes[1]!] }} />);
    expect(within(screen.getByTestId("persona-schedule")).getAllByText("n/a")).toHaveLength(2);
    expect(screen.getByTestId("personas-window").textContent).toContain("Cost per turn n/a, per successful outcome n/a.");
    expect(screen.queryByText(/\$0\.0000/)).toBeNull();
  });

  it("opens a recent turn's breakdown with the same TurnBreakdown the Ask panel uses", async () => {
    fetchTurnTrace.mockResolvedValue({ ok: false, error: { status: 500 } });
    render(<PersonasTab report={REPORT} />);
    const row = within(screen.getByTestId("recent-11111111-1111-4111-8111-111111111111"));
    expect(row.getByText(/Schedule then Discover, \$0\.0020, completed, proposal_applied/)).toBeTruthy();
    await userEvent.click(row.getByRole("button", { name: "Breakdown of answer 1" }));
    expect(fetchTurnTrace).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
  });

  it("navigates to the chosen window and says when there is nothing in it", async () => {
    render(<PersonasTab report={{ ...REPORT, windowDays: 7, turns: 0, recent: [] }} />);
    expect(screen.getByRole("tab", { name: "7 days" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("No assistant turns in the last 7 days")).toBeTruthy();
    await userEvent.click(screen.getByRole("tab", { name: "90 days" }));
    expect(push).toHaveBeenCalledWith("/admin?tab=personas&days=90");
  });
});
