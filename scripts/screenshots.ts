// The install sheet's pictures (scripts/pwa-shell.ts's SCREENSHOTS;
// docs/plans/android.md): Chrome shows a richer install sheet — on Android
// above all — when the manifest has a description and screenshots. Made from
// the real app with the e2e suite's browser, and committed under
// public/screenshots/ as the icons are, so the deploy needs no browser.
//
// Usage: npm run build:screenshots (the e2e runner's private dev server runs
// this file as a test). Run again when the app's look changes; pwa.test.ts
// checks each PNG is the size the manifest says.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { forgetAutosave, openApp } from "../test/e2e/harness.ts";
import { build, look, scene } from "../test/e2e/scenes.ts";
import { SCREENSHOTS } from "./pwa-shell.ts";

const out = new URL("../public/", import.meta.url);

test("the install sheet's screenshots: a Pixel 7 installed, and a desktop", async () => {
  mkdirSync(new URL("screenshots/", out), { recursive: true });
  for (const shot of SCREENSHOTS) {
    const phone = shot.form_factor === "narrow";
    const app = await openApp(phone ? { device: "Pixel 7" } : { viewport: { width: 1280, height: 800 } });
    try {
      if (phone) {
        // The installed app on a Pixel 7 (test/devices.ts): below its 52 px
        // status bar, over its gesture bar's 24.
        await app.page.setViewportSize({ width: 412, height: 915 - 52 });
        const cdp = await app.page.context().newCDPSession(app.page);
        await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 0, right: 0, bottom: 24, left: 0 } });
        await forgetAutosave(app.page);
        await app.page.reload({ waitUntil: "networkidle" });
        await app.page.waitForFunction(() => document.getElementById("status")?.textContent?.includes("ready"));
      }
      await build(app, scene("stepped-boss").source);
      await look(app, 0.6, 0.9, phone ? 0.3 : 0.34, phone ? [30, 40] : [60, 0]);
      await app.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await app.page.waitForTimeout(3500); // the verdict fades
      const png = await app.page.screenshot({ scale: "device" });
      writeFileSync(new URL(shot.src, out), png);
      const [w, h] = [png.readUInt32BE(16), png.readUInt32BE(20)];
      console.log(`public/${shot.src} — ${w}x${h}`);
      assert.equal(`${w}x${h}`, shot.sizes, `${shot.src}: set its sizes in scripts/pwa-shell.ts to what was made`);
      assert.deepEqual(app.pageErrors, []);
    } finally {
      await app.close();
    }
  }
});
