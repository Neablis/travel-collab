// The single seam listing every not-yet-functional surface. M9/M11 remove their
// entries as they wire each shell up. A sync test keeps this in lockstep with
// actual <Preview id> usage.
export const PREVIEW_REGISTRY = {
  "home-worth-attention": { milestone: "M9", wiredUpBy: "M9 proactive suggestions" },
  "home-playbooks-strip": { milestone: "M11", wiredUpBy: "M11 Playbooks" },
  "assistant-rail": { milestone: "M9", wiredUpBy: "M9 AI thread" },
  "timeline-ghost": { milestone: "M9", wiredUpBy: "M9 propose→review→approve" },
  "keep-day-flag": { milestone: "M11", wiredUpBy: "M11 keep-a-day" },
  "keep-day-dialog": { milestone: "M11", wiredUpBy: "M11 keep-a-day" },
  "playbooks-route": { milestone: "M11", wiredUpBy: "M11 Playbooks" },
  "insert-playbook": { milestone: "M11", wiredUpBy: "M11 insert-a-Playbook" },
  "share-button": { milestone: "M11", wiredUpBy: "M11 share links" },
  "add-saved-day": { milestone: "M11", wiredUpBy: "M11 add-a-saved-day" },
} as const;

export type PreviewId = keyof typeof PREVIEW_REGISTRY;
export type PreviewMilestone = (typeof PREVIEW_REGISTRY)[PreviewId]["milestone"];
