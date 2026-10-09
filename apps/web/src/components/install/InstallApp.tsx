"use client";

import { useState } from "react";
import { Share, SquarePlus } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Text } from "@/components/ui/text";
import { useInstallPrompt } from "@/lib/useInstallPrompt";
import { useIsPhone } from "@/lib/useIsPhone";
import { SITE_NAME } from "@/lib/siteMetadata";

/**
 * The one install action the account menu's row and the phone nudge share:
 * `route` says whether to offer it at all, `install()` is what pressing it
 * does, and `steps` is the iOS sheet to render beside the control.
 *
 * Chromium gets its own install dialog. iOS has none to show, so it gets the
 * two steps Safari asks for instead.
 */
export function useInstallApp() {
  const { route, prompt } = useInstallPrompt();
  const [stepsOpen, setStepsOpen] = useState(false);
  return {
    route,
    install: () => {
      if (route === "ios") setStepsOpen(true);
      else void prompt();
    },
    steps: <InstallStepsSheet open={stepsOpen} onOpenChange={setStepsOpen} />,
  };
}

// Safari's two taps, each beside the icon Safari draws for it, so the reader
// is matching a picture rather than following a description.
function InstallStepsSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const isPhone = useIsPhone();
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={`Add ${SITE_NAME} to your Home Screen`} size={isPhone ? "bottom" : "rail"}>
      <ol className="flex flex-col gap-4 pt-1">
        <InstallStep icon={<Share className="size-5" aria-hidden />}>
          Tap <strong>Share</strong> in Safari&apos;s toolbar.
        </InstallStep>
        <InstallStep icon={<SquarePlus className="size-5" aria-hidden />}>
          Choose <strong>Add to Home Screen</strong>.
        </InstallStep>
      </ol>
    </Sheet>
  );
}

function InstallStep({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3">
      <span className="grid size-11 shrink-0 place-items-center rounded-md border border-hairline text-brand">{icon}</span>
      <Text as="span">{children}</Text>
    </li>
  );
}
