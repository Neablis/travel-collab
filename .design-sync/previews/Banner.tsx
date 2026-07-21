import { Banner, Button } from "web";

export function Variants() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, width: 380 }}>
      <Banner variant="info">Trip dates updated by Alex.</Banner>
      <Banner variant="warning" actions={<Button size="sm" variant="ghost">Review</Button>}>
        This activity conflicts with another booking.
      </Banner>
      <Banner variant="danger">Payment failed — update your card.</Banner>
      <Banner variant="success">Trip saved.</Banner>
    </div>
  );
}
