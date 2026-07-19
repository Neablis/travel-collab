import { AlertTriangle, CheckCircle2, Info, OctagonAlert } from "lucide-react";
import { cn } from "../../lib/cn";

const variants = {
  warning: { classes: "bg-warning-tint text-warning-ink", Icon: AlertTriangle },
  info: { classes: "bg-info-tint text-info-ink", Icon: Info },
  danger: { classes: "bg-danger-tint text-danger-ink", Icon: OctagonAlert },
  success: { classes: "bg-success-tint text-success-ink", Icon: CheckCircle2 },
} as const;

export function Banner({ variant, actions, className, children, ...props }: { variant: keyof typeof variants; actions?: React.ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  const { classes, Icon } = variants[variant];
  return (
    <div role="status" className={cn("flex items-start gap-2 rounded-md px-3 py-2 text-sm", classes, className)} {...props}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="flex-1">{children}</div>
      {actions ? <div className="flex shrink-0 gap-1.5">{actions}</div> : null}
    </div>
  );
}
