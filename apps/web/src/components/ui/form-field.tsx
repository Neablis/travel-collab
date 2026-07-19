import { Label } from "./label";
import { Text } from "./text";

export function FormField({ id, label, description, hint, error, children }: { id: string; label: string; description?: string; hint?: string; error?: string | null; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {description ? <Text variant="secondary">{description}</Text> : null}
      {children}
      {error ? (
        <Text variant="muted" className="text-danger-ink">{error}</Text>
      ) : hint ? (
        <Text variant="muted">{hint}</Text>
      ) : null}
    </div>
  );
}
