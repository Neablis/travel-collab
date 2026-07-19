import { Heading } from "./heading";
import { Text } from "./text";

export function EmptyState({ icon, title, body, action }: { icon?: React.ReactNode; title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border-strong px-6 py-10 text-center">
      {icon ? <div className="text-slate">{icon}</div> : null}
      <Heading level={4}>{title}</Heading>
      {body ? <Text variant="secondary">{body}</Text> : null}
      {action ? <div className="mt-1.5">{action}</div> : null}
    </div>
  );
}
