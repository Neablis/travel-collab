import { Banner } from "@/components/ui/banner";
import { DataText } from "@/components/ui/data-text";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel } from "@/components/ui/panel";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { Text } from "@/components/ui/text";
import type { AdminAiModelRow, AdminAiModelsReport, AdminAiToolRow } from "@/lib/adminAiModels";
import { ContextByStepChart, TurnsADayChart } from "./AiModelsCharts";
import { bytes, compact, count, decimal, duration, percent, shortDay, shortDayTime } from "./aiFormat";
import { microUsdCost } from "./microUsd";

// **The AI models tab** (M36 link 4, spec § AI models) — the ledger M31 built,
// per turn, per step and per tool call, which until now only the `ai-usage`
// skill's SQL could read.
//
// **Counts and sizes only** (D7). The ledger has no column a question or an
// answer could be in, and nothing here asks for one.
//
// **What is not drawn, and why.** The design's *Offered on every step* line
// prices each rarely-called tool's schema in tokens per step; nothing in the
// app measures a tool schema's token cost, so the line names the tools and
// their calls and stops there rather than print an estimate as a measurement.
// The design's one-sentence note per model is computed from the same rows —
// share of steps, share of cost, cache reads — not written.

/** Failed calls above this share of a tool's calls are danger ink (spec § AI models 4). */
export const TOOL_FAILURE_DANGER = 0.05;

const CHART_TURNS_HEIGHT = 120;
const CHART_CONTEXT_HEIGHT = 184;

/** One cell of the four-number strip. */
function Metric({
  label,
  value,
  aside,
  asideTone = "slate",
  note,
  testId,
}: {
  label: string;
  value: string;
  aside?: string;
  asideTone?: "slate" | "success";
  note: string;
  testId: string;
}) {
  return (
    <div className="flex flex-col gap-2 px-5 py-4" data-testid={testId}>
      <Text as="span" className="text-sm font-semibold">
        {label}
      </Text>
      <span className="flex items-baseline gap-2">
        <DataText className="text-2xl font-semibold leading-none text-ink">{value}</DataText>
        {aside ? (
          <DataText size="xs" className={asideTone === "success" ? "text-success-ink" : "text-slate"}>
            {aside}
          </DataText>
        ) : null}
      </span>
      <Text variant="secondary">{note}</Text>
    </div>
  );
}

function Strip({ report }: { report: AdminAiModelsReport }) {
  const delta =
    report.previousTurns === 0 ? undefined : (report.turns - report.previousTurns) / report.previousTurns;
  const { toolCalls, contextPerStep, worstDay } = report;
  return (
    <div className="grid grid-cols-1 divide-hairline overflow-hidden rounded-lg border border-hairline bg-surface sm:grid-cols-2 lg:grid-cols-4 lg:divide-x">
      <Metric
        label="Turns"
        value={count(report.turns)}
        aside={delta === undefined ? undefined : `${delta >= 0 ? "+" : "−"}${percent(Math.abs(delta))}`}
        asideTone={delta !== undefined && delta > 0 ? "success" : "slate"}
        note={`Last ${report.windowDays} UTC days, today so far, from ${count(report.accounts)} account${report.accounts === 1 ? "" : "s"}; the change is against the same span before.${
          report.medianStepsPerTurn === null ? "" : ` ${decimal(report.medianStepsPerTurn)} steps a turn, median.`
        }`}
        testId="ai-turns"
      />
      <Metric
        label="Tool calls a turn"
        value={toolCalls.medianPerTurn === null ? "—" : decimal(toolCalls.medianPerTurn)}
        aside={toolCalls.p95PerTurn === null ? undefined : `p95 ${decimal(toolCalls.p95PerTurn)}`}
        note={`${count(toolCalls.total)} calls.${
          toolCalls.total === 0
            ? ""
            : ` ${percent(toolCalls.failed / toolCalls.total)} failed, ${percent(toolCalls.repaired / toolCalls.total)} repaired by a retry.`
        }`}
        testId="ai-tool-calls"
      />
      <Metric
        label="Context per step"
        value={contextPerStep === null ? "—" : compact(contextPerStep.median)}
        aside={contextPerStep === null ? undefined : `p95 ${compact(contextPerStep.p95)}`}
        note="Input tokens sent on each step — the number that drives cost."
        testId="ai-context"
      />
      <Metric
        label="Failed turns"
        value={report.turns === 0 ? "—" : percent(report.failedTurns / report.turns)}
        aside={count(report.failedTurns)}
        note={
          worstDay === null
            ? "No day stands out."
            : `${shortDay(worstDay.day)} was ${percent(worstDay.failed / worstDay.turns)}${
                worstDay.tool === null ? "." : ` — most failed calls were ${worstDay.tool}.`
              }`
        }
        testId="ai-failed"
      />
    </div>
  );
}

function TurnsPanel({ report }: { report: AdminAiModelsReport }) {
  const { taskClasses, turns } = report;
  const split = [
    { v: percent(turns === 0 ? 0 : taskClasses.question / turns), k: "questions" },
    { v: percent(turns === 0 ? 0 : taskClasses.change / turns), k: "changes" },
    // Page turns are their own class (`compose`); folded into either of the
    // other two they would misstate both, so they appear only when they exist.
    ...(taskClasses.compose > 0 ? [{ v: percent(taskClasses.compose / turns), k: "page writing" }] : []),
    {
      v: percent(report.measuredTurns === 0 ? 0 : report.escalatedTurns / report.measuredTurns),
      k: "escalated to a stronger model",
    },
    { v: count(report.failedTurns), k: "failed (red)" },
  ];
  return (
    <Panel title="Turns a day">
      <div className="flex flex-col gap-2">
        <TurnsADayChart days={report.days} height={CHART_TURNS_HEIGHT} />
        <span className="flex justify-between">
          <DataText size="xs">{report.days[0] ? shortDay(report.days[0].day) : ""}</DataText>
          <DataText size="xs">today</DataText>
        </span>
        <span className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-slate" data-testid="ai-turns-split">
          {split.map((part) => (
            <span key={part.k}>
              <DataText className="text-ink">{part.v}</DataText> {part.k}
            </span>
          ))}
        </span>
        <Table className="sr-only">
          <caption>Turns a day</caption>
          <thead>
            <tr>
              <th>Day</th>
              <th>Turns</th>
              <th>Failed</th>
            </tr>
          </thead>
          <tbody>
            {report.days.map((day) => (
              <tr key={day.day}>
                <td>{shortDay(day.day)}</td>
                <td>{day.turns}</td>
                <td>{day.failed}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    </Panel>
  );
}

function ContextPanel({ report }: { report: AdminAiModelsReport }) {
  const first = report.contextByStep[0];
  const last = report.contextByStep.at(-1);
  const sentences = [
    // Named as columns, not as one turn's growth: each column is the turns
    // that got that far, so this is a slope across a thinning population.
    report.growthPerStep === null || first === undefined || last === undefined
      ? null
      : `Median input goes from ${compact(first.median)} at step ${first.step} to ${compact(last.median)} at step ${last.step}, about ${compact(report.growthPerStep)} a column — each step re-sends the conversation.`,
    report.cacheReadShare === null ? null : `${percent(report.cacheReadShare)} of input tokens were cache reads.`,
    `${count(report.turnsOver32k)} turn${report.turnsOver32k === 1 ? "" : "s"} crossed 32k.`,
  ].filter((s): s is string => s !== null);
  return (
    <Panel title="Context size by step">
      <div className="flex flex-col gap-2.5">
        {report.contextByStep.length === 0 ? (
          <Text variant="secondary">No step reported its input tokens.</Text>
        ) : (
          <ContextByStepChart steps={report.contextByStep} height={CHART_CONTEXT_HEIGHT} />
        )}
        <span className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-slate">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-sm bg-ink" />
            median input tokens
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-sm border border-border-strong bg-moss" />
            95th percentile
          </span>
        </span>
        <Text variant="secondary" data-testid="ai-context-note">
          {sentences.join(" ")}
        </Text>
        <Table className="sr-only">
          <caption>Input tokens by step</caption>
          <thead>
            <tr>
              <th>Step</th>
              <th>Median</th>
              <th>95th percentile</th>
              <th>Turns that got this far</th>
            </tr>
          </thead>
          <tbody>
            {report.contextByStep.map((step) => (
              <tr key={step.step}>
                <td>{step.step}</td>
                <td>{count(step.median)}</td>
                <td>{count(step.p95)}</td>
                <td>{step.turns}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    </Panel>
  );
}

/** The sentence under a model: computed from its rows, never written by hand. */
function modelNote(model: AdminAiModelRow, report: AdminAiModelsReport): string {
  const n = model.unpriced;
  if (model.roles.includes("classifier")) {
    const parts = [
      `One call per classified turn — ${percent(report.turns === 0 ? 0 : model.calls / report.turns)} of turns — before the turn model runs.`,
    ];
    if (n > 0) {
      parts.push(
        `${count(n)} call${n === 1 ? " has" : "s have"} no published rate or no reported usage, so ${n === 1 ? "its turn is" : "their turns are"} left out of every cost here.`,
      );
    }
    return parts.join(" ");
  }
  const turnModels = report.models.filter((m) => !m.roles.includes("classifier"));
  const steps = turnModels.reduce((sum, m) => sum + m.calls, 0);
  const cost = turnModels.reduce((sum, m) => sum + m.costMicroUsd, 0);
  const parts = [
    `${percent(steps === 0 ? 0 : model.calls / steps)} of steps and ${percent(cost === 0 ? 0 : model.costMicroUsd / cost)} of the priced cost.`,
  ];
  if (model.cacheReadShare !== null) parts.push(`${percent(model.cacheReadShare)} of its input was cache reads.`);
  if (n > 0) {
    parts.push(
      `${count(n)} step${n === 1 ? " has" : "s have"} no published rate or no reported usage, so ${n === 1 ? "its turn is" : "their turns are"} priced from the turn's own totals where that can be.`,
    );
  }
  if (model.turnPriced > 0) {
    parts.push(
      `Includes ${count(model.turnPriced)} turn${model.turnPriced === 1 ? "" : "s"} admitted on it and priced from ${model.turnPriced === 1 ? "its" : "their"} own totals — a step without usage, or no step rows.`,
    );
  }
  return parts.join(" ");
}

function ModelsPanel({ report }: { report: AdminAiModelsReport }) {
  return (
    <Panel title="Models">
      <div className="flex flex-col">
        {report.models.map((model) => {
          const classifier = model.roles.includes("classifier");
          const stats = [
            { k: classifier ? "calls" : "steps", v: compact(model.calls) },
            { k: "input tokens", v: compact(model.tokensIn) },
            { k: classifier ? "median" : "median step", v: model.medianDurationMs === null ? "—" : duration(model.medianDurationMs) },
            { k: `cost ${report.windowDays}d`, v: microUsdCost(model.costMicroUsd) },
          ];
          return (
            <div
              key={`${classifier ? "classifier" : "turn"}:${model.model}`}
              className="flex flex-col gap-2 border-b border-hairline py-3 last:border-b-0"
              data-testid={`ai-model-${model.model}`}
            >
              <span className="flex items-baseline justify-between gap-2.5">
                <DataText className="font-semibold text-ink">{model.model}</DataText>
                <DataText size="xs" className="uppercase tracking-wider">
                  {model.roles.length === 0 ? "—" : model.roles.join(" · ")}
                </DataText>
              </span>
              <div className="grid grid-cols-4 gap-2">
                {stats.map((stat) => (
                  <span key={stat.k} className="flex flex-col gap-0.5">
                    <DataText className="font-semibold text-ink">{stat.v}</DataText>
                    <Text as="span" variant="muted">
                      {stat.k}
                    </Text>
                  </span>
                ))}
              </div>
              <Text as="span" variant="muted">
                {modelNote(model, report)}
              </Text>
            </div>
          );
        })}
        <Text variant="secondary" className="pt-2" data-testid="ai-models-window">
          {`Costs are Financial's last ${report.windowDays} × 24 hours, so they add up to its cost column; steps and calls are the ${report.windowDays} UTC days above.`}
        </Text>
        {report.unpricedTurns > 0 ? (
          <Text variant="secondary" className="pt-2" data-testid="ai-models-unpriced">
            {`${count(report.unpricedTurns)} turn${report.unpricedTurns === 1 ? "" : "s"} could not be priced at all — no rate, no reported usage, or simulated — as in Financial, so these costs are a floor.`}
          </Text>
        ) : null}
      </div>
    </Panel>
  );
}

// The spec's table head — mono, slate on moss, a strong rule under it — as
// classes on `TH`, which the primitive merges; the primitive itself is not
// restyled for one table.
const HEAD = "whitespace-nowrap border-b border-border-strong bg-moss font-mono";
const NUM = "text-right";

function ToolRow({ tool, measuredTurns }: { tool: AdminAiToolRow; measuredTurns: number }) {
  const rate = tool.calls === 0 ? 0 : tool.failed / tool.calls;
  const danger = rate > TOOL_FAILURE_DANGER;
  return (
    <TR data-testid={`ai-tool-${tool.tool}`}>
      <TD>
        <DataText className="whitespace-nowrap text-ink">{tool.tool}</DataText>
      </TD>
      <TD className={NUM}>
        <DataText className="text-ink">{count(tool.calls)}</DataText>
      </TD>
      <TD className={NUM}>
        <DataText className="text-ink">{percent(measuredTurns === 0 ? 0 : tool.turns / measuredTurns)}</DataText>
      </TD>
      <TD className={NUM}>
        <DataText
          className={danger ? "whitespace-nowrap text-danger-ink" : "whitespace-nowrap text-ink"}
          data-tone={danger ? "danger" : "normal"}
          data-testid="ai-tool-failed"
        >
          {count(tool.failed)} · {percent(rate)}
        </DataText>
      </TD>
      <TD className={NUM}>
        <DataText>{tool.repaired === 0 ? "—" : count(tool.repaired)}</DataText>
      </TD>
      <TD className={NUM}>
        <DataText className="text-ink">{tool.medianDurationMs === null ? "—" : duration(tool.medianDurationMs)}</DataText>
      </TD>
      <TD className={NUM}>
        <DataText className="text-ink">{tool.medianOutputBytes === null ? "—" : bytes(tool.medianOutputBytes)}</DataText>
      </TD>
      <TD className={NUM}>
        {/* `—` for a tool that cannot propose: its every row is null, which is
            a different fact from a write that never reached one (0%). */}
        <DataText data-testid="ai-tool-proposal">
          {tool.reachedProposal === null ? "—" : percent(tool.reachedProposal.reached / tool.reachedProposal.of)}
        </DataText>
      </TD>
    </TR>
  );
}

function ToolsPanel({ report }: { report: AdminAiModelsReport }) {
  const rare = report.rarelyCalled;
  return (
    <Panel title="Tool calls">
      <div className="flex flex-col gap-3">
        <div className="overflow-x-auto">
          <Table>
            <THead>
              <TR>
                <TH className={HEAD}>Tool</TH>
                <TH className={`${HEAD} ${NUM}`}>Calls</TH>
                <TH className={`${HEAD} ${NUM}`}>In turns</TH>
                <TH className={`${HEAD} ${NUM}`}>Failed</TH>
                <TH className={`${HEAD} ${NUM}`}>Repaired</TH>
                <TH className={`${HEAD} ${NUM}`}>Median time</TH>
                <TH className={`${HEAD} ${NUM}`}>Median result</TH>
                <TH className={`${HEAD} ${NUM}`}>Reached a proposal</TH>
              </TR>
            </THead>
            <TBody>
              {report.tools.map((tool) => (
                <ToolRow key={tool.tool} tool={tool} measuredTurns={report.measuredTurns} />
              ))}
            </TBody>
          </Table>
        </div>
        <div className="flex flex-col gap-1 border-t border-hairline pt-2.5" data-testid="ai-rarely-called">
          <Text as="span" className="text-xs font-semibold uppercase tracking-wider text-slate">
            Offered on every step, almost never called
          </Text>
          <Text className="text-sm">
            {rare.length === 0 ? (
              "Every registered tool was called in at least 1% of turns."
            ) : (
              <>
                {rare.map((row, i) => (
                  <span key={row.tool}>
                    {i === 0 ? "" : i === rare.length - 1 ? " and " : ", "}
                    <DataText className="text-ink">{row.tool}</DataText> ({count(row.calls)}
                    {i === 0 ? ` call${row.calls === 1 ? "" : "s"}` : ""})
                  </span>
                ))}
                {` — registered, and called in under 1% of ${count(report.measuredTurns)} measured turns.`}
              </>
            )}
          </Text>
        </div>
      </div>
    </Panel>
  );
}

/**
 * The AI models tab's body: the `ledger-gap` banner when step rows are
 * missing, then the strip, turns a day, context and models, and tool calls —
 * or, with no turns in the window, the `no-usage` empty box instead of all of
 * it. Models still shows under the box when Financial's window, which starts
 * up to a day earlier, priced something: its column has that cost, so hiding
 * it here would leave the two disagreeing with nothing to say why.
 */
export function AiModelsTab({ report }: { report: AdminAiModelsReport }) {
  if (report.turns === 0) {
    const empty = (
      <EmptyState
        title={`No assistant turns in the last ${report.windowDays} days`}
        body="Either nobody holding ai.ask has asked anything, or turns aren't being recorded. If accounts in Users show questions asked, it's the second."
      />
    );
    if (report.models.length === 0 && report.unpricedTurns === 0) return empty;
    return (
      <div className="flex flex-col gap-5">
        {empty}
        <ModelsPanel report={report} />
      </div>
    );
  }
  const gap = report.ledgerGap;
  return (
    <div className="flex flex-col gap-5">
      {gap.turns > 0 ? (
        <Banner variant="warning" data-testid="ai-ledger-gap">
          <strong>
            {count(gap.turns)} turn{gap.turns === 1 ? "" : "s"}
            {gap.since === null ? "" : ` since ${shortDayTime(gap.since)}`} {gap.turns === 1 ? "has" : "have"} no step or
            tool-call rows.
          </strong>{" "}
          The turn rows wrote, so turn counts are right, and so is cost: those turns are priced from their own totals,
          as Financial prices them, on the model each started on. Tool calls and context size undercount until the
          step write recovers — nothing needs re-sending.
        </Banner>
      ) : null}
      <Strip report={report} />
      <TurnsPanel report={report} />
      <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2">
        <ContextPanel report={report} />
        <ModelsPanel report={report} />
      </div>
      <ToolsPanel report={report} />
    </div>
  );
}
