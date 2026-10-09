// Whether installing Caesura would work in this browser, and how (M39 install
// entry points; Mitchell chose option B on 2026-10-09). Two routes exist:
//
//   - **`prompt`** — Chromium (Android, desktop Chrome, Edge) fires
//     `beforeinstallprompt` once the page meets its install criteria. Holding
//     on to that event, and calling `prompt()` from a click, is the only way a
//     page can ask for the browser's install dialog.
//   - **`ios`** — Safari on an iPhone or iPad never fires it, and has no API at
//     all: the only way is Share → Add to Home Screen, so the route there is a
//     sheet that says so.
//
// Anywhere else — Firefox, desktop Safari, Chrome on iOS, the installed app
// itself — the answer is `null` and nothing offers to install.

/** Chromium's install event; not in the DOM lib because no standard defines it. */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

/** How this browser installs the app, or `null` where it cannot (or already has). */
export type InstallRoute = "prompt" | "ios" | null;

/** The live install state, as `useSyncExternalStore` reads it. */
export type InstallPrompt = {
  route: () => InstallRoute;
  subscribe: (onChange: () => void) => () => void;
  /**
   * Shows the browser's install dialog with the stashed event. `null` when
   * there is no event to show — iOS, or one already spent.
   */
  prompt: () => Promise<"accepted" | "dismissed" | null>;
};

/**
 * Safari on an iPhone, iPod or iPad — an iPad included when it asks for the
 * desktop site, as iPadOS does by default and then reports itself as a Mac;
 * a Mac has no touch points, an iPad has five.
 *
 * Safari only. Chrome, Firefox and Edge on iOS name themselves in the agent
 * (`CriOS`, `FxiOS`, `EdgiOS`), and their Share menus put Add to Home Screen
 * in a different place, so the steps sheet would describe a browser they are
 * not using.
 */
export function isIosSafari(navigator: Pick<Navigator, "userAgent" | "maxTouchPoints">): boolean {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
  return ios && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
}

/**
 * An inline `<head>` script (root layout): holds a `beforeinstallprompt` fired
 * before any of the app's code has run, for `createInstallPrompt` to adopt.
 *
 * No module can listen early enough on its own. The App Router evaluates a
 * client module when React reaches it during hydration, after the document
 * has loaded — and Chromium fires the event once, as soon as the page
 * qualifies, which can be earlier. Measured on a production build, 2026-10-09,
 * before this script existed: the module's listener attached once
 * `document.readyState` was already `complete`, so an event fired at
 * `DOMContentLoaded` — or even at `load` — never reached the menu
 * (`e2e/m39-install-prompt.spec.ts` fires at `DOMContentLoaded` to hold this).
 * The CSP already admits inline scripts (next.config.ts).
 */
export const EARLY_INSTALL_LISTENER =
  'addEventListener("beforeinstallprompt",function(e){e.preventDefault();window.__caesuraInstallEvent=e});';

/**
 * The install state for one window. A factory, so a test can hand it a window
 * of its own; the app holds one, through `installPromptStore()`.
 */
export function createInstallPrompt(win: Window): InstallPrompt {
  // Whatever `EARLY_INSTALL_LISTENER` caught before this ran.
  let deferred: BeforeInstallPromptEvent | null =
    (win as Window & { __caesuraInstallEvent?: BeforeInstallPromptEvent }).__caesuraInstallEvent ?? null;
  let installed = false;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());
  // jsdom does not always ship `matchMedia` (useIsPhone's guard).
  const standaloneQuery = typeof win.matchMedia === "function" ? win.matchMedia("(display-mode: standalone)") : null;
  const ios = isIosSafari(win.navigator);

  win.addEventListener("beforeinstallprompt", (event) => {
    // Without this, Chrome on Android shows its own mini-infobar on top of the
    // page; with it, the event is ours to show from a click.
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    emit();
  });
  win.addEventListener("appinstalled", () => {
    installed = true;
    deferred = null;
    emit();
  });
  standaloneQuery?.addEventListener("change", emit);

  return {
    route() {
      // iOS's home-screen app is not a display-mode match on every version;
      // `navigator.standalone` is the one it has always had.
      const standalone = (win.navigator as Navigator & { standalone?: boolean }).standalone === true;
      if (installed || standalone || standaloneQuery?.matches === true) return null;
      if (deferred !== null) return "prompt";
      return ios ? "ios" : null;
    },
    subscribe(onChange) {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    async prompt() {
      const event = deferred;
      if (event === null) return null;
      // Spent the moment it is shown: a second `prompt()` on the same event
      // throws. Chromium fires a fresh one later if installing is still open.
      deferred = null;
      emit();
      await event.prompt();
      return (await event.userChoice).outcome;
    },
  };
}

let store: InstallPrompt | null = null;

/**
 * The app's one install store, created on first call — `null` on the server.
 * `InstallPromptRegistration` calls it as its module loads; an event fired
 * before that was held by `EARLY_INSTALL_LISTENER`, and is adopted here.
 */
export function installPromptStore(): InstallPrompt | null {
  if (typeof window === "undefined") return null;
  store ??= createInstallPrompt(window);
  return store;
}

// ── The phone nudge's memory ─────────────────────────────────────────────────
//
// Every access is wrapped: Safari's private mode and a blocked-storage setting
// throw on `localStorage` itself, not only on a write. And every failure reads
// as "do not nudge" — a nudge is the one thing here that is fine to lose.

const VISIT_DAYS = "caesura_visit_days";
const NUDGE_DISMISSED = "caesura_install_nudge_dismissed";

type StorageAccess = () => Storage;
const local: StorageAccess = () => window.localStorage;

// A local calendar day: "opened again tomorrow" is the reader's tomorrow.
function dayOf(now: Date): string {
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

function visitDays(storage: StorageAccess): string[] {
  const raw = storage().getItem(VISIT_DAYS);
  if (raw === null) return [];
  const parsed: unknown = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed.filter((d): d is string => typeof d === "string") : [];
}

/**
 * Notes that the app was opened today. Only distinct days count, and only the
 * first two are kept: the nudge asks one question, "has this person come back
 * on another day?", and two days answer it.
 */
export function recordVisit(now: Date = new Date(), storage: StorageAccess = local): void {
  try {
    let days: string[] = [];
    try {
      days = visitDays(storage);
    } catch {
      // A garbled record starts over rather than locking the count.
    }
    const today = dayOf(now);
    if (days.includes(today) || days.length >= 2) return;
    storage().setItem(VISIT_DAYS, JSON.stringify([...days, today]));
  } catch {
    // Refused: this device just never counts as returning.
  }
}

/** Whether the app has been opened on at least two different days on this device. */
export function isReturningVisitor(storage: StorageAccess = local): boolean {
  try {
    return visitDays(storage).length >= 2;
  } catch {
    return false;
  }
}

/** Whether *Not now* was pressed on this device. Unreadable storage counts as yes. */
export function installNudgeDismissed(storage: StorageAccess = local): boolean {
  try {
    return storage().getItem(NUDGE_DISMISSED) !== null;
  } catch {
    return true;
  }
}

/** *Not now*: the nudge never comes back on this device. The menu row stays. */
export function dismissInstallNudge(storage: StorageAccess = local): void {
  try {
    storage().setItem(NUDGE_DISMISSED, "1");
  } catch {
    // The caller hides it for this page anyway. Storage that refuses reads as
    // well reads as dismissed on the next load; one refusing only writes
    // (a full quota) may ask once more.
  }
}
