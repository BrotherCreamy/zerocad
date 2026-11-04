// "Update ready — tap to reload": a new version, offered rather than imposed.
//
// The service worker never swaps the app under a hand that is drawing
// (scripts/pwa-sw.js): a new deploy installs beside the version in use and
// waits for the next start. The owner found that next start too much to ask
// — close the app from the app switcher, maybe twice — so this notices the
// waiting version and offers it. A tap autosaves the drawing first
// (files.ts), then asks the waiting worker to take over, then reloads once it
// has; the reload restores the drawing from the autosave, so nothing is lost.
// Ignoring the notice changes nothing: the next start still gets the update.
//
// Browser-only and model-free: it knows a service worker registration, a
// button and a function that saves, and nothing about CAD.

/** The message the worker skips its wait for. Must match scripts/pwa-sw.js. */
export const UPDATE_NOW = "zerocad:update-now";

/** How often an app left open asks whether there is a new version: a deploy is minutes, not seconds. */
export const CHECK_EVERY_MS = 30 * 60 * 1000;

export interface UpdateOptions {
  /** The notice: shown (unhidden) when a version is waiting, its click is the consent. */
  button: HTMLButtonElement;
  /** Puts the drawing somewhere the reload will find it (the autosave). */
  flush: () => Promise<void>;
}

/**
 * Watches for a waiting version and wires the notice. Does nothing where
 * there are no service workers (a plain file, the single-file build, a
 * browser without them) — the notice simply never appears.
 */
export function watchForUpdates(o: UpdateOptions): void {
  const sw = typeof navigator !== "undefined" ? navigator.serviceWorker : undefined;
  if (!sw) return;
  let asked = false;

  const offer = (reg: ServiceWorkerRegistration) => {
    // Only a version that would *replace* one: the very first install has
    // nothing to replace, and offering it would reload for no change.
    if (reg.waiting && sw.controller) o.button.hidden = false;
  };

  void sw.ready.then((reg) => {
    offer(reg);
    reg.addEventListener("updatefound", () => {
      const next = reg.installing;
      next?.addEventListener("statechange", () => { if (next.state === "installed") offer(reg); });
    });
    // An app kept open (a phone rarely closes one) still hears of a deploy:
    // when it comes back to the front, and every so often while it is there.
    const check = () => { void reg.update().catch(() => { /* offline: ask again later */ }); };
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") check(); });
    setInterval(check, CHECK_EVERY_MS);

    o.button.addEventListener("click", async () => {
      const waiting = reg.waiting;
      if (!waiting || asked) return;
      asked = true;
      o.button.disabled = true;
      o.button.textContent = "Updating…";
      await o.flush().catch(() => { /* a failed save is said by the autosave itself; the update goes on */ });
      waiting.postMessage(UPDATE_NOW);
    });
  });

  // Reload only for a takeover this page asked for: another window's tap, or
  // the browser's own activation, must not reload a page mid-drawing.
  sw.addEventListener("controllerchange", () => { if (asked) location.reload(); });
}
