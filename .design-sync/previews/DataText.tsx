import { DataText } from "web";

export function Sizes() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <DataText size="base">14:30</DataText>
      <DataText size="sm">178.00 EUR</DataText>
      <DataText size="xs">2h 40m</DataText>
    </div>
  );
}
