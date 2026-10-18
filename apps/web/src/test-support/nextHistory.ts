// Next's app router patches `history.replaceState` and `pushState` so a URL
// written natively moves `useSearchParams` and `usePathname` (Next >= 14.1;
// `next/dist/client/components/app-router.js`). A test that mocks
// `next/navigation` holds the URL itself, so it stands in for that patch here.

/**
 * Calls `onUrl` with each URL written through `history.replaceState` or
 * `pushState`, after the real write, as Next's patch does. Returns the restore.
 */
export function followHistory(onUrl: (url: string) => void): () => void {
  const { replaceState, pushState } = window.history;
  window.history.replaceState = function (data, unused, url) {
    replaceState.call(window.history, data, unused, url);
    if (url != null) onUrl(String(url));
  };
  window.history.pushState = function (data, unused, url) {
    pushState.call(window.history, data, unused, url);
    if (url != null) onUrl(String(url));
  };
  return () => {
    window.history.replaceState = replaceState;
    window.history.pushState = pushState;
  };
}
