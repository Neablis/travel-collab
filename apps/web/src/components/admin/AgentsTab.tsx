"use client";

import { useState } from "react";
import { AdminAgentBlock, type AdminAgent } from "@tc/contracts";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { Text } from "@/components/ui/text";

// **The Agents tab** (M60 part 4, ADR-089 decision 3): the Personal Agents this
// deployment has seen, and the operator's switch over each by `client_id`.
//
// The list is the server render's, as `AccountTestMode`'s first state is; a
// click changes the one row from what the PUT or DELETE answers, and a refusal
// leaves it where it was and says so. **Block is confirmed and Unblock is not**:
// blocking stops people's agents at once, and the way back costs nothing.

const blockUrl = (clientId: string) => `/api/admin/agents/${encodeURIComponent(clientId)}/block`;

const date = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** What the operator is told when a request did not land. */
function refusalOf(status: number): string {
  if (status === 404) return "Your session ended. Nothing changed.";
  return `The server refused the change (${status}). Nothing changed.`;
}

/** The agents table, with Block and Unblock on each row. */
export function AgentsTab({ agents, seenCap }: { agents: AdminAgent[]; seenCap?: number }) {
  const [blocked, setBlocked] = useState<ReadonlyMap<string, boolean>>(() => new Map(agents.map((a) => [a.clientId, a.blocked])));
  const [confirming, setConfirming] = useState<AdminAgent | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  // Logos that did not load (the CSP's `img-src` may refuse one): left out, as Connected apps does.
  const [logoFailed, setLogoFailed] = useState<ReadonlySet<string>>(new Set());

  async function change(agent: AdminAgent, block: boolean) {
    setBusy(true);
    setFailed(null);
    try {
      // eslint-disable-next-line no-restricted-globals -- an app API call with no client helper yet; moves onto the client with the collapse still open in KI-2026-09-05-q
      const res = await fetch(blockUrl(agent.clientId), { method: block ? "PUT" : "DELETE" });
      const stored = res.ok ? AdminAgentBlock.safeParse(await res.json().catch(() => null)) : null;
      if (stored?.success !== true) {
        setFailed(refusalOf(res.status));
        return;
      }
      setBlocked((current) => new Map(current).set(agent.clientId, stored.data.blocked));
    } catch {
      setFailed("The change didn't reach the server. Nothing changed.");
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  }

  if (agents.length === 0) return <EmptyState title="No Personal Agent has connected yet." />;
  // The server read stops at its cap, so a full list may be hiding older agents.
  const capped = seenCap !== undefined && agents.length >= seenCap;

  return (
    <section className="flex flex-col gap-3">
      {failed !== null ? (
        <Banner variant="danger" role="alert">
          {failed}
        </Banner>
      ) : null}
      {capped ? (
        <Text variant="secondary" className="text-xs">
          Showing the {seenCap} most recently seen agents, and every blocked one.
        </Text>
      ) : null}
      {/* Scrolls rather than clips: the Actions column, the tab's one action, is the last of six. */}
      <div className="overflow-x-auto rounded-lg border border-hairline bg-surface shadow-raised">
        <Table>
          <THead>
            <TR className="bg-moss">
              <TH className="px-3.5 py-3">Agent</TH>
              <TH className="px-3.5 py-3">Domain</TH>
              <TH className="px-3.5 py-3 text-right">Sessions, 30 days</TH>
              <TH className="px-3.5 py-3 text-right">Accounts</TH>
              <TH className="px-3.5 py-3">Last seen</TH>
              <TH className="px-3.5 py-3 text-right">
                <span className="sr-only">Actions</span>
              </TH>
            </TR>
          </THead>
          <TBody>
            {agents.map((agent) => {
              const isBlocked = blocked.get(agent.clientId) ?? agent.blocked;
              return (
                <TR key={agent.clientId} className="last:border-b-0">
                  <TD className="px-3.5 py-3 align-middle">
                    <div className="flex flex-wrap items-center gap-2">
                      {agent.logoUri !== null && !logoFailed.has(agent.clientId) ? (
                        // eslint-disable-next-line @next/next/no-img-element -- an agent's own https logo, which next/image would proxy through our optimizer
                        <img
                          src={agent.logoUri}
                          // Decorative: the name is the next word in the row.
                          alt=""
                          data-testid="agent-logo"
                          className="size-6 rounded"
                          onError={() => setLogoFailed((current) => new Set(current).add(agent.clientId))}
                        />
                      ) : null}
                      <Text as="span" className="text-sm font-semibold text-ink">
                        {agent.name ?? agent.domain}
                      </Text>
                      {isBlocked ? <Badge variant="danger">Blocked</Badge> : null}
                    </div>
                  </TD>
                  <TD className="px-3.5 py-3 align-middle">
                    <Text as="span" variant="secondary" className="font-mono text-xs">
                      {agent.domain}
                    </Text>
                  </TD>
                  <TD className="px-3.5 py-3 text-right align-middle tabular-nums">{agent.sessions30d}</TD>
                  <TD className="px-3.5 py-3 text-right align-middle tabular-nums">{agent.accounts}</TD>
                  <TD className="px-3.5 py-3 align-middle">
                    <Text as="span" variant="secondary" className="text-xs">
                      {date(agent.lastSeenAt)}
                    </Text>
                  </TD>
                  <TD className="px-3.5 py-3 text-right align-middle">
                    {isBlocked ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        aria-label={`Unblock ${agent.name ?? agent.domain}`}
                        disabled={busy}
                        onClick={() => void change(agent, false)}
                      >
                        Unblock
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        aria-label={`Block ${agent.name ?? agent.domain}`}
                        disabled={busy}
                        onClick={() => setConfirming(agent)}
                      >
                        Block
                      </Button>
                    )}
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </div>

      {confirming !== null ? (
        <ConfirmDialog
          title={`Block ${confirming.name ?? confirming.domain}?`}
          body="Its sign-ins stop and every request it sends is refused."
          confirmLabel="Block"
          busy={busy}
          onOpenChange={(open) => !open && setConfirming(null)}
          onConfirm={() => void change(confirming, true)}
        />
      ) : null}
    </section>
  );
}
