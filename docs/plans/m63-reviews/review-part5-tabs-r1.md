# PR 788 review of 126964a..8052cbf (external-review fixes + tabs) — changes requested

1. **MAJOR** `ConnectTabs.tsx:41-43`: hash scroll can race the tab switch. `setSelected` in a passive effect, `scrollIntoView` in a `requestAnimationFrame`; if the frame fires before React commits, the target panel is still `hidden` and the scroll does nothing (`#connect-chatgpt` from `/ai`, `/llms.txt`, `/agents.md`). No test covers hashchange or scroll. Fix: scroll in an effect keyed on `selected` (after commit), or `flushSync`/`useLayoutEffect`. Add an e2e (JS on) that loads `/developers#connect-chatgpt` and asserts the section is visible and in the viewport.
2. **MINOR** `ConnectTabs.tsx:55-58`: all three panels render until hydration, then two collapse: layout shift and a flash for every JS visitor. `useSyncExternalStore` is correct (no mismatch). Fix if cheap: render non-default panels `hidden` from the server and un-hide them for JS-off readers with a `<noscript><style>` rule, keeping all text in the HTML.
3. **MINOR** `ConnectTabs.tsx:36-47`: clicking a link to the hash already in the URL, after switching tabs, fires no `hashchange`, so nothing happens. Fix: also handle clicks on in-page `#connect-*` links (or listen for click on anchors targeting a panel id).
4. **MINOR** `AiScreen.test.tsx:20-22`: the `[copy]`/`live` skip is sound (`proxy.ts:195-206` rewrites `/playbooks/*`) but matches by name anywhere under `app/`. Scope it to `app/playbooks`.
5. **MINOR** `seo.spec.ts` og loop: fetches only the first `og:image` and strips the origin, so it never shows the URL is absolute. Fix: assert every `og:image` is an absolute URL on the site origin, then fetch each.

Clean: external-review fix-now items true to code; `/ai` title 56 chars, no em dashes, keywords natural; ARIA from `ui/underline-tabs`; ids distinct; JS-off server HTML has every panel; client boundary clean.
Not checked: screenshots, a real browser, `pnpm arch`, the e2e lane, proxy matcher for `/og/*`.
