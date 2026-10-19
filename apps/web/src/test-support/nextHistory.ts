// Next's app router patches `history.replaceState` and `pushState` so a URL
// written natively moves `useSearchParams` and `usePathname` (Next >= 14.1;
// `next/dist/client/components/app-router.js`). A test that mocks
// `next/navigation` holds the URL itself, so it stands in for that patch here.

/**
 * Calls `onUrl` with each URL written through `history.replaceState` or
 * `pushState`, after the real write, as Next's patch does — including its
 * blind spot: a state carrying Next's own `__NA` key is taken for Next's own
 * call and not synced, so a caller passing `window.history.state` is caught
 * here as it would be in the browser. Returns the restore.
 */
export function followHistory(onUrl: (url: string) => void): () => void {
  const { replaceState, pushState } = window.history;
  const follows = (data: unknown) => !(data !== null && typeof data === "object" && "__NA" in data);
  window.history.replaceState = function (data, unused, url) {
    replaceState.call(window.history, data, unused, url);
    if (url != null && follows(data)) onUrl(String(url));
  };
  window.history.pushState = function (data, unused, url) {
    pushState.call(window.history, data, unused, url);
    if (url != null && follows(data)) onUrl(String(url));
  };
  return () => {
    window.history.replaceState = replaceState;
    window.history.pushState = pushState;
  };
}
