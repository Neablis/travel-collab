### KI-17 — Sheets and dialogs render underneath the assistant rail — RESOLVED
- **Severity:** correctness (more than half of the most-used form is unreachable)
- **Area:** `apps/web/src/components/ui/sheet.tsx:29-30`, `apps/web/src/components/ui/dialog.tsx:11-12`
- **Symptom:** with the rail open at 1280px, the Add-stop / edit-activity sheet is covered on its right ~356px, including its title and its Close button. Measured: `[role="dialog"]` spans x 640-1280 with `z-index: auto`; `aside[aria-label="Assistant"]` spans x 924-1280 with `z-index: 50`.
- **Why it happens:** neither primitive set **any** z-index, so Radix's portalled content stacked purely by DOM order and lost to a fixed `z-50` sibling rendered outside the portal.
- **Fix (2026-08-14, `d473cb2`):** a named `.overlay-layer { z-index: 60; }` class in `globals.css` (Tailwind's scale stops at 50 and the color wall bans `z-[60]`, so this couldn't be a utility class), applied to both `sheet.tsx` and `dialog.tsx`'s portalled content. Every dialog/sheet/popover surface now sits above the rail.
- **First noted:** 2026-08-14 (external design review of PR #23). **Resolved:** 2026-08-14 (M10 Wave 2, Phase 0, Task 0.2).
