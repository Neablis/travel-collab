"use client";

import { useState } from "react";

// Closed until asked for, at every width (Mitchell, walking the PR 71 preview:
// "Can we default the assistant to minimized? Its a better experience").
//
// This narrows the handoff (`current/…dc.html:1111-1119`), which had the rail
// as an inline column at wide widths and an overlay below 1180px that starts
// hidden. What changed here first was that a wide viewport no longer opens
// the rail on the reader's behalf: the plan is what someone came for, and
// the assistant is one click away rather than already occupying a column.
// M16 Wave 1 (Task 4, SPEC §9 "the assistant — one panel, three
// presentations") later replaced the overlay half too — the rail is a real
// flex sibling of the plan at every width now, not an overlay below 1180px,
// so there is no overlay-vs-column split left to gate on width at all;
// docked is unconditional.
//
// The media query went with it rather than staying as dead weight. Its only
// job was deciding the default per width, and there is one default now.
// `userChose` went for the same reason — with no automatic opening there is
// no automatic decision left to override.
//
// Home's rail took the same rule from Mitchell's walk of PR 426 (2026-10-12):
// "There should be a way to collapse or hide the assistant and it starts
// closed." So this is the one open state both share, and like the board's it
// is not remembered: every first paint has the rail unmounted, which is what
// lets either caller pick its presentation by a width hook (`AssistantRail`'s
// `presentation` note).
export function useAssistantVisibility() {
  const [open, setOpen] = useState(false);
  return { open, show: () => setOpen(true), hide: () => setOpen(false) };
}
