import { cn } from "../../lib/cn";
import { Button } from "../ui/button";

export type EmptyChipTone = "muted" | "action" | "error";

const toneClasses: Record<EmptyChipTone, string> = {
  muted: "border-hairline bg-surface text-slate",
  action: "border-brand bg-brand-tint text-brand-pressed hover:bg-moss",
  error: "border-danger-tint bg-danger-tint text-danger-ink",
};

// A small inline chip used for macro empty/unbound/error states. `action`
// tone renders through the Button primitive (clickable via onClick); the
// others render a <span>.
export function EmptyChip({ tone, label, onClick }: { tone: EmptyChipTone; label: string; onClick?: () => void }) {
  const className = cn(
    "inline-flex h-auto items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
    toneClasses[tone],
  );
  if (tone === "action") {
    return (
      <Button variant="secondary" className={className} onClick={onClick}>
        {label}
      </Button>
    );
  }
  return <span className={className}>{label}</span>;
}
