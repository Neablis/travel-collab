import { Heading } from "web";

export function Levels() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <Heading level={1}>Amalfi Coast 2026</Heading>
      <Heading level={2}>Day 3 — Positano to Amalfi</Heading>
      <Heading level={3}>Morning</Heading>
      <Heading level={4}>Ferry to Capri</Heading>
    </div>
  );
}
