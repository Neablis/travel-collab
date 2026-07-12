"use client";
import * as RadixTabs from "@radix-ui/react-tabs";
import { cn } from "../../lib/cn";

export const Tabs = RadixTabs.Root;
export const TabsContent = RadixTabs.Content;

export function TabsList({ className, ...props }: React.ComponentProps<typeof RadixTabs.List>) {
  return <RadixTabs.List className={cn("inline-flex gap-0.5 rounded-md bg-moss p-0.5", className)} {...props} />;
}

export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof RadixTabs.Trigger>) {
  return (
    <RadixTabs.Trigger
      className={cn(
        "cursor-pointer rounded-sm px-2.5 py-1 text-sm font-medium text-slate transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-brand data-[state=active]:bg-surface data-[state=active]:font-semibold data-[state=active]:text-ink data-[state=active]:shadow-raised",
        className,
      )}
      {...props}
    />
  );
}
