"use client";

import { useRouter } from "next/navigation";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel } from "@/components/ui/panel";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { TabStrip } from "@/components/ui/tab-strip";
import { Text } from "@/components/ui/text";
import { TurnBreakdown } from "@/components/assistant/TurnBreakdown";
import type { PersonaEdge, PersonaNode, PersonaReport } from "@/lib/adminPersonas";
import { cn } from "@/lib/cn";
import { PERSONA_WINDOWS, personaWindowHref, type PersonaWindow } from "./consoleTab";
import { microUsdCost } from "./microUsd";

// **The Personas tab** (M57 part 6, ADR-085): the persona graph with the
// window's numbers on it, and the recent turns that walked it. Operators only
// (D7) — the page 404s everyone else before the report is read.
//
// **Drawn as plain SVG, as the Ask panel's Debug strip draws its graph** (part
// 5): six nodes and a handful of edges are a fixed layout, not a layout
// problem, and the picture is not what is read. The tables under it carry every
// number as text, which is what a screen reader and a test read.

const WINDOW_OPTIONS = PERSONA_WINDOWS.map((days) => ({ value: String(days), label: `${days} days` }));

const W = 420;
const H = 240;
const NOWHERE = "nowhere";

function place(index: number, total: number): { x: number; y: number } {
  const angle = (index / total) * 2 * Math.PI - Math.PI / 2;
  return { x: W / 2 + 150 * Math.cos(angle), y: H / 2 + 88 * Math.sin(angle) };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function Graph({ nodes, edges }: { nodes: PersonaNode[]; edges: PersonaEdge[] }) {
  const at = new Map(nodes.map((node, index) => [node.id, place(index, nodes.length)]));
  // The one place a hand-off to nowhere lands: off to the side, so it is not mistaken for a persona.
  const nowhere = { x: W - 34, y: H - 18 };
  const drawn = edges.filter((edge) => edge.from !== edge.to);
  const dangling = new Set(drawn.filter((edge) => edge.to === null).map((edge) => edge.from));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Persona graph" className="w-full max-w-xl text-ink">
      <defs>
        <marker id="personas-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0 0 L8 4 L0 8 z" className="fill-current" />
        </marker>
      </defs>
      {drawn
        .filter((edge) => edge.to !== null)
        .map((edge) => {
          const from = at.get(edge.from)!;
          const to = at.get(edge.to!)!;
          return (
            <g key={`${edge.from}-${edge.via}-${edge.to}`} className="text-brand">
              <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} markerEnd="url(#personas-arrow)" strokeDasharray={edge.kind === "hand-off" ? "4 3" : undefined} className="stroke-current" />
              <text x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 - 3} textAnchor="middle" fontSize={8} className="fill-current">
                {edge.count}
              </text>
            </g>
          );
        })}
      {[...dangling].map((from) => {
        const start = at.get(from)!;
        return <line key={from} x1={start.x} y1={start.y} x2={nowhere.x} y2={nowhere.y} strokeDasharray="2 3" className="stroke-current text-hairline" />;
      })}
      {dangling.size > 0 && (
        <g>
          <circle cx={nowhere.x} cy={nowhere.y} r={14} className="fill-surface stroke-current text-hairline" />
          <text x={nowhere.x} y={nowhere.y + 3} textAnchor="middle" fontSize={8} className="fill-current text-slate">
            nowhere
          </text>
        </g>
      )}
      {nodes.map((node) => {
        const { x, y } = at.get(node.id)!;
        return (
          <g key={node.id} className={cn(node.turns === 0 && "opacity-50")}>
            <rect x={x - 42} y={y - 15} width={84} height={30} rx={6} className={cn("stroke-current", node.entryPages.length > 0 ? "fill-brand-tint text-brand" : "fill-surface text-hairline")} />
            <text x={x} y={y - 3} textAnchor="middle" fontSize={10} className="fill-current">
              {node.label}
            </text>
            <text x={x} y={y + 9} textAnchor="middle" fontSize={8} className="fill-current text-slate">
              {plural(node.turns, "turn")}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

const HEAD = "whitespace-nowrap border-b border-border-strong bg-moss font-mono";
const NUM = "text-right";

function StatCells({ turns, costPerTurnMicroUsd, costPerOutcomeMicroUsd }: { turns: number; costPerTurnMicroUsd: number; costPerOutcomeMicroUsd: number }) {
  return (
    <>
      <TD className={NUM}>{turns}</TD>
      <TD className={NUM}>{turns === 0 ? "—" : microUsdCost(costPerTurnMicroUsd)}</TD>
      <TD className={NUM}>{costPerOutcomeMicroUsd === 0 ? "—" : microUsdCost(costPerOutcomeMicroUsd)}</TD>
    </>
  );
}

function PersonaTable({ nodes }: { nodes: PersonaNode[] }) {
  return (
    <Table aria-label="Personas">
      <THead>
        <TR>
          <TH className={HEAD}>Persona</TH>
          <TH className={HEAD}>Entered by</TH>
          <TH className={cn(HEAD, NUM)}>Turns</TH>
          <TH className={cn(HEAD, NUM)}>Cost / turn</TH>
          <TH className={cn(HEAD, NUM)}>Cost / outcome</TH>
          <TH className={cn(HEAD, NUM)}>Switches out</TH>
          <TH className={HEAD}>Unused tools</TH>
        </TR>
      </THead>
      <TBody>
        {nodes.map((node) => (
          <TR key={node.id} data-testid={`persona-${node.id}`}>
            <TD>{node.label}</TD>
            <TD>{node.entryPages.length === 0 ? "a switch only" : node.entryPages.join(", ")}</TD>
            <StatCells {...node} />
            <TD className={NUM}>{node.switchesOut}</TD>
            <TD>{node.unusedTools.length === 0 ? "none" : node.unusedTools.join(", ")}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

function EdgeTable({ edges, label }: { edges: PersonaEdge[]; label: (id: string) => string }) {
  return (
    <Table aria-label="Edges">
      <THead>
        <TR>
          <TH className={HEAD}>Edge</TH>
          <TH className={HEAD}>Kind</TH>
          <TH className={HEAD}>Guard</TH>
          <TH className={cn(HEAD, NUM)}>Taken</TH>
          <TH className={cn(HEAD, NUM)}>Turns</TH>
          <TH className={cn(HEAD, NUM)}>Cost / turn</TH>
          <TH className={cn(HEAD, NUM)}>Cost / outcome</TH>
        </TR>
      </THead>
      <TBody>
        {edges.map((edge) => (
          <TR key={`${edge.from}-${edge.via}-${edge.to}`} data-testid={`edge-${edge.from}-${edge.via}`}>
            <TD>
              {label(edge.from)} to {edge.to === null ? NOWHERE : label(edge.to)} via <code>{edge.via}</code>
            </TD>
            <TD>{edge.kind}</TD>
            <TD>{edge.guard.length === 0 ? "always" : edge.guard.join(" and ")}</TD>
            <TD className={NUM}>{edge.count}</TD>
            <StatCells {...edge} />
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

export function PersonasTab({ report }: { report: PersonaReport }) {
  const router = useRouter();
  const names = new Map(report.nodes.map((node) => [node.id, node.label]));
  const label = (id: string) => names.get(id) ?? id;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Text variant="secondary" className="text-sm" data-testid="personas-window">
          {`Last ${report.windowDays} days: ${plural(report.turns, "turn")}, ${plural(report.switches, "persona switch")}, ${plural(report.outcomeTurns, "turn")} someone acted on. Cost per turn ${microUsdCost(report.costPerTurnMicroUsd)}, per successful outcome ${report.costPerOutcomeMicroUsd === 0 ? "n/a" : microUsdCost(report.costPerOutcomeMicroUsd)}.`}
        </Text>
        <TabStrip
          value={String(report.windowDays)}
          onValueChange={(next) => router.push(personaWindowHref(Number(next) as PersonaWindow))}
          options={WINDOW_OPTIONS}
          aria-label="Window"
        />
      </div>
      <Panel title="Map">
        <div className="flex flex-col gap-3">
          <Graph nodes={report.nodes} edges={report.edges} />
          <PersonaTable nodes={report.nodes} />
          <EdgeTable edges={report.edges} label={label} />
          <Text variant="secondary" className="text-xs">
            A turn counts at the persona it entered and in full at every edge it took, so edge figures do not add up to a persona&apos;s. A self-loop changes a mode, not a persona, and the ledger does not see it. A hand-off is counted only when it declined a task.
          </Text>
        </div>
      </Panel>
      <Panel title="Recent turns">
        {report.recent.length === 0 ? (
          <EmptyState title={`No assistant turns in the last ${report.windowDays} days`} />
        ) : (
          <ul aria-label="Recent turns" className="flex flex-col divide-y divide-hairline">
            {report.recent.map((turn) => (
              <li key={turn.turnId} className="py-2 text-sm text-ink" data-testid={`recent-${turn.turnId}`}>
                <p>
                  {turn.personaPath.length === 0 ? "unrecorded persona" : turn.personaPath.map(label).join(" then ")}
                  {", "}
                  {microUsdCost(turn.costMicroUsd)}, {turn.outcome}
                  {turn.outcomeKinds.length > 0 && `, ${turn.outcomeKinds.join(", ")}`}
                </p>
                <Text variant="secondary" className="text-xs">
                  {new Date(turn.at).toUTCString()}
                </Text>
                <TurnBreakdown turnId={turn.turnId} />
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
