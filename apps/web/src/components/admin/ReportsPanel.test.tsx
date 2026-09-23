import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import type { AdminReportAction, ReportStatus } from "@tc/contracts";
import type { AdminReportQueueItem } from "@/lib/reports";
import { makeReportHandlers } from "@/mocks/handlers";
import { ReportsPanel } from "./ReportsPanel";

// The operator's report queue (M12 link 6). Every action goes through the
// shipped client helpers against `makeReportHandlers`, so what these tests
// assert is the `AdminReportAction` that reached the wire — the one thing the
// server trusts — rather than what a button said it would send.

const DAY_ID = "aa000000-0000-4000-8000-000000000001";
const OTHER_DAY_ID = "aa000000-0000-4000-8000-000000000002";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  cleanup();
});
afterAll(() => server.close());

function dayReport(over: {
  reportId: string;
  status?: ReportStatus;
  day?: AdminReportQueueItem["day"];
  reportsOnTarget?: number;
}): AdminReportQueueItem {
  return {
    report: {
      reportId: over.reportId,
      target: { kind: "saved_day", savedDayId: DAY_ID },
      reporterId: "dev-reporter",
      reason: "spam",
      note: "Every stop is an ad for one hotel.",
      status: over.status ?? "open",
      createdAt: "2026-09-20T10:00:00.000Z",
      resolvedAt: null,
      resolvedBy: null,
      resolutionNote: null,
    },
    day:
      over.day === undefined
        ? {
            savedDayId: DAY_ID,
            name: "Kyoto temples at dawn",
            ownerId: "dev-alice",
            ownerDisplayName: "Alice",
            visibility: "public",
            moderatedAt: null,
            moderationNote: null,
          }
        : over.day,
    review: null,
    reportsOnTarget: over.reportsOnTarget ?? 1,
  };
}

function reviewReport(over: { reportId: string; hiddenAt?: string | null; status?: ReportStatus }): AdminReportQueueItem {
  return {
    report: {
      reportId: over.reportId,
      target: { kind: "review", savedDayId: OTHER_DAY_ID, reviewerId: "dev-mallory" },
      reporterId: "dev-reporter",
      reason: "offensive",
      note: null,
      status: over.status ?? "open",
      createdAt: "2026-09-21T10:00:00.000Z",
      resolvedAt: null,
      resolvedBy: null,
      resolutionNote: null,
    },
    day: {
      savedDayId: OTHER_DAY_ID,
      name: "Osaka street food",
      ownerId: "dev-bob",
      ownerDisplayName: "Bob",
      visibility: "public",
      moderatedAt: null,
      moderationNote: null,
    },
    review: { reviewerId: "dev-mallory", stars: 2, note: "Rubbish, all of it.", hiddenAt: over.hiddenAt ?? null },
    reportsOnTarget: 1,
  };
}

const REPORT_A = "bb000000-0000-4000-8000-00000000000a";
const REPORT_B = "bb000000-0000-4000-8000-00000000000b";

/** What the page hands the panel: the same queue, split by status. */
function initialOf(queue: AdminReportQueueItem[]): Record<ReportStatus, AdminReportQueueItem[]> {
  return {
    open: queue.filter((i) => i.report.status === "open"),
    actioned: queue.filter((i) => i.report.status === "actioned"),
    dismissed: queue.filter((i) => i.report.status === "dismissed"),
  };
}

/** Serves `queue`, records every action that reached the wire, and renders. */
function mount(queue: AdminReportQueueItem[]) {
  const sent: AdminReportAction[] = [];
  server.use(...makeReportHandlers({ queue, onAction: (action) => sent.push(action) }));
  render(<ReportsPanel initial={initialOf(queue)} />);
  return sent;
}

const row = (reportId: string) => screen.getByTestId(`report-${reportId}`);
const rowIds = () =>
  screen.queryAllByTestId(/^report-/).map((el) => el.getAttribute("data-testid")!.replace("report-", ""));

describe("ReportsPanel", () => {
  it("shows a day report with what the operator needs to decide", () => {
    mount([dayReport({ reportId: REPORT_A, reportsOnTarget: 3 })]);
    const r = within(row(REPORT_A));

    const link = r.getByRole("link", { name: "Kyoto temples at dawn" });
    expect(link.getAttribute("href")).toBe(`/playbooks/day/${DAY_ID}`);
    expect(r.getByText(/^Day$/)).toBeTruthy();
    expect(r.getByText(/by Alice/)).toBeTruthy();
    expect(r.getByText("Spam")).toBeTruthy();
    expect(r.getByText(/Every stop is an ad for one hotel\./)).toBeTruthy();
    expect(r.getByText("3 reports on this")).toBeTruthy();
    // The Open filter carries its count, as the accounts filters do.
    expect(screen.getByRole("button", { name: /^Open\s*1$/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("shows a review report with the stars, the note and who wrote it", () => {
    mount([reviewReport({ reportId: REPORT_B })]);
    const r = within(row(REPORT_B));

    expect(r.getByText(/^Review$/)).toBeTruthy();
    expect(r.getByLabelText("2 of 5 stars")).toBeTruthy();
    expect(r.getByText(/Rubbish, all of it\./)).toBeTruthy();
    expect(r.getByText(/Mallory/)).toBeTruthy();
    expect(r.getByRole("link", { name: "Osaka street food" })).toBeTruthy();
    expect(r.getByText("Offensive")).toBeTruthy();
    // A review report never offers the day-level hide; that is a different
    // decision about a different author.
    expect(r.queryByRole("button", { name: "Hide from the library" })).toBeNull();
  });

  it("hides a day with the operator's note and moves the row to Actioned", async () => {
    const user = userEvent.setup();
    const sent = mount([dayReport({ reportId: REPORT_A }), reviewReport({ reportId: REPORT_B })]);

    await user.click(within(row(REPORT_A)).getByRole("button", { name: "Hide from the library" }));
    await user.type(within(row(REPORT_A)).getByLabelText(/Note to the author/), "Advertising, not a day.");
    await user.click(within(row(REPORT_A)).getByRole("button", { name: "Hide it" }));

    await waitFor(() => expect(rowIds()).toEqual([REPORT_B]));
    expect(sent).toEqual([{ action: "hide-day", note: "Advertising, not a day." }]);

    await user.click(screen.getByRole("button", { name: /^Actioned/ }));
    expect(rowIds()).toEqual([REPORT_A]);
  });

  it("sends no note at all when the operator leaves it blank", async () => {
    const user = userEvent.setup();
    const sent = mount([dayReport({ reportId: REPORT_A })]);

    await user.click(screen.getByRole("button", { name: "Hide from the library" }));
    await user.click(screen.getByRole("button", { name: "Hide it" }));

    await waitFor(() => expect(sent).toEqual([{ action: "hide-day" }]));
  });

  it("dismisses a report and moves the row to Dismissed", async () => {
    const user = userEvent.setup();
    const sent = mount([dayReport({ reportId: REPORT_A })]);

    await user.click(screen.getByRole("button", { name: "Dismiss" }));

    await waitFor(() => expect(rowIds()).toEqual([]));
    expect(sent).toEqual([{ action: "dismiss" }]);
    await user.click(screen.getByRole("button", { name: /^Dismissed/ }));
    expect(rowIds()).toEqual([REPORT_A]);
  });

  it("hides a review", async () => {
    const user = userEvent.setup();
    const sent = mount([reviewReport({ reportId: REPORT_B })]);

    await user.click(screen.getByRole("button", { name: "Hide review" }));

    await waitFor(() => expect(rowIds()).toEqual([]));
    expect(sent).toEqual([{ action: "hide-review" }]);
  });

  it("offers Restore, not Hide, for a day already hidden", async () => {
    const user = userEvent.setup();
    const hidden = dayReport({
      reportId: REPORT_A,
      status: "actioned",
      day: {
        savedDayId: DAY_ID,
        name: "Kyoto temples at dawn",
        ownerId: "dev-alice",
        ownerDisplayName: "Alice",
        visibility: "public",
        moderatedAt: "2026-09-22T09:00:00.000Z",
        moderationNote: "Advertising, not a day.",
      },
    });
    const sent = mount([hidden]);
    await user.click(screen.getByRole("button", { name: /^Actioned/ }));
    const r = within(row(REPORT_A));

    expect(r.getByText(/Hidden from the library since/)).toBeTruthy();
    expect(r.getByText(/Advertising, not a day\./)).toBeTruthy();
    expect(r.queryByRole("button", { name: "Hide from the library" })).toBeNull();
    // An actioned report is decided; dismissing it would record nothing.
    expect(r.queryByRole("button", { name: "Dismiss" })).toBeNull();

    await user.click(r.getByRole("button", { name: "Restore to the library" }));
    await waitFor(() => expect(sent).toEqual([{ action: "restore-day" }]));
  });

  it("offers Restore review for a hidden review", async () => {
    const user = userEvent.setup();
    const sent = mount([reviewReport({ reportId: REPORT_B, status: "actioned", hiddenAt: "2026-09-22T09:00:00.000Z" })]);
    await user.click(screen.getByRole("button", { name: /^Actioned/ }));
    const r = within(row(REPORT_B));

    expect(r.getByText(/Review hidden since/)).toBeTruthy();
    expect(r.queryByRole("button", { name: "Hide review" })).toBeNull();
    await user.click(r.getByRole("button", { name: "Restore review" }));
    await waitFor(() => expect(sent).toEqual([{ action: "restore-review" }]));
  });

  it("shows a report whose day is gone, and offers only Dismiss", () => {
    mount([dayReport({ reportId: REPORT_A, day: null })]);
    const r = within(row(REPORT_A));

    expect(r.getByText("This day no longer exists.")).toBeTruthy();
    expect(r.queryByRole("link")).toBeNull();
    expect(r.queryByRole("button", { name: "Hide from the library" })).toBeNull();
    expect(r.getByRole("button", { name: "Dismiss" })).toBeTruthy();
  });

  it("says what the queue is for when a tab is empty", async () => {
    const user = userEvent.setup();
    mount([]);

    expect(screen.getByText("Nothing open. Reports people file on shared days and reviews land here.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /^Dismissed/ }));
    expect(screen.getByText("Nothing dismissed yet.")).toBeTruthy();
  });

  it("sends one action however fast the button is pressed", async () => {
    const user = userEvent.setup();
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let posts = 0;
    const queue = [dayReport({ reportId: REPORT_A })];
    mount(queue);
    // After `mount`: `server.use` prepends, so the later handler wins.
    server.use(
      http.post("/api/admin/reports/:reportId", async () => {
        posts += 1;
        await held;
        return HttpResponse.json({ report: { ...queue[0]!.report, status: "dismissed" } });
      }),
    );

    const dismiss = screen.getByRole("button", { name: "Dismiss" });
    await user.click(dismiss);
    await user.click(dismiss);
    expect((dismiss as HTMLButtonElement).disabled).toBe(true);
    release();

    await waitFor(() => expect(posts).toBe(1));
  });

  it("shows a refusal inline and keeps the row", async () => {
    const user = userEvent.setup();
    mount([dayReport({ reportId: REPORT_A })]);
    server.use(http.post("/api/admin/reports/:reportId", () => HttpResponse.json({ error: "not-found" }, { status: 404 })));

    await user.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(await within(row(REPORT_A)).findByText(/no longer exists/)).toBeTruthy();
    expect(rowIds()).toEqual([REPORT_A]);
    expect((screen.getByRole("button", { name: "Dismiss" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
