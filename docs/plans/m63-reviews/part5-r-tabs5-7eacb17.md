# Part 5 review — Poppy and script into the Connect tab list (2ebd34a..7eacb17)

Verdict: approve. No blocker or major. Read-only review; tests not run by the reviewer.

1. Anchors: pass. connect-claude, -chatgpt, -gemini, -poppy, -script are tab panels; connect-mcp stays a standalone section above the tabs. Each tab value equals its anchor suffix. No linker left behind (AiScreen.tsx, ConnectedAppsSection.tsx). Hash handling unchanged.
2. Server HTML and ARIA: pass. Five panels, four hidden; noscript style unchanged; arrow keys from UnderlineTabs unchanged.
3. /ai order: "Try asking" runs MCP, Claude, ChatGPT, Gemini, Poppy, script, matching the tabs. "Ways in" is prose with no connect links; not an ordering problem.
4. Label: GroupLabel and tablist aria-label changed "Your AI assistant" → "Pick your tool" (needs Mitchell's word approval, D17). Other visible change: the two new tabs.
5. Tests are real: unit asserts the tab text array, aria arrays and per-hash selection; e2e asserts aria-selected and in-viewport for both new anchors, and noscript visibility of all five.

Minor: ConnectTabs header comment still says "client tabs". Five tabs at phone width not checked.
