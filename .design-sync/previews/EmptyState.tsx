import { EmptyState, Button } from "web";

export function Default() {
  return (
    <div style={{ width: 320 }}>
      <EmptyState
        title="No activities yet"
        body="Add your first stop to start building the itinerary."
        action={<Button variant="primary" size="sm">Add activity</Button>}
      />
    </div>
  );
}
