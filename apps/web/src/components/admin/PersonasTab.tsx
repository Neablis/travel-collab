"use client";

import { useRouter } from "next/navigation";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel } from "@/components/ui/panel";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { TabStrip } from "@/components/ui/tab-strip";
import { Text } from "@/components/ui/text";
import { TurnBreakdown } from "@/components/assistant/TurnBreakdown";
import type { PersonaEdge, PersonaNode, PersonaReport, TurnStats } from "@/lib/adminPersonas";
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

const W = 960;
const H = 340;
const COLS = 3;
const NODE_W = 132;
const NODE_H = 44;
const STUB = 30;
const NOWHERE = "nowhere";

type Point = { x: number; y: number };

/** Nodes in a grid that spans the panel: the rows are what keep the edges short and the labels clear. */
export function place(index: number, total: number): Point {
  const rows = Math.ceil(total / COLS);
  const col = index % COLS;
  const row = Math.floor(index / COLS);
  return { x: ((col + 0.5) / COLS) * W, y: rows === 1 ? H / 2 : 100 + row * 140 };
}

/** Where the ray from a node's centre toward `toward` leaves the node's rectangle, so an edge starts and ends on the border. */
export function clipToNode(centre: Point, toward: Point): Point {
  const dx = toward.x - centre.x;
  const dy = toward.y - centre.y;
  if (dx === 0 && dy === 0) return centre;
  const t = Math.min(dx === 0 ? Infinity : NODE_W / 2 / Math.abs(dx), dy === 0 ? Infinity : NODE_H / 2 / Math.abs(dy));
  return { x: centre.x + dx * t, y: centre.y + dy * t };
}

const quadAt = (a: Point, c: Point, b: Point, t: number): Point => ({
  x: (1 - t) ** 2 * a.x + 2 * (1 - t) * t * c.x + t * t * b.x,
  y: (1 - t) ** 2 * a.y + 2 * (1 - t) * t * c.y + t * t * b.y,
});

const insideNode = (p: Point, centre: Point, margin: number) => Math.abs(p.x - centre.x) < NODE_W / 2 + margin && Math.abs(p.y - centre.y) < NODE_H / 2 + margin;

export type EdgeRoute = { start: Point; end: Point; control: Point; label: Point; d: string };

/**
 * One edge as a quadratic curve from border to border. `bend` pushes the
 * control point sideways, so the two directions of a pair (same bend, opposite
 * heading) land on opposite sides; the first bend that keeps the curve out of
 * every `others` node wins.
 */
export function routeEdge(from: Point, to: Point, others: Point[], paired: boolean): EdgeRoute {
  const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  const perp = { x: -(to.y - from.y) / len, y: (to.x - from.x) / len };
  const bends = paired ? [36, -36, 72, -72, 110, -110] : [0, 40, -40, 80, -80, 120, -120];
  let route!: EdgeRoute;
  for (const bend of bends) {
    const control = { x: (from.x + to.x) / 2 + perp.x * bend, y: (from.y + to.y) / 2 + perp.y * bend };
    const start = clipToNode(from, control);
    const end = clipToNode(to, control);
    route = { start, end, control, label: quadAt(start, control, end, 0.5), d: `M${start.x} ${start.y} Q${control.x} ${control.y} ${end.x} ${end.y}` };
    const clear = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].every((t) => {
      const p = quadAt(start, control, end, t);
      return !others.some((o) => insideNode(p, o, 6));
    });
    if (clear) break;
  }
  return route;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function Pill({ at, text, width }: { at: Point; text: string; width: number }) {
  return (
    <>
      <rect x={at.x - width / 2} y={at.y - 10} width={width} height={20} rx={10} className="fill-surface stroke-current text-hairline" />
      <text x={at.x} y={at.y + 4} textAnchor="middle" fontSize={12} className="fill-current">
        {text}
      </text>
    </>
  );
}

function Graph({ nodes, edges }: { nodes: PersonaNode[]; edges: PersonaEdge[] }) {
  const at = new Map(nodes.map((node, index) => [node.id, place(index, nodes.length)]));
  const drawn = edges.filter((edge) => edge.from !== edge.to);
  const linked = drawn.filter((edge) => edge.to !== null);
  const dangling = new Set(drawn.filter((edge) => edge.to === null).map((edge) => edge.from));
  const has = (from: string, to: string) => linked.some((edge) => edge.from === from && edge.to === to);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Persona graph" className="w-full text-ink">
      <defs>
        <marker id="personas-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0 0 L8 4 L0 8 z" className="fill-current" />
        </marker>
      </defs>
      {linked.map((edge) => {
        const others = nodes.filter((node) => node.id !== edge.from && node.id !== edge.to).map((node) => at.get(node.id)!);
        const route = routeEdge(at.get(edge.from)!, at.get(edge.to!)!, others, has(edge.to!, edge.from));
        return (
          <g key={`${edge.from}-${edge.via}-${edge.to}`} className="text-brand">
            <path d={route.d} fill="none" markerEnd="url(#personas-arrow)" strokeDasharray={edge.kind === "hand-off" ? "4 3" : undefined} className="stroke-current" />
            <Pill at={route.label} text={String(edge.count)} width={String(edge.count).length * 8 + 14} />
          </g>
        );
      })}
      {/* A hand-off to nowhere is a short stub off the node's outer side, so it crosses nothing. */}
      {[...dangling].map((from) => {
        const c = at.get(from)!;
        const dir = c.y < H / 2 || nodes.length <= COLS ? -1 : 1;
        const start = { x: c.x, y: c.y + dir * (NODE_H / 2) };
        const end = { x: c.x, y: start.y + dir * STUB };
        return (
          <g key={from} className="text-hairline">
            <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} strokeDasharray="2 3" markerEnd="url(#personas-arrow)" className="stroke-current" />
            <g className="text-slate">
              <Pill at={{ x: end.x, y: end.y + dir * 12 }} text="nowhere" width={64} />
            </g>
          </g>
        );
      })}
      {nodes.map((node) => {
        const { x, y } = at.get(node.id)!;
        return (
          <g key={node.id} className={cn(node.turns === 0 && "opacity-50")}>
            <rect x={x - NODE_W / 2} y={y - NODE_H / 2} width={NODE_W} height={NODE_H} rx={6} className={cn("stroke-current", node.entryPages.length > 0 ? "fill-brand-tint text-brand" : "fill-surface text-hairline")} />
            <text x={x} y={y - 4} textAnchor="middle" fontSize={12} className="fill-current">
              {node.label}
            </text>
            <text x={x} y={y + 12} textAnchor="middle" fontSize={12} className="fill-current text-slate">
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

/** A null figure has nothing to divide by: say so rather than print a free-looking $0.0000. */
const cost = (microUsd: number | null) => (microUsd === null ? "n/a" : microUsdCost(microUsd));

function StatCells({ turns, costPerTurnMicroUsd, costPerOutcomeMicroUsd }: TurnStats) {
  return (
    <>
      <TD className={NUM}>{turns}</TD>
      <TD className={NUM}>{cost(costPerTurnMicroUsd)}</TD>
      <TD className={NUM}>{cost(costPerOutcomeMicroUsd)}</TD>
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

/** The admin console's Personas tab: the persona map, its per-persona and per-edge cost tables, and recent turns for the chosen window. */
export function PersonasTab({ report }: { report: PersonaReport }) {
  const router = useRouter();
  const names = new Map(report.nodes.map((node) => [node.id, node.label]));
  const label = (id: string) => names.get(id) ?? id;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Text variant="secondary" className="text-sm" data-testid="personas-window">
          {`Last ${report.windowDays} days: ${plural(report.turns, "turn")}, ${plural(report.switches, "persona switch")}, ${plural(report.outcomeTurns, "turn")} someone acted on. Cost per turn ${cost(report.costPerTurnMicroUsd)}, per successful outcome ${cost(report.costPerOutcomeMicroUsd)}.`}
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
            A turn counts at the persona it entered and in full at every edge it took, so edge figures do not add up to a persona&apos;s. A self-loop is read from the step flags it sets; a hand-off from a declined task or a navigation call.
          </Text>
        </div>
      </Panel>
      <Panel title="Recent turns">
        {report.recent.length === 0 ? (
          <EmptyState title={`No assistant turns in the last ${report.windowDays} days`} />
        ) : (
          <ul aria-label="Recent turns" className="flex flex-col divide-y divide-hairline">
            {report.recent.map((turn, index) => (
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
                {/* Newest first, so the ordinal counts back from the list's length: "answer N" is the Nth oldest shown, as in a thread. */}
                <TurnBreakdown turnId={turn.turnId} ordinal={report.recent.length - index} />
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
