"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * **The referral link, in one place** (M50 part 8). Account › Plan had the
 * only copy of it; the Share and Invite dialogs offer the same link, so the
 * link's shape and the mint call live here and all three read them.
 */

/** The signup URL that arrives with `code` already in the invite-code field. */
export function referralLink(code: string): string {
  return `${window.location.origin}/signup?code=${encodeURIComponent(code)}`;
}

/**
 * `POST /api/account/referrals`. `full` is the server's 409: the account
 * already holds as many unredeemed codes as it may.
 */
export async function mintReferralCode(): Promise<{ ok: true; code: string } | { ok: false; full: boolean }> {
  try {
    // eslint-disable-next-line no-restricted-globals -- an app API call with no client helper yet; moves onto the client with the collapse still open in KI-2026-09-05-q
    const res = await fetch("/api/account/referrals", { method: "POST" });
    if (!res.ok) return { ok: false, full: res.status === 409 };
    const body = (await res.json()) as { code: string };
    return { ok: true, code: body.code };
  } catch {
    return { ok: false, full: false };
  }
}

type ReferralsBody = { codes: { code: string; redeemed: boolean }[]; earnsReward: boolean };

export type ReferralLinkState = {
  /** `earnsReward` from the server; false until it has answered, and on any failure. */
  earns: boolean;
  status: "idle" | "copied" | "denied" | "full" | "failed";
  /** The link last put together, to show as text when the clipboard refused it. */
  link: string | null;
  copy: () => Promise<void>;
};

/**
 * **Whether to offer the link, and copying it** — for the dialogs, which know
 * nothing about plans.
 *
 * Reads `GET /api/account/referrals` on mount, so a caller mounts it only
 * while its dialog is open. `earnsReward` rather than the plan view's
 * `canRefer`: it is the same read `rewardReferrer` makes, so the line never
 * promises a month the reward would refuse, and it is a far lighter read than
 * the whole plan.
 *
 * Copying hands out the unredeemed code if there is one and mints only when
 * there is not: every outstanding code counts against the server's cap.
 */
export function useReferralLink(): ReferralLinkState {
  const [body, setBody] = useState<ReferralsBody | null>(null);
  const [status, setStatus] = useState<ReferralLinkState["status"]>("idle");
  const [link, setLink] = useState<string | null>(null);
  // `unredeemed` only changes once the mint has answered and re-rendered, so a
  // second click before then would mint again: it waits on this one instead.
  const minting = useRef<ReturnType<typeof mintReferralCode> | null>(null);

  useEffect(() => {
    let live = true;
    // eslint-disable-next-line no-restricted-globals -- an app API call with no client helper yet; moves onto the client with the collapse still open in KI-2026-09-05-q
    void fetch("/api/account/referrals")
      .then((res) => (res.ok ? (res.json() as Promise<ReferralsBody>) : null))
      .then((next) => live && setBody(next))
      .catch(() => live && setBody(null));
    return () => {
      live = false;
    };
  }, []);

  const unredeemed = body?.codes.find((code) => !code.redeemed)?.code ?? null;

  const copy = useCallback(async () => {
    let code = unredeemed;
    if (code === null) {
      minting.current ??= mintReferralCode().finally(() => (minting.current = null));
      const minted = await minting.current;
      if (!minted.ok) {
        setStatus(minted.full ? "full" : "failed");
        return;
      }
      code = minted.code;
      // Held as unredeemed, so a second copy reuses it rather than minting again.
      setBody((current) =>
        current === null ? current : { ...current, codes: [...current.codes, { code: minted.code, redeemed: false }] },
      );
    }
    const next = referralLink(code);
    setLink(next);
    try {
      await navigator.clipboard.writeText(next);
      setStatus("copied");
    } catch {
      setStatus("denied");
    }
  }, [unredeemed]);

  return { earns: body?.earnsReward === true, status, link, copy };
}
