// **The eval lane's network rule** (M33): this machine, the database, and the
// AI Gateway. Nothing else.
//
// The eval exists to call a real model, so the integration lane's guard (which
// refuses every third party) cannot be used as it is. What it still has to
// stop is everything that is NOT the model: weather, place search, link
// previews and Sentry would make a run cost money it did not mean to spend and
// answer differently from one run to the next for reasons that are not the
// model's. Place search is stubbed at its port by the runner, so a turn that
// searches still gets an answer.
import { blockedRequestMessage, isLocalUrl } from "./networkGuard";

export const EVAL_ALLOWED_HOSTS = new Set(["ai-gateway.vercel.sh"]);

/** True when `url` is this machine or a host the eval may reach. */
export function evalMayFetch(url: string): boolean {
  if (isLocalUrl(url)) return true;
  try {
    return EVAL_ALLOWED_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

const inner = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!evalMayFetch(url)) return Promise.reject(new Error(blockedRequestMessage(url)));
  return inner(input, init);
}) as typeof fetch;

// **No socket guard here, unlike the other lanes.** Node's `fetch` (undici)
// dials through `net.Socket`, so the integration lane's socket guard would
// refuse the Gateway itself. The fetch allowlist above is the control; what it
// does not see is a raw `http`/`https` request, and nothing on the `/ask` path
// makes one.

process.env.NEXT_PUBLIC_SENTRY_DSN = "";
process.env.EXTERNAL_DATA_OFFLINE = "true";
