// Install app (docs/plans/android.md): the browser's `beforeinstallprompt`
// kept and made from the logo menu; hidden once installed and where the event
// never comes; iOS's Add to Home Screen note instead.

import { test } from "node:test";
import assert from "node:assert/strict";
import { INSTALL_COMMAND, IOS_NOTE, Installer, installOffer, type InstallWindow } from "../src/install.ts";

/** A window: its events, and a display mode. */
function windowWith(mode = "browser"): InstallWindow & EventTarget {
  const w = new EventTarget() as InstallWindow & EventTarget;
  w.matchMedia = (q: string) => ({ matches: q === `(display-mode: ${mode})` });
  w.navigator = {};
  return w;
}

/** Chromium's event, as a test makes it: prompted once, answered `outcome`. */
function promptEvent(outcome: "accepted" | "dismissed") {
  const e = new Event("beforeinstallprompt", { cancelable: true }) as Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }>; prompted: number };
  e.prompted = 0;
  e.prompt = async () => { e.prompted++; };
  e.userChoice = Promise.resolve({ outcome });
  return e;
}

test("the offer: Install app while the browser offers, the iPhone's note where it never will, nothing once installed", () => {
  assert.deepEqual(installOffer({ prompt: true, installed: false, ios: false }), { kind: "prompt", label: "Install app", command: INSTALL_COMMAND });
  assert.deepEqual(installOffer({ prompt: false, installed: false, ios: true }), { kind: "note", text: IOS_NOTE });
  assert.equal(installOffer({ prompt: false, installed: false, ios: false }), null, "Firefox, the dev server: nothing to offer");
  assert.equal(installOffer({ prompt: true, installed: true, ios: false }), null);
  assert.equal(installOffer({ prompt: false, installed: true, ios: true }), null, "an iPhone's home-screen app says nothing either");
});

test("the event is kept (Chrome's own infobar suppressed), prompted from installApp() once, and the item goes and comes back", async () => {
  const w = windowWith();
  let changes = 0;
  const inst = new Installer(w, { ios: false, changed: () => changes++ });
  assert.equal(inst.offer(), null, "until the browser offers");
  assert.match(await inst.install(), /has not offered/);
  const e = promptEvent("dismissed");
  w.dispatchEvent(e);
  assert.equal(e.defaultPrevented, true, "kept, not shown by the browser");
  assert.equal(changes, 1);
  assert.equal(inst.offer()?.kind, "prompt");
  assert.match(await inst.install(), /not installed/);
  assert.equal(e.prompted, 1);
  assert.equal(inst.offer(), null, "an event prompts once");
  // Offered again later, accepted, and installed: gone for good.
  const again = promptEvent("accepted");
  w.dispatchEvent(again);
  assert.match(await inst.install(), /^installing/);
  w.dispatchEvent(new Event("appinstalled"));
  assert.equal(inst.offer(), null);
  w.dispatchEvent(promptEvent("accepted"));
  assert.equal(inst.offer(), null, "installed: whatever comes, nothing to offer");
  assert.match(await inst.install(), /installed on this device already/);
});

test("opened as the installed app — standalone, or iOS's home-screen flag — there is nothing to offer", () => {
  assert.equal(new Installer(windowWith("standalone"), { ios: false }).offer(), null);
  const homeScreen = windowWith();
  homeScreen.navigator = { standalone: true };
  assert.equal(new Installer(homeScreen, { ios: true }).offer(), null);
  assert.equal(new Installer(windowWith(), { ios: true }).offer()?.kind, "note");
});
