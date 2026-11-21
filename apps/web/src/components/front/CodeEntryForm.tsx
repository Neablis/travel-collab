"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type CodeKind = "otp" | "recovery";

const FIELD: Record<CodeKind, { label: string; placeholder: string }> = {
  otp: { label: "Authenticator code", placeholder: "6-digit code" },
  recovery: { label: "Recovery code", placeholder: "xxxxx-xxxxx" },
};

/**
 * One typed code, submitted by its button or by Enter (M62 D2, D7). Shared by the
 * verify screen and the fresh-check dialog, so a code is asked for the same way in
 * both. It judges nothing: what is right, and what the lock says, is the caller's.
 */
export function CodeEntryForm({
  kind,
  pending,
  onSubmit,
}: {
  kind: CodeKind;
  pending: boolean;
  onSubmit: (code: string) => void;
}) {
  const [code, setCode] = useState("");
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (code.trim() !== "" && !pending) onSubmit(code.trim());
      }}
    >
      <Input
        aria-label={FIELD[kind].label}
        placeholder={FIELD[kind].placeholder}
        value={code}
        // The code is a one-time secret: no suggestions, and a phone offers the SMS-style fill.
        autoComplete={kind === "otp" ? "one-time-code" : "off"}
        inputMode={kind === "otp" ? "numeric" : "text"}
        autoCapitalize="none"
        spellCheck={false}
        // The person chose this option a moment ago, and the field is the only thing it shows.
        autoFocus
        onChange={(event) => setCode(event.currentTarget.value)}
      />
      <Button type="submit" variant="primary" pending={pending} disabled={code.trim() === ""}>
        Verify
      </Button>
    </form>
  );
}
