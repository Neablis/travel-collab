"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { Toast } from "@/components/ui/toast";
import type { AdminAccountGrantRecord, AdminAccountMoment } from "@/lib/adminAccount";
import { dayLabel, shortDate, spokenRef } from "./accountFormat";

// **Plan and grants** on the account page (M36 link 3): each active grant as a
// card with Revoke, then the plan history. The console's second write moved
// here from the table row, and gained the two things the row never had.
//
//   * **A confirm.** Revoking takes something away on the account's next
//     request, and a one-click control in a dense table was the easiest wrong
//     click on the console. The confirm says what happens, in the spec's words.
//   * **A failure line.** The row's revoke ignored a refusal: the button came
//     back and nothing said the grant was still held. A revoke that did not
//     land must say so, or the operator walks away believing it did — and say
//     which way it missed: a request that never arrived, or one the server
//     refused with a status. Two answers get their own line:
//       - 409 `no-active-grant`: the endpoint found no unrevoked grant by that
//         id, so it was already gone; the card goes and the page re-reads.
//       - 404 `not-found`: the admin gate's answer — the session ended, or the
//         caller stopped being an operator (role or `admin-console` flag
//         removed). Nothing was revoked, so the card stays and nothing re-reads.
//     A 404 with any other body (a proxy, a missing route) is a plain refusal.
//
// **Revoking marks, it never deletes** — the endpoint stamps `revoked_at`, the
// row stays and reappears below as history. The card disappears when the page
// re-reads, because an inactive grant has nothing left to revoke.

const UNREACHED = "The revoke didn't reach the server. Nothing changed — they still hold it.";
const refused = (status: number) => `The server refused the revoke (${status}). Nothing changed — they still hold it.`;

const SESSION_ENDED = "Your session ended — nothing changed";

/** The error code in a JSON error body, or null for no body, no JSON, or no code. */
async function errorCode(res: Response): Promise<string | null> {
  const body: unknown = await res.json().catch(() => null);
  const code = typeof body === "object" && body !== null ? (body as { error?: unknown }).error : null;
  return typeof code === "string" ? code : null;
}

/** What one card is doing: at rest, asking, sending, or having failed with a line to show. */
type CardState = "idle" | "confirming" | "busy" | { failed: string };

/** Active grants as revocable cards, then every plan event newest first. */
export function AccountGrants({
  grants,
  history,
  fallsBackTo,
  account,
  now,
}: {
  grants: readonly AdminAccountGrantRecord[];
  history: readonly AdminAccountMoment[];
  /** The plan version they hold with no grant — the resolver's `conferred`. */
  fallsBackTo: string;
  /** The address (or id) the toast names. */
  account: string;
  now: string;
}) {
  const router = useRouter();
  const [states, setStates] = useState<Readonly<Record<string, CardState>>>({});
  const [revoked, setRevoked] = useState<ReadonlySet<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const set = (id: string, state: CardState) => setStates((current) => ({ ...current, [id]: state }));

  const active = grants.filter((grant) => grant.active && !revoked.has(grant.id));

  /** `others`: the active grants besides this one when Revoke was confirmed. */
  async function revoke(grantId: string, others: number) {
    set(grantId, "busy");
    try {
      // eslint-disable-next-line no-restricted-globals -- an app API call with no client helper yet; moves onto the client with the collapse still open in KI-2026-09-05-q
      const res = await fetch("/api/admin/grants", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ grantId }),
      });
      const code = res.ok ? null : await errorCode(res);
      const gone = res.status === 409 && code === "no-active-grant";
      if (!res.ok && !gone) {
        set(grantId, { failed: res.status === 404 && code === "not-found" ? SESSION_ENDED : refused(res.status) });
        return;
      }
      // Hidden here AND re-read: the local set takes the card away now, the
      // refresh makes the header, the badges and the history agree with it.
      // The refresh is requested before the toast, which says it happened.
      setRevoked((current) => new Set(current).add(grantId));
      router.refresh();
      setToast(
        gone
          ? "Already revoked — the page has re-read"
          : others === 0
            ? `Revoked — ${account} holds ${spokenRef(fallsBackTo)} from their next request`
            : `Revoked — ${account} keeps what their other ${others === 1 ? "grant gives" : "grants give"} them from their next request`,
      );
    } catch {
      set(grantId, { failed: UNREACHED });
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {active.length > 0 && (
        <ul className="flex flex-col gap-2">
          {active.map((grant) => {
            const state = states[grant.id] ?? "idle";
            const others = active.length - 1;
            return (
              <li
                key={grant.id}
                data-testid={`grant-${grant.id}`}
                className="flex flex-col gap-2 rounded-md border border-hairline px-3 py-2.5"
              >
                <div className="flex items-center justify-between gap-2.5">
                  <div className="flex flex-col gap-0.5">
                    <Text as="span" className="text-sm font-semibold text-ink">
                      {grant.source} grant · {spokenRef(grant.planVersionRef)}
                    </Text>
                    <Text as="span" className="font-mono text-xs text-slate">
                      {/* Null is permanent, which is what a founder grant is. */}
                      {grant.expiresAt === null ? "permanent" : `runs out ${shortDate(grant.expiresAt)}`}
                      {grant.grantedBy !== null && ` · by ${grant.grantedBy}`}
                    </Text>
                  </div>
                  {(state === "idle" || typeof state === "object") && (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Revoke the ${grant.source} grant of ${spokenRef(grant.planVersionRef)}`}
                      onClick={() => set(grant.id, "confirming")}
                    >
                      Revoke
                    </Button>
                  )}
                </div>
                {(state === "confirming" || state === "busy") && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-sm bg-danger-tint px-2.5 py-2">
                    <Text as="span" className="text-sm text-danger-ink">
                      {others === 0
                        ? `They drop to ${spokenRef(fallsBackTo)} on their next request.`
                        : `They keep what their other ${others === 1 ? "grant gives" : "grants give"} them on their next request.`}{" "}
                      The grant row stays, marked revoked.
                    </Text>
                    <div className="flex gap-1.5">
                      <Button variant="ghost" size="sm" disabled={state === "busy"} onClick={() => set(grant.id, "idle")}>
                        Keep it
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={state === "busy"}
                        onClick={() => void revoke(grant.id, others)}
                      >
                        Revoke
                      </Button>
                    </div>
                  </div>
                )}
                {typeof state === "object" && (
                  <Text as="span" role="alert" className="text-sm text-danger-ink">
                    {state.failed}
                  </Text>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <ol aria-label="Plan history" className="flex flex-col">
        {history.map((moment, index) => (
          <li
            key={`${moment.at}-${index}`}
            className="flex items-baseline gap-2.5 border-t border-hairline py-1.5"
          >
            <span className="w-18 shrink-0 font-mono text-xs text-slate">{dayLabel(moment.at, now)}</span>
            <span className="text-sm text-ink">{moment.what}</span>
          </li>
        ))}
      </ol>

      {toast !== null && <Toast message={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
