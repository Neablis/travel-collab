"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { fetchPersonaGraph } from "@/lib/apiClient";
import type { DebugEdge, DebugPersona, PersonaGraphResponse, PersonaReach } from "@/lib/askDebug";
import { cn } from "@/lib/cn";

// **The Ask panel's Debug strip** (M57 part 5, ADR-085): the persona graph for
// the page the panel is on, and the tools each persona holds, both read from
// the operator endpoint: under the caller's own role on the trip, and a plan
// and question class the endpoint assumes (and the panel says so). The panel
// mounts it only for an operator with Debug on; the endpoint 404s to anyone
// else regardless.
//
// **The graph is drawn as plain SVG**: six nodes and the edges leaving one of
// them, which is a fixed layout and not a layout problem. A graph library
// would be a dependency for a picture whose text alternative (the lists below
// it) is the part that is read.

const REACH_TEXT: Record<PersonaReach, string> = {
  entry: "entry for this page",
  switch: "reachable by a switch",
  "hand-off": "reachable by a hand-off",
  never: "never reachable from here",
};

const W = 320;
const H = 190;

/** Six nodes on an ellipse, entry first at the top. */
function place(index: number, total: number): { x: number; y: number } {
  const angle = (index / total) * 2 * Math.PI - Math.PI / 2;
  return { x: W / 2 + 108 * Math.cos(angle), y: H / 2 + 70 * Math.sin(angle) };
}

function Diagram({ graph }: { graph: PersonaGraphResponse }) {
  const at = new Map(graph.personas.map((persona, index) => [persona.id, place(index, graph.personas.length)]));
  const drawn = graph.edges.filter((edge): edge is DebugEdge & { to: NonNullable<DebugEdge["to"]> } => edge.to !== null && edge.to !== edge.from);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} aria-hidden className="w-full max-w-sm text-ink">
      <defs>
        <marker id="debug-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0 0 L8 4 L0 8 z" className="fill-current" />
        </marker>
      </defs>
      {drawn.map((edge) => {
        const from = at.get(edge.from)!;
        const to = at.get(edge.to)!;
        return (
          <line
            key={`${edge.via}-${edge.to}`}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            markerEnd="url(#debug-arrow)"
            strokeDasharray={edge.kind === "hand-off" ? "4 3" : undefined}
            className="stroke-current text-brand"
          />
        );
      })}
      {graph.personas.map((persona) => {
        const { x, y } = at.get(persona.id)!;
        return (
          <g key={persona.id} className={cn(persona.reach === "never" && "opacity-40")}>
            <rect x={x - 42} y={y - 12} width={84} height={24} rx={6} className={cn("stroke-current", persona.reach === "entry" ? "fill-brand-tint text-brand" : "fill-surface text-hairline")} />
            <text x={x} y={y + 4} textAnchor="middle" className="fill-current text-xs">
              {persona.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function edgeText(edge: DebugEdge, label: (id: string) => string): string {
  const guard = edge.guard.length === 0 ? "" : ` when ${edge.guard.join(" and ")}`;
  const to = edge.to === null ? "leaves the graph" : edge.to === edge.from ? "stays in the persona" : label(edge.to);
  return `${edge.kind} via ${edge.via} to ${to}${guard}`;
}

function ToolList({ persona }: { persona: DebugPersona }) {
  return (
    <li>
      <p className="font-semibold">
        {persona.label} <span className="font-normal text-slate">({persona.tools.length})</span>
      </p>
      <ul aria-label={`${persona.label} tools`} className="text-slate">
        {persona.tools.map((tool) => (
          <li key={tool.name}>
            <code>{tool.name}</code>, {tool.domain}, {tool.effect}
          </li>
        ))}
      </ul>
    </li>
  );
}

/** The Debug strip for the page kind `surface`: the persona graph and each persona's tools, read from the operator endpoint. */
export function AskDebugPanel({ surface }: { surface: string }) {
  const [graph, setGraph] = useState<PersonaGraphResponse | "loading" | "failed">("loading");
  // Read from the router, not `window`, so a move to another trip of the same
  // page kind re-draws the graph under that trip's role.
  const pathname = usePathname();

  useEffect(() => {
    let live = true;
    setGraph("loading");
    // The trip the panel is on, read off the address: the rail is handed a
    // scope and no id, and the caps the graph is drawn under are the caller's
    // on THIS trip. Off a trip page there is none, and the graph is drawn for
    // a read-only caller.
    const onTrip = /^\/trips\/([0-9a-f-]{36})(?:\/|$)/i.exec(pathname ?? "")?.[1];
    void fetchPersonaGraph(surface, onTrip).then((got) => live && setGraph(got.ok ? got.value : "failed"));
    return () => {
      live = false;
    };
  }, [surface, pathname]);

  if (graph === "loading") return <p className="text-xs text-slate">Reading the persona graph…</p>;
  if (graph === "failed") return <p className="text-xs text-slate">The persona graph could not be read.</p>;

  const labels = new Map(graph.personas.map((persona) => [persona.id as string, persona.label]));
  const label = (id: string) => labels.get(id) ?? id;
  // The current persona's tools first (the endpoint already sorts it first).
  return (
    <section aria-label="Debug" className="flex flex-col gap-3 rounded-md border border-hairline bg-surface px-3 py-2 text-xs text-ink">
      <details open>
        <summary className="cursor-pointer font-semibold">Graph</summary>
        <p className="mt-1 text-slate">
          {graph.surface} page enters {label(graph.entry)}. Your role here: {graph.caps.role}. Plan and question class are assumed {graph.caps.plan}, so a real turn may offer less.
        </p>
        <Diagram graph={graph} />
        <ul aria-label="Personas" className="mt-1">
          {graph.personas.map((persona) => (
            <li key={persona.id} className={cn(persona.reach === "never" && "text-slate")}>
              <span className={cn(persona.reach === "entry" && "font-semibold")}>{persona.label}</span>: {REACH_TEXT[persona.reach]}
            </li>
          ))}
        </ul>
        <ul aria-label={`Edges from ${label(graph.entry)}`} className="mt-1 text-slate">
          {graph.edges.map((edge) => (
            <li key={`${edge.kind}-${edge.via}-${edge.to}`}>{edgeText(edge, label)}</li>
          ))}
        </ul>
      </details>
      <details>
        <summary className="cursor-pointer font-semibold">Tools</summary>
        <ul aria-label="Tools by persona" className="mt-1 flex flex-col gap-2">
          {graph.personas.map((persona) => (
            <ToolList key={persona.id} persona={persona} />
          ))}
        </ul>
      </details>
    </section>
  );
}
