"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { formatRelativeInstant } from "@/lib/formatDate";
import { addPasskey } from "@/lib/mfaClient";
import type { MfaFactorView, MfaStatusResponse } from "@/lib/mfaWire";
import { FreshCheckDialog } from "./FreshCheckDialog";
import { RecoveryCodesSheet } from "./RecoveryCodesSheet";

// *Two-step sign-in* on the Security tab (M62). Off, it offers a second step after
// Google; on, it lists every factor so each can be told apart and renamed. The
// heading is the tab's (`SecuritySection`), as for its neighbours. Remove and
// turn-off are part 4, and the authenticator app is part 3.

const KIND_LABEL: Record<MfaFactorView["kind"], string> = { passkey: "Passkey", totp: "Authenticator app" };

const lastUsed = (factor: MfaFactorView) =>
  factor.lastUsedAt === null ? "never used" : `used ${formatRelativeInstant(factor.lastUsedAt) ?? "recently"}`;

/** Whether two-step sign-in is on, its factors, and adding a passkey. */
export function TwoStepSection() {
  // `null` until the first read lands, so the section does not flash "off" at an
  // account that has it on; `"failed"` when it never does.
  const [status, setStatus] = useState<MfaStatusResponse | "failed" | null>(null);
  const [adding, setAdding] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  const load = useCallback(async () => {
    try {
      // eslint-disable-next-line no-restricted-globals -- an app API call with no client helper yet; moves onto the client with the collapse still open in KI-2026-09-05-q
      const res = await fetch("/api/account/mfa/factors");
      setStatus(res.ok ? ((await res.json()) as MfaStatusResponse) : "failed");
    } catch {
      setStatus("failed");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function add() {
    setAdding(true);
    setProblem(null);
    const result = await addPasskey();
    setAdding(false);
    if (result.status === "fresh-check-required") setChecking(true);
    else if (result.status === "added") {
      if (result.recoveryCodes !== null) setCodes(result.recoveryCodes);
      await load();
    } else if (result.status === "failed") {
      setProblem(
        result.reason === "already-registered"
          ? "That passkey is already on this account."
          : "The passkey could not be added just now. Try again.",
      );
    }
  }

  async function rename() {
    if (renaming === null) return;
    // eslint-disable-next-line no-restricted-globals -- an app API call with no client helper yet; moves onto the client with the collapse still open in KI-2026-09-05-q
    const res = await fetch(`/api/account/mfa/factors/${renaming.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: renaming.name }),
    });
    if (!res.ok) {
      setProblem("The name could not be changed just now. Try again.");
      return;
    }
    setRenaming(null);
    setProblem(null);
    await load();
  }

  if (status === null) return null;
  if (status === "failed") {
    return (
      <Text variant="secondary" className="text-sm" data-testid="two-step-failed">
        Two-step sign-in could not be loaded just now. Reload to try again.
      </Text>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="two-step-section">
      {status.enabled ? (
        <ul className="flex flex-col gap-2">
          {status.factors.map((factor) => (
            <li key={factor.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border-strong p-3">
              {renaming?.id === factor.id ? (
                <form
                  className="flex flex-1 items-center gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void rename();
                  }}
                >
                  <Input
                    aria-label="Factor name"
                    value={renaming.name}
                    maxLength={60}
                    onChange={(event) => setRenaming({ id: factor.id, name: event.currentTarget.value })}
                  />
                  <Button type="submit" variant="primary" size="sm" disabled={renaming.name.trim() === ""}>
                    Save
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setRenaming(null)}>
                    Cancel
                  </Button>
                </form>
              ) : (
                <>
                  <div className="flex flex-col">
                    <span className="font-medium text-ink">{factor.name}</span>
                    <Text variant="muted">
                      {KIND_LABEL[factor.kind]} · {lastUsed(factor)}
                    </Text>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Rename ${factor.name}`}
                    onClick={() => setRenaming({ id: factor.id, name: factor.name })}
                  >
                    Rename
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <Text variant="secondary">Add a second step after Google</Text>
      )}
      {problem === null ? null : (
        <Text variant="secondary" role="alert" className="text-danger-ink">
          {problem}
        </Text>
      )}
      <div>
        <Button variant={status.enabled ? "secondary" : "primary"} pending={adding} onClick={() => void add()}>
          Add a passkey
        </Button>
      </div>
      {checking ? (
        <FreshCheckDialog
          mfaEnabled={status.enabled}
          onClose={() => setChecking(false)}
          onChecked={() => {
            setChecking(false);
            void add();
          }}
        />
      ) : null}
      {codes === null ? null : (
        <RecoveryCodesSheet
          codes={codes}
          onDone={() => {
            setCodes(null);
          }}
        />
      )}
    </div>
  );
}
