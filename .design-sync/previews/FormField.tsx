import { FormField, Input } from "web";

export function Default() {
  return (
    <div style={{ width: 280 }}>
      <FormField id="trip-name" label="Trip name" description="Shown to every collaborator.">
        <Input id="trip-name" defaultValue="Amalfi Coast 2026" />
      </FormField>
    </div>
  );
}

export function WithError() {
  return (
    <div style={{ width: 280 }}>
      <FormField id="budget" label="Budget" error="Budget must be greater than 0.">
        <Input id="budget" defaultValue="-100" />
      </FormField>
    </div>
  );
}
