import { Textarea } from "web";

export function Default() {
  return <Textarea style={{ width: 280 }} defaultValue="Book the ferry a day early — it sells out in July." />;
}

export function Placeholder() {
  return <Textarea placeholder="Add a note…" style={{ width: 280 }} />;
}
