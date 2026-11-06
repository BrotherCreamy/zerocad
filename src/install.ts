// **Install app** in the logo menu (docs/plans/android.md): on Android and in
// desktop Chromium the browser offers to install a site that has a manifest
// and a service worker, and tells the page by `beforeinstallprompt`; the page
// may keep the event and ask with it later, from a control of its own. So the
// menu's Install app is there exactly while a kept event is — hidden once the
// app is installed, and never shown where the event never comes (Firefox,
// Safari, the dev server, a page with no worker). iOS has no event at all: an
// iPhone installs from Safari's Share sheet, Add to Home Screen, and the menu
// says that instead.
//
// The prompt needs the press that asked for it, like a file picker: the item
// types `installApp()` through `submit`, as every menu item does, and that runs
// well inside the browser's few seconds of user activation. An event can be
// prompted once; after a dismissal Chrome may offer another later, and the
// item comes back with it.

/** What the menu shows for installing, if anything. */
export type InstallOffer =
  | { kind: "prompt"; label: string; command: string }
  | { kind: "note"; text: string }
  | null;

export const INSTALL_COMMAND = "installApp()";
export const IOS_NOTE = "To install: Safari's Share, then Add to Home Screen";

/**
 * The menu's offer: Install app while the browser's event is kept; on an
 * iPhone or iPad in Safari, the note; once installed, or where nothing can
 * install, nothing.
 */
export function installOffer(s: { prompt: boolean; installed: boolean; ios: boolean }): InstallOffer {
  if (s.installed) return null;
  if (s.prompt) return { kind: "prompt", label: "Install app", command: INSTALL_COMMAND };
  if (s.ios) return { kind: "note", text: IOS_NOTE };
  return null;
}

/** The part of Chromium's `BeforeInstallPromptEvent` this uses. */
export interface InstallPrompt {
  preventDefault(): void;
  prompt(): Promise<unknown>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform?: string }>;
}

/** The window's part: its events and whether the page is the installed app. */
export interface InstallWindow {
  addEventListener(type: string, listener: (e: Event) => void): void;
  matchMedia?(query: string): { matches: boolean };
  navigator: { standalone?: boolean };
}

/**
 * Keeps the browser's offer and makes it on request. `changed` is told when
 * the menu's offer changes, so an open menu can be drawn again.
 */
export class Installer {
  private kept: InstallPrompt | null = null;
  private done = false;
  private readonly ios: boolean;

  constructor(win: InstallWindow, options: { ios: boolean; changed?: () => void }) {
    this.ios = options.ios;
    // Installed and opened as the app: there is nothing to offer, whatever comes.
    this.done = ["standalone", "fullscreen", "minimal-ui", "window-controls-overlay"]
      .some((m) => win.matchMedia?.(`(display-mode: ${m})`)?.matches) || win.navigator.standalone === true;
    win.addEventListener("beforeinstallprompt", (e) => {
      // Kept, not shown: Chrome's own mini-infobar would offer the same thing
      // over the drawing, unasked.
      e.preventDefault();
      this.kept = e as unknown as InstallPrompt;
      options.changed?.();
    });
    win.addEventListener("appinstalled", () => {
      this.kept = null;
      this.done = true;
      options.changed?.();
    });
  }

  offer(): InstallOffer {
    return installOffer({ prompt: this.kept !== null, installed: this.done, ios: this.ios });
  }

  /** `installApp()`: the browser's own install sheet, or why there is none. Settles with what the person chose. */
  async install(): Promise<string> {
    if (this.done) return "ZeroCAD is installed on this device already";
    const p = this.kept;
    if (!p) {
      return this.ios ? IOS_NOTE.replace(/^To install/, "an iPhone installs from Safari")
        : "this browser has not offered to install ZeroCAD — Chrome and Edge do, from the hosted app, once it has loaded";
    }
    // Once only: an event that has prompted cannot prompt again.
    this.kept = null;
    await p.prompt();
    const choice = await p.userChoice;
    return choice.outcome === "accepted" ? "installing ZeroCAD — it opens from the home screen or the app list"
      : "not installed — Install app comes back to the menu when the browser offers it again";
  }
}
