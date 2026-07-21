import { Input } from "web";

export function Default() {
  return <Input style={{ width: 240 }} defaultValue="Villa San Michele" />;
}

export function Placeholder() {
  return <Input placeholder="Search activities…" style={{ width: 240 }} />;
}

export function Disabled() {
  return <Input defaultValue="Locked field" disabled style={{ width: 240 }} />;
}
