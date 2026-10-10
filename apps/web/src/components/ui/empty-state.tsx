import { Heading } from "./heading";
import { Text } from "./text";

/**
 * A dashed box saying a list or view is empty, with an optional way forward.
 *
 * `level` is the title's place in the page outline, and the caller is the only
 * one who knows it: axe failed `/playbooks` on heading-order because this was
 * always an h4, sitting straight under the screen's h1. It looks the same at
 * every level (the h4 type it always had), so passing the right level never
 * changes the design. Defaults to 4 for the callers not yet audited.
 */
export function EmptyState({
  icon,
  title,
  body,
  action,
  level = 4,
}: {
  icon?: React.ReactNode;
  title: string;
  body?: string;
  action?: React.ReactNode;
  level?: 2 | 3 | 4;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border-strong px-6 py-10 text-center">
      {icon ? <div className="text-slate">{icon}</div> : null}
      <Heading level={level} className="text-md font-medium">
        {title}
      </Heading>
      {body ? <Text variant="secondary">{body}</Text> : null}
      {action ? <div className="mt-1.5">{action}</div> : null}
    </div>
  );
}
