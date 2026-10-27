"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { SCOPE_CATALOGUE, type ConnectedApp } from "@tc/contracts";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Text } from "@/components/ui/text";
import { relativeDays } from "./TokensSection";

// **Account → Security → Connected apps** (M55 D10, moved by part 6): every
// app a person let act as them through OAuth, such as Claude, and Disconnect.
// `TokensSection`'s pattern, and its rules: `/api/account/connected-apps` is session-only, and
// a dead grant stays listed so the row can say why it stopped.
//
// Disconnect is confirmed because it cannot be undone from here: the app has
// to ask again, and the person consent again, to come back.

type AppState = "live" | "expired" | "disconnected";

function appState(app: ConnectedApp, now: Date = new Date()): AppState {
  if (app.revokedAt !== null) return "disconnected";
  return new Date(app.expiresAt).getTime() <= now.getTime() ? "expired" : "live";
}

const STATE_LABEL = { live: "Connected", expired: "Expired", disconnected: "Disconnected" } as const;
const STATE_BADGE = { live: "success", expired: "warning", disconnected: "neutral" } as const;

/** The row's last column: when it was used while live, and why it stopped once dead. */
function statusLine(app: ConnectedApp, state: AppState): string {
  if (state === "disconnected") {
    return app.revokedReason === "owner"
      ? "Disconnected. It stopped working immediately."
      : "Cut off: one of its keys was used twice. Connect it again to restore it.";
  }
  if (state === "expired") return `Expired ${relativeDays(app.expiresAt)}. Connect it again to restore it.`;
  const connected = `Connected ${relativeDays(app.createdAt)}`;
  return app.lastUsedAt === null ? `${connected}, not used yet.` : `${connected}, last used ${relativeDays(app.lastUsedAt)}.`;
}

/** Account's connected apps: the list, and Disconnect behind a confirm. */
export function ConnectedAppsSection() {
  const [apps, setApps] = useState<ConnectedApp[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [confirming, setConfirming] = useState<ConnectedApp | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The row just disconnected. Its Disconnect, where the confirm would hand
  // focus back, is gone, so focus goes to the row's new status rather than
  // dropping to <body>.
  const [disconnected, setDisconnected] = useState<string | null>(null);
  const statusIdPrefix = useId();

  useEffect(() => {
    if (disconnected !== null) document.getElementById(`${statusIdPrefix}-${disconnected}`)?.focus();
  }, [disconnected, statusIdPrefix]);

  useEffect(() => {
    let live = true;
    // eslint-disable-next-line no-restricted-globals -- an app API call with no client helper yet; moves onto the client with the collapse still open in KI-2026-09-05-q
    fetch("/api/account/connected-apps")
      .then((res) => (res.ok ? (res.json() as Promise<{ apps: ConnectedApp[] }>) : null))
      .then((body) => {
        if (!live) return;
        if (body === null) setFailed(true);
        else setApps(body.apps);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  async function disconnect(app: ConnectedApp) {
    setBusy(true);
    setError(null);
    try {
      // eslint-disable-next-line no-restricted-globals -- an app API call with no client helper yet; moves onto the client with the collapse still open in KI-2026-09-05-q
      const res = await fetch(`/api/account/connected-apps/${app.grantId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(String(res.status));
      // The route answers no body: the revoke is the fact, recorded here as the server did.
      const revokedAt = new Date().toISOString();
      setApps((current) =>
        current?.map((a) => (a.grantId === app.grantId ? { ...a, revokedAt, revokedReason: "owner" } : a)) ?? current,
      );
      setDisconnected(app.grantId);
    } catch {
      setError("That app could not be disconnected. Try again.");
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  }

  if (failed) {
    return (
      <Text variant="secondary" className="text-sm">
        Your connected apps could not be loaded just now.
      </Text>
    );
  }
  if (apps === null) return null;

  return (
    // The heading is `AccountScreen`'s, as for tokens.
    <section className="flex flex-col gap-3">
      <Text variant="secondary" className="text-xs text-pretty">
        Apps you let act as you, such as Claude. Each holds only what you allowed when you connected it, and
        can never do more than you can. Disconnecting stops it at once.{" "}
        <Link href="/developers#connect-claude" className="underline">
          Connecting Claude
        </Link>
      </Text>

      {error !== null ? <Banner variant="danger">{error}</Banner> : null}

      {apps.length === 0 ? (
        <Text variant="secondary" className="text-sm">
          No apps are connected.
        </Text>
      ) : (
        // The token list's table, card and moss header, so the two sections read as one family.
        <div className="overflow-hidden rounded-lg border border-hairline bg-surface shadow-raised">
          <Table>
            <THead>
              <TR className="bg-moss">
                <TH className="px-3.5 py-3">App</TH>
                <TH className="px-3.5 py-3">What it may do</TH>
                <TH className="px-3.5 py-3">Status</TH>
                <TH className="px-3.5 py-3 text-right">
                  <span className="sr-only">Actions</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {apps.map((app) => {
                const state = appState(app);
                return (
                  <TR key={app.grantId} className="last:border-b-0">
                    <TD className="px-3.5 py-3 align-middle">
                      <div className="flex flex-wrap items-center gap-2">
                        <Text as="span" className="text-sm font-semibold text-ink">
                          {app.clientName}
                        </Text>
                        <Badge variant={STATE_BADGE[state]}>{STATE_LABEL[state]}</Badge>
                      </div>
                      {/* Where its codes went is the one thing known about it;
                          the name is the client's own claim unless the
                          redirect is Claude's callback (ADR-083 §6). */}
                      <Text as="span" variant="secondary" className="block font-mono text-xs">
                        {app.redirectHost}
                        {app.recognised ? "" : " · name not verified"}
                      </Text>
                    </TD>
                    <TD className="px-3.5 py-3 align-middle">
                      <Text as="span" variant="secondary" className="text-xs text-pretty">
                        {app.scopes.map((scope) => SCOPE_CATALOGUE[scope].title).join(", ")}
                      </Text>
                    </TD>
                    <TD className="px-3.5 py-3 align-middle">
                      <Text
                        as="span"
                        variant="secondary"
                        className="text-xs text-pretty"
                        id={`${statusIdPrefix}-${app.grantId}`}
                        tabIndex={app.grantId === disconnected ? -1 : undefined}
                      >
                        {statusLine(app, state)}
                      </Text>
                    </TD>
                    <TD className="px-3.5 py-3 text-right align-middle">
                      {state === "live" ? (
                        <Button variant="secondary" size="sm" onClick={() => setConfirming(app)}>
                          Disconnect
                        </Button>
                      ) : null}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </div>
      )}

      {confirming !== null ? (
        <ConfirmDialog
          title={`Disconnect ${confirming.clientName}?`}
          body="It stops working at once, on its next request. To use it again, connect it again and allow it."
          confirmLabel="Disconnect"
          busy={busy}
          onOpenChange={(open) => !open && setConfirming(null)}
          onConfirm={() => void disconnect(confirming)}
        />
      ) : null}
    </section>
  );
}
