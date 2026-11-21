"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { formatRelativeInstant } from "@/lib/formatDate";
import { addPasskey, regenerateRecoveryCodes } from "@/lib/mfaClient";
import type { MfaFactorView, MfaStatusResponse } from "@/lib/mfaWire";
import { AddAuthenticatorDialog } from "./AddAuthenticatorDialog";
import { FreshCheckDialog } from "./FreshCheckDialog";
import { RecoveryCodesSheet } from "./RecoveryCodesSheet";

// *Two-step sign-in* on the Security tab (M62). Off, it offers a second step after
// Google; on, it lists every factor so each can be told apart and renamed. The
// heading is the tab's (`SecuritySection`), as for its neighbours. Remove and
// turn-off are part 4.

const RECOVERY_CODE_COUNT = 10;

/** What the fresh check was asked for, so passing it carries on with that. */
type Pending = "passkey" | "authenticator" | "regenerate";

const KIND_LABEL: Record<MfaFactorView["kind"], string> = { passkey: "Passkey", totp: "Authenticator app" };

const lastUsed = (factor: MfaFactorView) =>
  factor.lastUsedAt === null ? "never used" : `used ${formatRelativeInstant(factor.lastUsedAt) ?? "recently"}`;

/** Whether two-step sign-in is on, its factors and recovery codes, and adding a factor. */
export function TwoStepSection() {
  // `null` until the first read lands, so the section does not flash "off" at an
  // account that has it on; `"failed"` when it never does.
  const [status, setStatus] = useState<MfaStatusResponse | "failed" | null>(null);
  const [adding, setAdding] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [checking, setChecking] = useState<Pending | null>(null);
  const [authenticator, setAuthenticator] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  // One click would void the ten codes in the person's drawer and show a new set once.
  const [confirmingRegenerate, setConfirmingRegenerate] = useState(false);
  // `signedIn: false` rides with the codes: the session could not be told that
  // two-step sign-in is on, so it ends when the codes are put away.
  const [codes, setCodes] = useState<{ list: string[]; signedIn: boolean } | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  // The row whose rename just ended: its input unmounts with focus in it, and focus
  // would fall to the page's start. Each Rename button is kept to hand it back to.
  const renameButtons = useRef(new Map<string, HTMLButtonElement | null>());
  const refocusRename = useRef<string | null>(null);

  useEffect(() => {
    if (renaming !== null || refocusRename.current === null) return;
    renameButtons.current.get(refocusRename.current)?.focus();
    refocusRename.current = null;
  }, [renaming]);

  function endRename(id: string) {
    refocusRename.current = id;
    setRenaming(null);
  }

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
    if (result.status === "fresh-check-required") setChecking("passkey");
    else if (result.status === "added") {
      if (result.recoveryCodes !== null) setCodes({ list: result.recoveryCodes, signedIn: result.signedIn });
      else if (!result.signedIn) leaveSession();
      await load();
    } else if (result.status === "failed") {
      setProblem(
        result.reason === "already-registered"
          ? "That passkey is already on this account."
          : "The passkey could not be added just now. Try again.",
      );
    }
  }

  async function regenerate() {
    setConfirmingRegenerate(false);
    setRegenerating(true);
    setProblem(null);
    const result = await regenerateRecoveryCodes();
    setRegenerating(false);
    if (result.status === "fresh-check-required") setChecking("regenerate");
    else if (result.status === "regenerated") {
      setCodes({ list: result.recoveryCodes, signedIn: true });
      await load();
    } else setProblem("The recovery codes could not be regenerated just now. Try again.");
  }

  // The session cookie is one the server refuses now: the route that clears it goes on to sign-in.
  function leaveSession() {
    window.location.assign("/api/session-expired?callbackUrl=%2Faccount%3Ftab%3Dsecurity");
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
    endRename(renaming.id);
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
                  className="flex flex-1 flex-wrap items-center gap-2"
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
                  <Button variant="ghost" size="sm" onClick={() => endRename(factor.id)}>
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
                    ref={(button) => {
                      renameButtons.current.set(factor.id, button);
                    }}
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
      {status.enabled ? (
        <div className="flex flex-wrap items-center gap-x-1 text-sm">
          <Text as="span" variant="secondary">
            Recovery codes: {status.recoveryCodesLeft} of {RECOVERY_CODE_COUNT} left
          </Text>
          <span aria-hidden className="text-slate">
            ·
          </span>
          {confirmingRegenerate ? (
            <>
              <Text as="span" variant="secondary">
                This voids your current codes.
              </Text>
              <Button variant="ghost" size="sm" onClick={() => void regenerate()}>
                Regenerate codes
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmingRegenerate(false)}>
                Keep current codes
              </Button>
            </>
          ) : (
            <Button variant="ghost" size="sm" pending={regenerating} onClick={() => setConfirmingRegenerate(true)}>
              Regenerate
            </Button>
          )}
        </div>
      ) : null}
      {problem === null ? null : (
        <Text variant="secondary" role="alert" className="text-danger-ink">
          {problem}
        </Text>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant={status.enabled ? "secondary" : "primary"} pending={adding} onClick={() => void add()}>
          Add a passkey
        </Button>
        <Button variant="secondary" onClick={() => setAuthenticator(true)}>
          Add an authenticator app
        </Button>
      </div>
      {checking === null ? null : (
        <FreshCheckDialog
          mfaEnabled={status.enabled}
          hasPasskey={status.factors.some((f) => f.kind === "passkey")}
          onClose={() => setChecking(null)}
          onChecked={() => {
            const next = checking;
            setChecking(null);
            if (next === "passkey") void add();
            else if (next === "authenticator") setAuthenticator(true);
            else void regenerate();
          }}
        />
      )}
      {authenticator ? (
        <AddAuthenticatorDialog
          onClose={() => setAuthenticator(false)}
          onFreshCheckRequired={() => {
            setAuthenticator(false);
            setChecking("authenticator");
          }}
          onAdded={(recoveryCodes, signedIn) => {
            setAuthenticator(false);
            if (recoveryCodes !== null) setCodes({ list: recoveryCodes, signedIn });
            else if (!signedIn) leaveSession();
            void load();
          }}
        />
      ) : null}
      {codes === null ? null : (
        <RecoveryCodesSheet
          codes={codes.list}
          note={codes.signedIn ? undefined : "This browser could not be signed in to the new second step. Save the codes, then sign in again."}
          onDone={() => {
            setCodes(null);
            if (!codes.signedIn) leaveSession();
          }}
        />
      )}
    </div>
  );
}
