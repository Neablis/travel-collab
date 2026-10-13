import type { RailTab } from "./AssistantRail";

// **Which of the panel's tabs was open last, for the phone tab bar's Ask**
// (Mitchell, preview walk 1 on PR 436: "remember if ask or chat was last open
// and make it sticky"). Only that bar reads it: every other opener names its
// own tab, and saves it here as it opens.
//
// Per device, in `localStorage`, for `useAssistantShape`'s reasons, and every
// access wrapped for the same ones: Safari's private mode throws, and a full
// origin refuses a write.
const KEY = "assistant:tab";

/**
 * The tab last open on this device. Ask when none is stored or storage cannot
 * be read, which is where the bar opened before it remembered anything.
 */
export function readLastRailTab(): RailTab {
  try {
    return window.localStorage.getItem(KEY) === "chat" ? "chat" : "ask";
  } catch {
    return "ask";
  }
}

/** Saves `tab` as the one last open, for `readLastRailTab`. */
export function rememberRailTab(tab: RailTab): void {
  try {
    window.localStorage.setItem(KEY, tab);
  } catch {
    // The tab still opens; it is only not remembered.
  }
}
