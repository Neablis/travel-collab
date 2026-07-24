import { Dialog, DialogFooter, Button } from "web";

export function Default() {
  return (
    <Dialog open onOpenChange={() => {}} title="Remove activity?">
      <p style={{ fontSize: 14, color: "#5a6472", lineHeight: 1.45 }}>
        This removes &ldquo;Ferry to Capri&rdquo; from the itinerary. This can&rsquo;t be undone.
      </p>
      <DialogFooter>
        <Button variant="ghost">Cancel</Button>
        <Button variant="destructive">Remove</Button>
      </DialogFooter>
    </Dialog>
  );
}
