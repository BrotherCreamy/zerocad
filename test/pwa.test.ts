// The hosted build's shell (docs/plans/pwa-pages.md), checked without building
// anything: the manifest, the icons it names, the service worker's cache and
// what it does on install, activate and fetch, the document head, and the
// page-lock listeners. The e2e suite (test/e2e/pwa.e2e.ts) runs the real
// build from a sub-path in a browser; this is the part that needs none.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import {
  APPLE_TOUCH_ICON, BACKGROUND, CACHE_PREFIX, ICONS, ICON_SVG, THEME,
  cacheName, manifest, pwaDocument, pwaHead, rasters, serviceWorker, shellFiles,
} from "../scripts/pwa-shell.ts";
import { GESTURE_EVENTS, lockPage } from "../src/pagelock.ts";
import { FILE_SUFFIX } from "../src/files.ts";

const publicFile = (src: string) => new URL(`../public/${src}`, import.meta.url);

/** A URL that resolves inside whatever folder the file naming it is served from. */
function isRelative(url: string): boolean {
  return !/^[a-z][a-z0-9+.-]*:/i.test(url) && !url.startsWith("/");
}

/** A PNG's width and height, from its IHDR chunk. */
function pngSize(bytes: Buffer): [number, number] {
  assert.equal(bytes.subarray(1, 4).toString("latin1"), "PNG", "a PNG");
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

/**
 * The alpha of a PNG's top-left pixel. Whatever filter the first row was
 * written with, its first pixel is stored raw (every filter predicts it from
 * zeros), so the inflated data's bytes after the filter byte are the pixel.
 */
function cornerAlpha(bytes: Buffer): number {
  const colourType = bytes[25];
  const idat: Buffer[] = [];
  for (let at = 8; at < bytes.length;) {
    const len = bytes.readUInt32BE(at);
    if (bytes.subarray(at + 4, at + 8).toString("latin1") === "IDAT") idat.push(bytes.subarray(at + 8, at + 8 + len));
    at += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  if (colourType === 6) return raw[4];
  if (colourType === 2) return 255;
  throw new Error(`a PNG of colour type ${colourType}, which this reader does not know`);
}

test("the manifest: standalone, any orientation, the app's colours, and every URL relative so it works under /zerocad/", () => {
  const m = manifest();
  assert.equal(m.name, "ZeroCAD");
  assert.equal(typeof m.short_name, "string");
  assert.ok((m.short_name as string).length <= 12, "a short name fits under a home-screen icon");
  assert.equal(m.display, "standalone");
  assert.equal(m.orientation, "any");
  assert.equal(m.start_url, "./");
  assert.equal(m.scope, "./");
  assert.equal(m.id, "./");
  assert.equal(m.background_color, BACKGROUND);
  assert.equal(m.theme_color, THEME);
  // The colours are the app's own: the body's ground and the panels'.
  const index = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(index, new RegExp(`html,body\\{[^}]*background:${BACKGROUND}`));
  assert.match(index, new RegExp(`\\.panel\\{[^}]*background:${THEME}`));
  const urls = [m.start_url, m.scope, m.id, ...(m.icons as { src: string }[]).map((i) => i.src)] as string[];
  for (const url of urls) assert.ok(isRelative(url), `${url} is relative`);
  // JSON round trip: what is written is what was checked.
  assert.deepEqual(JSON.parse(JSON.stringify(m)), m);
});

test("the manifest offers the installed desktop app for drawings: .json, application/json, opened at the app itself", () => {
  const m = manifest();
  assert.deepEqual(m.file_handlers, [{ action: "./", accept: { "application/json": [".json"] } }]);
  const [handler] = m.file_handlers as { action: string }[];
  assert.ok(isRelative(handler.action), "inside the scope under /zerocad/");
  // The extension it claims is the one every file this app writes ends in.
  assert.ok(FILE_SUFFIX.endsWith(".json"));
});

test("every icon the manifest and the head name is committed, a PNG of the size it claims", () => {
  const purposes = ICONS.map((i) => `${i.sizes} ${i.purpose}`);
  assert.deepEqual(purposes.sort(), ["192x192 any", "512x512 any", "512x512 maskable"]);
  for (const icon of ICONS) {
    assert.equal(icon.type, "image/png");
    const [w, h] = pngSize(readFileSync(publicFile(icon.src)));
    assert.equal(`${w}x${h}`, icon.sizes, icon.src);
  }
  // iOS takes a PNG, 180 square, and none of the manifest's.
  assert.deepEqual(pngSize(readFileSync(publicFile(APPLE_TOUCH_ICON.src))), [180, 180]);
  assert.match(readFileSync(publicFile(ICON_SVG), "utf8"), /^<svg /);
  // A full-bleed raster has no transparent corner (iOS would fill it black,
  // a launcher's mask would show it); a rounded one has nothing there.
  for (const r of rasters()) {
    const alpha = cornerAlpha(readFileSync(publicFile(r.src)));
    assert.equal(alpha, r.rounded ? 0 : 255, `${r.src}'s corner`);
  }
});

test("the cache is named for the build stamp: a new stamp, a new cache; the same stamp, the same one", () => {
  const a = cacheName("1a2b3c4 · 2026-11-04");
  assert.equal(a, "zerocad-1a2b3c4-2026-11-04");
  assert.equal(cacheName("1a2b3c4 · 2026-11-04"), a);
  assert.notEqual(cacheName("5d6e7f8 · 2026-11-04"), a);
  assert.notEqual(cacheName("1a2b3c4 · 2026-11-05"), a);
  assert.ok(a.startsWith(CACHE_PREFIX));
  assert.throws(() => cacheName("  "), /stamp/);
  // The worker's source differs between two builds in its cache's name and
  // nowhere else, so the browser sees a new worker exactly when the stamp moved.
  const [one, two] = [serviceWorker("abc · 2026-11-04"), serviceWorker("def · 2026-11-04")];
  assert.notEqual(one, two);
  assert.equal(one.replace("zerocad-abc-2026-11-04", "X"), two.replace("zerocad-def-2026-11-04", "X"));
  assert.doesNotMatch(one, /__NEOCAD_/);
});

/**
 * The worker run against a stand-in for its global scope: what it registers,
 * what it opens and deletes, and what it answers a fetch with.
 */
async function runWorker(stamp: string, existing: string[]) {
  const listeners = new Map<string, (e: unknown) => void>();
  const opened: string[] = [];
  const deleted: string[] = [];
  const added: string[] = [];
  const stored = new Map<string, string>([["https://example.test/zerocad/", "the app"]]);
  const cache = {
    addAll: async (reqs: { url: string; cache: string }[]) => {
      for (const r of reqs) assert.equal(r.cache, "reload", "past the HTTP cache");
      added.push(...reqs.map((r) => r.url));
    },
    match: async (req: { url: string } | string) => {
      const url = typeof req === "string" ? new URL(req, "https://example.test/zerocad/sw.js").href : req.url.split("?")[0];
      return stored.get(url);
    },
  };
  const self = {
    location: new URL("https://example.test/zerocad/sw.js"),
    addEventListener: (type: string, fn: (e: unknown) => void) => listeners.set(type, fn),
    skipWaiting: () => assert.fail("a new version never takes over the open app"),
    clients: { claim: () => assert.fail("a new version never takes over the open app") },
  };
  const caches = {
    open: async (name: string) => { opened.push(name); return cache; },
    keys: async () => existing,
    delete: async (name: string) => { deleted.push(name); return true; },
  };
  class FakeRequest {
    url: string;
    cache: string;
    constructor(path: string, init: { cache: string }) {
      this.url = new URL(path, self.location).href;
      this.cache = init.cache;
    }
  }
  const fetched: string[] = [];
  const fetch = async (req: { url: string }) => { fetched.push(req.url); return "from the network"; };
  new Function("self", "caches", "Request", "fetch", serviceWorker(stamp))(self, caches, FakeRequest, fetch);

  const waits: Promise<unknown>[] = [];
  const fire = async (type: string, extra: object = {}) => {
    let answer: Promise<unknown> | undefined;
    listeners.get(type)!({ ...extra, waitUntil: (p: Promise<unknown>) => waits.push(p), respondWith: (p: Promise<unknown>) => { answer = p; } });
    await Promise.all(waits);
    return answer;
  };
  return { listeners, opened, deleted, added, fetched, fire };
}

test("the worker: install fills the stamp's cache with the shell, activate deletes only this app's older caches", async () => {
  const w = await runWorker("abc · 2026-11-04", ["neocad-old-build", "zerocad-old-build", "zerocad-abc-2026-11-04", "another-site-v3"]);
  assert.deepEqual([...w.listeners.keys()].sort(), ["activate", "fetch", "install"]);
  await w.fire("install");
  assert.deepEqual(w.opened, ["zerocad-abc-2026-11-04"]);
  assert.deepEqual(w.added, shellFiles().map((p) => new URL(p, "https://example.test/zerocad/sw.js").href));
  assert.ok(w.added.includes("https://example.test/zerocad/"), "the app itself, at the address it is started from");
  await w.fire("activate");
  assert.deepEqual(w.deleted.sort(), ["neocad-old-build", "zerocad-old-build"], "its own old caches, under the old name too, and no other site's");
});

test("the worker: cache first, a navigation anywhere in scope is the app, and what is not cached goes to the network", async () => {
  const w = await runWorker("abc", []);
  const get = (url: string, mode = "no-cors") => w.fire("fetch", { request: { url, method: "GET", mode } });
  assert.equal(await get("https://example.test/zerocad/"), "the app");
  assert.equal(await get("https://example.test/zerocad/?source=homescreen", "navigate"), "the app");
  assert.equal(await get("https://example.test/zerocad/index.html", "navigate"), "the app");
  assert.deepEqual(w.fetched, []);
  assert.equal(await get("https://example.test/zerocad/elsewhere.png"), "from the network");
  // Another origin, or anything but a GET, is not the worker's business.
  assert.equal(await get("https://elsewhere.test/x"), undefined);
  assert.equal(await w.fire("fetch", { request: { url: "https://example.test/zerocad/", method: "POST", mode: "cors" } }), undefined);
});

test("the head: the iOS metas, the manifest and the icons, all relative, and the worker registered from here only", () => {
  const head = pwaHead();
  for (const needle of [
    '<meta name="apple-mobile-web-app-capable" content="yes">',
    '<meta name="mobile-web-app-capable" content="yes">',
    '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
    '<meta name="apple-mobile-web-app-title" content="ZeroCAD">',
    `<meta name="theme-color" content="${THEME}">`,
    '<link rel="manifest" href="manifest.webmanifest">',
    `<link rel="apple-touch-icon" sizes="180x180" href="${APPLE_TOUCH_ICON.src}">`,
  ]) assert.ok(head.includes(needle), needle);
  for (const [, url] of head.matchAll(/(?:href|register\()="?([^")]+)"?/g)) assert.ok(isRelative(url), `${url} is relative`);
  assert.match(head, /serviceWorker\.register\("\.\/sw\.js"\)/);
  assert.doesNotMatch(readFileSync(new URL("../index.html", import.meta.url), "utf8"), /serviceWorker/,
    "the dev server and the artifact never register a worker");

  const doc = pwaDocument({ title: "NeoCAD", metas: '<meta name="viewport" content="x">', style: "body{}", body: "<div id=app></div>" });
  assert.match(doc, /^<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport"/);
  assert.ok(doc.indexOf(head) < doc.indexOf("</head>") && doc.indexOf("<div id=app>") > doc.indexOf("<body>"));
});

test("index.html: a viewport that never zooms and covers the notch, a page that never scrolls, and the callout off but the command line and log selectable", () => {
  const index = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(index, /<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">/);
  const css = index.match(/<style>([\s\S]*?)<\/style>/)![1];
  assert.match(css, /html,body\{[^}]*position:fixed;inset:0;overflow:hidden;overscroll-behavior:none/);
  // The window by its four edges, not 100dvh — which an iOS home-screen app
  // reads as the screen less the status bar (docs/plans/chrome-logo-scale.md).
  assert.match(css, /#app\{position:fixed;inset:0\}/);
  assert.doesNotMatch(css, /height:100d?vh/);
  // The insets are read through the probe, and the panels pad by them.
  for (const side of ["top", "right", "bottom", "left"]) assert.match(css, new RegExp(`env\\(safe-area-inset-${side}\\)`));
  assert.match(css, /#cv\{[^}]*touch-action:none/);
  assert.match(css, /body\{[^}]*touch-action:manipulation/);
  assert.match(css, /-webkit-touch-callout:none/);
  assert.match(css, /#cmd,#log,input\{[^}]*-webkit-user-select:text;user-select:text;-webkit-touch-callout:default/);
});

test("the page lock: WebKit's pinch events and a multi-finger touchmove are cancelled at the document, non-passive; one finger is left alone", () => {
  const registered = new Map<string, { fn: (e: Event) => void; passive?: boolean }>();
  lockPage({ addEventListener: (type, fn, opts) => registered.set(type, { fn, passive: opts.passive }) });
  assert.deepEqual([...registered.keys()].sort(), [...GESTURE_EVENTS, "touchmove"].sort());
  for (const { passive } of registered.values()) assert.equal(passive, false, "a passive listener cannot cancel");
  const event = (touches: number) => {
    let cancelled = false;
    return { e: { touches: { length: touches }, preventDefault: () => { cancelled = true; } } as unknown as Event, cancelled: () => cancelled };
  };
  for (const type of GESTURE_EVENTS) {
    const ev = event(2);
    registered.get(type)!.fn(ev.e);
    assert.ok(ev.cancelled(), type);
  }
  const two = event(2);
  registered.get("touchmove")!.fn(two.e);
  assert.ok(two.cancelled(), "two fingers: cancelled");
  const one = event(1);
  registered.get("touchmove")!.fn(one.e);
  assert.ok(!one.cancelled(), "one finger: the log still scrolls");
});
