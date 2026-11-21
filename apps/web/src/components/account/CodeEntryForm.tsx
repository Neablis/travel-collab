"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";

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
  problem = null,
  onSubmit,
}: {
  kind: CodeKind;
  pending: boolean;
  /** Why the last code was refused; drawn under the field and tied to it for assistive tech. */
  problem?: string | null;
  onSubmit: (code: string) => void;
}) {
  const [code, setCode] = useState("");
  const problemId = useId();
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
        aria-invalid={problem !== null}
        aria-describedby={problem === null ? undefined : problemId}
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
      {problem === null ? null : (
        <Text id={problemId} variant="secondary" role="alert" className="text-danger-ink">
          {problem}
        </Text>
      )}
      <Button type="submit" variant="primary" pending={pending} disabled={code.trim() === ""}>
        Verify
      </Button>
    </form>
  );
}
