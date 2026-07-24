import { Text } from "web";

export function Variants() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, width: 280 }}>
      <Text variant="body">Book the ferry a day early — it sells out in July.</Text>
      <Text variant="secondary">3 stops planned for Day 3.</Text>
      <Text variant="muted">Last edited 2 hours ago.</Text>
    </div>
  );
}
