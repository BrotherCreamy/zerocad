// Browser entry point: the kernel, the model, the tool engine and the REPL
// wired to a canvas, with the chrome — toolbar, log, command line — floating
// over it as panels (see panels.ts). The command line is the real thing —
// a scoped evaluator over the command surface in replenv.ts — rather than
// the tool-name-only stand-in it replaced. A bare tool name still arms that
// tool, because that shortcut is genuinely the most common entry and reads
// better than arm("rectangle"); anything else is evaluated.

import { ensureKernelLoaded } from "./kernel/problem.ts";
import { Model } from "./model.ts";
import { open as openModelText, save as saveModel, savedTools } from "./persist.ts";
import { carryIntoSession, toolSources } from "./toolsource.ts";
import { UndoStack } from "./undo.ts";
import { historyChord } from "./historykeys.ts";
import { Autosave, fileChord } from "./files.ts";
import { Files, indexedDbStore } from "./filehost.ts";
import { watchForUpdates } from "./update.ts";
import { Repl, fmt } from "./repl.ts";
import { neocadScope } from "./replenv.ts";
import { ToolEngine, type View } from "./tools/engine.ts";
import { SELECTION } from "./tools/selection.ts";
import { runSteps } from "./tools/feature.ts";
import type { FeatureStep } from "./tools/tool.ts";
import { previewSteps } from "./featurepreview.ts";
import { describePick, type Pick } from "./picking.ts";
import { ContextMenu, menuFor } from "./menu.ts";
import { toolUnavailable } from "./toolavail.ts";
import { frameArmPx, frameMarker } from "./framemarker.ts";
import { constrainedBy, type Glyph } from "./glyphs.ts";
import { getToolCtor, listTools } from "./tools/tool.ts";
import {
  ACTIONS, ActionStrip, FINE, OptionsPanel, Panels, Toolbar, browserStorage, defaultLayout, logoBox, scaledMetrics, touchMetrics,
  type Insets, type Metrics, type Size,
} from "./panels.ts";
import {
  clampScale, deviceScale, formFactor, formatScale, recallScale, rememberScale, textFactor, type Device,
} from "./uiscale.ts";
import { GUIDE_NOTE_MS, STEP_NOTE_MS, StatusLine } from "./statusline.ts";
import { AppMenu, UNTITLED } from "./appmenu.ts";
import { logoSvg } from "./logo.ts";
import { OptionMemory, declaredOptions, unitSymbol, type OptionValue } from "./tools/options.ts";
import { toolIcon } from "./tools/icons.ts";
import { depth, uiOf } from "./view.ts";
import { arcSamples, arcSegments } from "./arcgeom.ts";
import { curveFrame } from "./curveplane.ts";
import { createFaceLayer, paintFaces } from "./facelayer.ts";
import { SOLID_EDGE, visibleFaces } from "./faces.ts";
import { hiddenInk, inSight, inkRuns, occlusion, type Occlusion } from "./occlusion.ts";
import { VIEW_MODES, drawsFaces, isViewMode, opaque, recallViewMode, rememberViewMode, viewModeError, type ViewMode } from "./viewmode.ts";
import { entityDrawn, glyphDrawn, quietEntities, revealed, solidEdges } from "./quiet.ts";
import { frameBasis } from "./relations/refs.ts";
import { lockPage } from "./pagelock.ts";
import type { Entity } from "./model.ts";
import "./tools/point.ts";
import "./tools/line.ts";
import "./tools/rectangle.ts";
import "./tools/circle.ts";
import "./tools/circle3.ts";
import "./tools/arc.ts";
import "./tools/arc3.ts";
import "./tools/fillet.ts";
import "./tools/extrude.ts";
import "./tools/revolve.ts";
import "./tools/sketch.ts";
import "./tools/edit.ts";

/**
 * The status beside the logo — the verdict and the step note — and the rules
 * for when each fades (statusline.ts). The element ids are what they were in
 * the header: `#status`, `#stepnote`.
 */
const statusLine = new StatusLine(document.getElementById("status")!, document.getElementById("stepnote")!);
const logEl = document.getElementById("log")!;
const cv = document.getElementById("cv") as HTMLCanvasElement;
const g = cv.getContext("2d")!;
const facesCanvas = document.getElementById("faces") as HTMLCanvasElement;
/**
 * How a solid's faces are drawn, chosen once and here only: by a depth buffer
 * on their own canvas under the drawing, or — where the browser has no WebGL —
 * by the painter's, into the drawing's own canvas before everything else.
 */
const faceLayer = createFaceLayer(facesCanvas);
const cmdEl = document.getElementById("cmd") as HTMLInputElement;
const hoverEl = document.getElementById("hovertag")!;
const menuEl = document.getElementById("ctxmenu")!;
const toolbarEl = document.getElementById("toolbar")!;
const optionsPanelEl = document.querySelector<HTMLElement>('.panel[data-panel="options"]')!;
const optionsEl = document.getElementById("options")!;

/**
 * **Whether the chrome is a finger's** (docs/plans/touch.md): the primary
 * pointer is coarse — a phone, a tablet. Read once, from the media query the
 * stylesheet sizes its targets by, so the panels' arithmetic and the CSS they
 * are drawn with cannot disagree. It sets sizes and defaults only: what a
 * pointer *does* is decided per event, by its `pointerType` (tools/engine.ts),
 * so a mouse plugged into a tablet is still a mouse.
 */
const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

/**
 * What the page can tell about the device (uiscale.ts's `Device`): the
 * pointer, the screen's short side, and the text size its person chose — iOS's
 * Dynamic Type through `font: -apple-system-body` where Safari has it, else the
 * browser's default font size, read off `font-size: medium` (the root's own
 * size is the stylesheet's 13 px, not the person's). Measured once, at load: a
 * changed text size is picked up by the next start.
 */
function measureDevice(): Device {
  const probe = document.createElement("span");
  probe.style.cssText = "position:absolute;visibility:hidden;font-size:medium";
  document.body.appendChild(probe);
  const defaultFont = parseFloat(getComputedStyle(probe).fontSize) || 16;
  let appleBody: number | null = null;
  // Feature-detected rather than sniffed: where the keyword is not a font,
  // the declaration is dropped and the probe would read back `medium`.
  if (typeof CSS !== "undefined" && CSS.supports?.("font", "-apple-system-body")) {
    probe.style.font = "-apple-system-body";
    appleBody = parseFloat(getComputedStyle(probe).fontSize) || null;
  }
  probe.remove();
  const shortSide = Math.min(screen.width, screen.height) || Math.min(innerWidth, innerHeight);
  return { coarse, shortSide, appleBody, defaultFont };
}
const device = measureDevice();

/**
 * **The interface size** — the one factor everything drawn for a person to
 * read is multiplied by (uiscale.ts): **this device's 100 %**, worked out from
 * `device` (1 under a mouse; 1.3 on a phone under a finger, 1.15 on a tablet;
 * times the person's text size), **times the viewer's multiplier**, the spin
 * box's `− 100% +`, which is all that is stored. Handed from here to
 * everything that draws: the panels' metrics, the stylesheet's custom
 * properties, the logo, and the view (`view.ui`), which the glyphs, labels,
 * points, frame markers and snap marker are drawn from. Set by
 * `ui({ scale })` alone, through `setScale`.
 */
const deviceUi = deviceScale(device);
let uiScale = recallScale(browserStorage()) ?? 1;
const drawnScale = () => Math.round(deviceUi * uiScale * 1000) / 1000;
const metricsAt = (k: number): Metrics => (coarse ? touchMetrics(k) : scaledMetrics(FINE, k));
let metrics: Metrics = metricsAt(drawnScale());

const logoEl = document.getElementById("logo")!;
const cornerEl = document.getElementById("corner")!;
const probeEl = document.getElementById("safeprobe")!;

/**
 * The safe-area insets, read off a probe whose padding is the four
 * `env(safe-area-inset-*)` — the one way script can read them.
 */
function insets(): Insets {
  const c = getComputedStyle(probeEl);
  const px = (v: string) => parseFloat(v) || 0;
  return { top: px(c.paddingTop), right: px(c.paddingRight), bottom: px(c.paddingBottom), left: px(c.paddingLeft) };
}

/**
 * The chrome's sizes into the page: the stylesheet's custom properties (the
 * panels' numbers exactly, and the factor for everything else), the logo at
 * its size, and the status beside it.
 */
function applyChrome(): void {
  const root = document.documentElement.style;
  root.setProperty("--ui", String(metrics.scale));
  root.setProperty("--gap", `${metrics.gap}px`);
  root.setProperty("--title", `${metrics.title}px`);
  root.setProperty("--button", `${metrics.button}px`);
  root.setProperty("--icon", `${metrics.icon}px`);
  root.setProperty("--grip", `${metrics.grip}px`);
  root.setProperty("--orow", `${metrics.optionRow}px`);
  logoEl.innerHTML = logoSvg(metrics.logo);
  placeCorner();
}

/** The status, just right of the logo, in the logo's row. */
function placeCorner(): void {
  const i = insets();
  const box = logoBox(metrics);
  cornerEl.style.left = `${i.left + box.w}px`;
  cornerEl.style.top = `${i.top}px`;
  cornerEl.style.minHeight = `${box.h}px`;
  cornerEl.style.maxWidth = `calc(100% - ${i.left + i.right + box.w + 8}px)`;
}
applyChrome();

/**
 * The action strip — Undo, Redo, Delete, Cancel — is a finger's Ctrl+Z, Ctrl+Y,
 * Delete and Escape. A mouse has the keys and the menu's Undo/Redo, so the
 * strip is taken out of the page before the panels are placed, rather than
 * shown to a desktop that would only have to make room for it.
 */
const actionsPanelEl = document.querySelector<HTMLElement>('.panel[data-panel="actions"]');
if (!coarse) actionsPanelEl?.remove();
const actionsEl = coarse ? document.getElementById("actions") : null;

/** What `ui()` says when it is given something it does not take. */
const UI_USAGE = 'ui() takes { scale: 0.8 } (0.6 to 1.6, or "default"), { hide: "log" } or { show: "log" } (a pane or a list of them); ui() says what is in force';

/**
 * The options panel's size, once there is an options panel to ask — it is
 * built with the tool engine, after the kernel loads, and until then nothing is
 * armed, so there is nothing to show.
 */
let optionsShown: () => Size | null = () => null;

/**
 * The viewer's last value of every tool option, over the same storage as their
 * layout but under its own key (tools/options.ts). Made here, once, and handed
 * to both the engine that arms from it and the command scope that lists it.
 */
const optionMemory = new OptionMemory(browserStorage());

/**
 * What the last press anywhere was made with — `"mouse"`, `"pen"` or
 * `"touch"` — for the one decision that happens after the press has been
 * handled: whether a name a click put in the command line also focuses it
 * (see `insertName`). Captured on `window` so a press that something else
 * swallows is still counted.
 */
let lastPointer = "mouse";
window.addEventListener("pointerdown", (e) => { lastPointer = e.pointerType; }, true);

/**
 * How solids are shown — opaque, see-through or not at all (viewmode.ts). The
 * viewer's, like the layout: read from this browser's storage once, written
 * back on every change, and never journalled, saved or undone.
 */
let viewMode: ViewMode = recallViewMode(browserStorage());

/**
 * The panels are placed before the kernel loads, so the page never shows the
 * chrome in a heap while the WASM downloads. The toolbar is the one tray: always
 * one line of however many tools are registered *when it is asked* — the
 * built-ins are all registered by the imports above, and one defined later at
 * the command line lengthens it, moved or not, through `syncToolbar` below. It
 * turns between column and row against the edges it is dragged to, and has no
 * grips. The options panel is the one that comes and goes: shown, sized by its
 * rows, while a tool that declares options is armed, beside the toolbar unless
 * the viewer has put it somewhere.
 *
 * Under the dev server — which is what every e2e run drives — the panels check
 * after each placement that no two overlap and report it on the page if they
 * do, so the e2e suite's "no uncaught page errors" covers every gesture it
 * makes, not only the ones a test measures. A built page does not pay for it.
 */
const panels = new Panels(
  document.getElementById("viewwrap")!,
  (area) => defaultLayout(area, listTools().length, metrics),
  browserStorage(),
  { toolbar: () => listTools().length, ...(actionsEl ? { actions: () => ACTIONS.length } : {}) },
  {
    check: Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV),
    fitted: { options: { size: () => optionsShown(), beside: "toolbar" } },
    metrics,
    // The logo is a panel nothing moves: what is pushed into the corner stops
    // against it, and the way into the app menu is never under anything.
    fixed: { logo: { el: logoEl, size: () => logoBox(metrics) } },
    insets,
  },
);
// The insets change without the window resizing — a rotation does both, but
// an emulator's override, or iOS settling its bars, may do only this. The
// probe's border box is its padding, so it is what changes.
new ResizeObserver(() => { placeCorner(); panels.apply(); }).observe(probeEl, { box: "border-box" });

function log(msg: string, cls?: string) {
  const d = document.createElement("div");
  d.textContent = msg;
  if (cls) d.className = cls;
  logEl.appendChild(d);
  logEl.scrollTop = logEl.scrollHeight;
}

function sizeCanvas() {
  const dpr = devicePixelRatio || 1;
  const r = cv.getBoundingClientRect();
  cv.width = Math.max(1, Math.round(r.width * dpr));
  cv.height = Math.max(1, Math.round(r.height * dpr));
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  // The faces' canvas is the drawing's twin, pixel for pixel, or the two
  // pictures drift apart by a fraction of a pixel at every edge.
  facesCanvas.style.width = `${r.width}px`;
  facesCanvas.style.height = `${r.height}px`;
  facesCanvas.width = cv.width;
  facesCanvas.height = cv.height;
}

/**
 * The dimension the app's model has. Every door a model comes in by — a new
 * one, an opened file, an undo — goes through this, so a 2D file opened here
 * is lifted into 3D (see persist.ts) rather than swapping the app into 2D.
 */
const APP_DIM = 3;

/**
 * What `submit` settles with for an entry that was refused — said already, in
 * red, by the time anyone reads it. A marker rather than the refusal's text, so
 * the one place that reads it (a feature's confirm, stopping at the first
 * refused line) cannot say it a second time.
 */
const TYPED_REFUSAL = "refused as typed";

/**
 * The rim under a light mark where faces are drawn: the background's own
 * colour (index.html's #0a0e13), so it is invisible anywhere but over a solid,
 * and this many pixels wide either side of the mark.
 */
const CASING = "#0a0e13";
const CASING_PX = 1.25;

/**
 * Construction geometry's ink and width (docs/plans/construction.md): a muted
 * teal, a hue no other mark uses — not the sketch's grey-blue dimmed, which
 * would read as the hidden view's ink — and under a pixel wide, against the
 * sketch's 1.4. Drawn solid, never dashed: a dash means selection here.
 */
const CONSTRUCTION = "#679b91";
const CONSTRUCTION_PX = 0.9;
/** Its casing over a face, each side: a hairline, not `CASING_PX` — see `strokeEdge`. */
const CONSTRUCTION_CASING_PX = 0.5;

async function main() {
  statusLine.show("loading", "loading kernel…");
  await ensureKernelLoaded();
  log("kernel loaded");

  // `let`, not `const`: opening a saved file replaces the model outright, and
  // everything below reads through this binding so the swap reaches all of it.
  //
  // **Always 3D** — the owner's one-model decision: there is no 2D mode and no
  // second model type, and a "sketch" is just geometry on a frame's plane. The
  // camera starts square-on, looking down −z with +x right and +y up, so until
  // something turns it the app looks and behaves exactly as the 2D one did,
  // with every point at z = 0.
  //
  // **Or the drawing the autosave kept** (docs/plans/files.md): an iPhone
  // throws a backgrounded app away without warning, so the last document is
  // read back here, before anything is drawn — the first picture is it.
  const autosave = new Autosave(indexedDbStore(), { log: (line) => log(line, "out") });
  const restored = await autosave.restore((r) => openModelText(r.text, APP_DIM));
  let model = restored?.value ?? new Model(APP_DIM);
  if (restored) {
    const r = restored.record;
    log(`restored ${r.name}${r.dirty ? " (unsaved changes)" : ""} — autosaved on this device`, "out");
    for (const line of carryIntoSession(savedTools(r.text), toolSources)) log(line, "out");
  }
  const view: View = { ox: 0, oy: 0, scale: 3, ui: metrics.scale };
  sizeCanvas();
  const r0 = cv.getBoundingClientRect();
  view.ox = r0.width / 2;
  view.oy = r0.height / 2;

  function render() {
    const r = cv.getBoundingClientRect();
    g.clearRect(0, 0, r.width, r.height);
    // No grid, and no origin marker either — deliberately (owner's call,
    // 2026-09-01). A grid is a picture of a world lattice, and a drawn origin
    // is an invitation to relate geometry to a global frame that this app is
    // in the process of not having: geometry is defined by its relations to
    // other geometry, and a coordinate frame, where wanted, is an entity the
    // user creates. The *user's* frames are drawn below, in the entity pass,
    // because a frame is geometry rather than annotation — it is a thing in
    // the drawing that can be clicked, dragged and deleted, not a note about
    // one. What is absent is only the frame nobody made.
    //
    // The cost of that decision is that an empty model is a black rectangle,
    // which the owner opened cold and read as broken. So an empty model says
    // what to do — see `emptyHint`, drawn at the end of the pass.

    // What the cursor is over lights up — and hovering a *constraint* lights up
    // everything that constraint is about. That spread is the payoff of drawing
    // glyphs at all: hover `⊥` and see which two lines it means, rather than
    // reading two names off a tag and hunting for them.
    const hov = engine.hover;
    const lit = new Set<string>(
      hov ? (hov.kind === "relation" ? constrainedBy(model, hov.name) : [hov.name]) : [],
    );
    // The selection, in its own colour (tools/selection.ts) — under the hover's
    // amber, which is about where the hand is now. Pruned here, once a frame,
    // so a name deleted since it was picked has left it before it is drawn.
    const chosen = new Set(engine.selection.prune(model));

    // A solid's faces first, so everything after is drawn over them: back
    // faces culled, lit from the eye (see faces.ts), and which face is in
    // front answered per pixel by the depth layer under this canvas — unless
    // the viewer asked for a wireframe. Faces are display only: they never
    // pick or snap.
    const faced = drawsFaces(viewMode);
    // A feature an armed tool draws itself, as it will be (the edit dialog's
    // preview), is left out here, and hides nothing behind it while it is.
    const replaced = new Set(engine.active?.replaces?.() ?? []);
    if (faceLayer) {
      if (faced) faceLayer.draw(model, view, r.width, r.height, replaced);
      else faceLayer.clear();
    } else if (faced) {
      paintFaces(g, model, view, replaced);
    }

    // What of the drawing is behind a face — asked of the same faces on the
    // CPU (occlusion.ts), whichever renderer drew them. **Shaded, a solid is
    // opaque** (the owner: "It should be opaque"): what is behind a face is not
    // drawn, and the engine is handed the same answer so it is not picked,
    // snapped to or boxed either — one answer a frame, for the eye and the
    // hand. In the hidden mode it is drawn, in a dimmed ink, and everything
    // stays aimable. No solid (or no faces), no question: a plain sketch draws
    // exactly as it always has, at no cost.
    const faces = faced && model.features.size ? visibleFaces(model, view, replaced) : [];
    occluded = faces.length ? occlusion(faces, view) : null;
    hides = occluded && opaque(viewMode) ? occluded : null;
    engine.occlusion = hides;

    // A solid's own edges — its profile, the lid's twins, the walls — in a
    // dark ink over the light faces, as Onshape draws a part. Only where faces
    // are drawn: in a wireframe that ink would be lost on the background. A
    // profile member that is only a *portion* of its entity (a line a crossing
    // split) keeps its sketch colour, because the rest of that line is not on
    // the solid.
    // A hidden feature has no faces, so no body for these to be the edges of.
    const bodies = new Set([...model.features.keys()].filter((n) => !model.hidden.has(n)));
    const solid = occluded ? solidEdges(model, bodies) : new Set<string>();
    // **Construction geometry** is thin and in a muted ink of its own — never
    // dashed, because a dash here means selection (the owner's rule: a shape
    // being drawn is a solid line). Hover and selection outrank it exactly as
    // they outrank every other ink, so a construction circle lights and selects
    // like any circle; it outranks a solid's edge colour, since a feature's
    // twin flagged construction should look it.
    const stroke = (name: string) => (lit.has(name) ? "#e8a33d" : chosen.has(name) ? SELECTION
      : model.isConstruction(name) ? CONSTRUCTION : solid.has(name) ? SOLID_EDGE : "#afc6d9");
    const weight = (name: string) => (lit.has(name) ? 2.2 : chosen.has(name) ? 2.6
      : model.isConstruction(name) ? CONSTRUCTION_PX : 1.4);

    // **Quiet geometry** (quiet.ts; the owner: points "disappear when they are
    // the endpoint of a line or a corner (except when you hover over them)",
    // lines "when they form the edge of a solid"). Shaded only: in it a
    // corner is not drawn, and a solid's own edges are left to the fine line
    // the face layer drew with the faces — until the hand is on them. Quiet is
    // not hidden: none of this reaches the pick, so a quiet corner is still
    // hovered, snapped to and dragged, and drawn while it is.
    quiet = quietEntities(model, { shaded: opaque(viewMode), faced: new Set(faces.map((f) => f.feature)) });
    shown = revealed(model, [
      ...lit,
      ...chosen,
      ...(engine.snap?.targets ?? []),
      ...(engine.armedUnder ? [engine.armedUnder.name] : []),
      ...engine.dragging,
    ]);

    // Painter's order, far to near, one depth per entity, for the wireframe on
    // top. Curves and frames are one pass and points a second on top, as they
    // always were: a point's dot and name are what a hand aims at, and must
    // not be painted over by an edge running behind them.
    const byDepth = <T extends Entity>(es: T[]) =>
      es.map((e) => ({ e, d: entityDepth(e) })).sort((a, b) => a.d - b.d).map((x) => x.e);
    // What is hidden is not drawn, and nothing else about it changes: it is
    // still solved, and the engine is told nothing — it asks the model. And
    // hidden outranks revealed (quiet.ts): a reveal brings back what is quiet,
    // never what the user hid.
    const all = [...model.entities.values()].filter((e) => entityDrawn(model, e.name, quiet, shown));
    const edges = byDepth(all.filter((x) => x.kind !== "point"));
    const points = byDepth(all.filter((x) => x.kind === "point"));

    // Where faces are drawn, a light mark over a light face needs a dark rim
    // to be read — a sketch on a lid, a point's name on a wall. So the pass is
    // run twice: first every mark's casing, a little wider than it, in the
    // background's own colour (and so invisible off the solid), then every
    // mark itself. Casings first, all of them, so one never cuts into a mark
    // already drawn where two cross. A plain sketch has no faces and skips the
    // casing pass: it draws exactly what it always drew.
    if (occluded) {
      casing = true;
      try {
        entityPass(edges, points, stroke, weight, lit, chosen);
      } finally {
        casing = false;
      }
    }
    entityPass(edges, points, stroke, weight, lit, chosen);

    // After the entities so a mark is never hidden by the drawing it describes,
    // and before the tool overlay so a gesture in progress stays on top of
    // everything — the geometry being placed is what the eye should be on.
    // The glyphs are the engine's, placed with the occlusion handed to it
    // above, so a mark behind a solid is gone from the picture and the pick
    // alike.
    renderGlyphs(hov?.kind === "relation" ? hov.name : null, chosen);

    // The empty-canvas hint goes the moment anything exists, and also while a
    // gesture is drawing a preview into a model that has nothing in it yet —
    // the hint sat under a rectangle being dragged out. Whether a preview is on
    // screen is asked of the overlay itself rather than of any tool's state, so
    // every tool, built in or typed, is covered without saying anything.
    if (model.entities.size === 0) {
      if (!drewAnything(() => engine.renderOverlay())) emptyHint(r.width, r.height);
    } else {
      engine.renderOverlay();
    }
    syncToolbar();
  }

  /**
   * The entities, far to near: edges, curves and frames, then the points and
   * their names on top. Run once as the casing pass (`casing` set) and once
   * as itself — the same code both times, so a casing is exactly the shape of
   * the mark it rims.
   */
  function entityPass(edges: Entity[], points: Entity[], stroke: (name: string) => string,
                      weight: (name: string) => number, lit: Set<string>, chosen: Set<string>) {
    for (const e of edges) {
      g.lineWidth = weight(e.name);
      if (e.kind === "line") {
        strokeEdge([model.coords(e.refs[0]), model.coords(e.refs[1])], false, stroke(e.name));
      } else if (e.kind === "circle" || e.kind === "arc") {
        // In its plane (see curveplane.ts): a circle the full turn round its
        // centre in its frame's orientation, an arc counter-clockwise from
        // start to end about its plane's +z (for a 2D arc, about +z, as
        // always). Drawn as the projection of a fine polyline, a quarter-pixel
        // from the true curve, which seen square-on is the circle or circular
        // arc and seen at an angle is an ellipse, or part of one — the very
        // curve picking and snapping aim at. (A circle was drawn as a sphere's
        // silhouette until it carried a plane: round from every angle, which
        // was the phase-2 seam showing.)
        const f = curveFrame(model, e);
        if (f) strokeEdge(arcSamples(f, arcSegments(f.sweep, f.r * view.scale)), e.kind === "circle", stroke(e.name));
      } else if (e.kind === "frame") {
        drawFrame(e.name, lit.has(e.name), chosen.has(e.name));
      }
    }

    const k = uiOf(view);
    g.font = `${11 * k}px monospace`;
    for (const e of points) {
      const world = model.coords(e.name);
      // Behind a face in a shaded view: not drawn, dot and name together —
      // and not pickable either, by the same answer (picking.ts).
      if (!inSight(hides, world)) continue;
      const [sx, sy] = engine.worldToScreen(world);
      const r = (lit.has(e.name) || chosen.has(e.name) ? 5 : 3.5) * k;
      if (casing) {
        g.fillStyle = CASING;
        g.beginPath(); g.arc(sx, sy, r + CASING_PX, 0, Math.PI * 2); g.fill();
        label(e.name, sx + 6 * k, sy - 6 * k);
        continue;
      }
      // A point keeps its sketch colour on a solid: it is a target, not an
      // outline, and its casing carries it over a light face.
      g.fillStyle = lit.has(e.name) ? "#e8a33d" : chosen.has(e.name) ? SELECTION : "#afc6d9";
      g.beginPath(); g.arc(sx, sy, r, 0, Math.PI * 2); g.fill();
      label(e.name, sx + 6 * k, sy - 6 * k);
    }
  }

  /**
   * Text in the entity pass: filled, or — in the casing pass — stroked a few
   * pixels wide in the casing colour, the rim a label needs over a light face.
   */
  function label(text: string, x: number, y: number) {
    if (!casing) {
      g.fillText(text, x, y);
      return;
    }
    g.save();
    g.strokeStyle = CASING;
    g.lineWidth = 2 * CASING_PX + 0.5;
    g.lineJoin = "round";
    g.strokeText(text, x, y);
    g.restore();
  }

  /**
   * Whether `draw` put anything on the drawing canvas — counted at the
   * context's own drawing calls while it runs, which is the one place every
   * preview, snap marker and selection box has to pass. Only ever asked of an
   * empty model, so a drawing in progress pays nothing for it.
   */
  function drewAnything(draw: () => void): boolean {
    const calls = ["stroke", "fill", "fillText", "strokeText", "fillRect", "strokeRect", "drawImage"] as const;
    let drawn = 0;
    const ctx = g as unknown as Record<string, unknown>;
    for (const name of calls) {
      const real = CanvasRenderingContext2D.prototype[name] as (...a: unknown[]) => unknown;
      ctx[name] = function (this: CanvasRenderingContext2D, ...args: unknown[]) {
        drawn++;
        return real.apply(this, args);
      };
    }
    try {
      draw();
    } finally {
      // The instance's own properties go, and the prototype's methods are
      // what the context answers with again.
      for (const name of calls) delete ctx[name];
    }
    return drawn > 0;
  }

  /**
   * Brings the toolbar and the options panel up to date with the registry and
   * the armed tool. Neither announces a change — the registry is a plain map,
   * and a tool finishing its gesture simply clears `engine.active` — so this is
   * called from everywhere a change can have just happened: every redraw, every
   * canvas press and release, every entry, Escape. It does DOM work only when
   * something differs, and places the panels again only when one changed shape
   * (a button more, the options panel shown or gone).
   */
  function syncToolbar() {
    const rebuilt = toolbar.sync();
    if (optionsPanel.sync() || rebuilt) panels.apply();
    actionStrip?.sync();
  }

  /**
   * The words on an empty canvas: what it is, and every way in that exists.
   *
   * **Read off the model in the draw pass, and nothing else** — no flag set by
   * a clear or cleared by a click — so a fresh page, an undo back to nothing,
   * opening an empty file and deleting the last entity all show it without any
   * of them knowing it exists, and the first entity of any kind, a frame
   * included, takes it away. Muted, in the status line's colours: it is the
   * page explaining itself, and should stop being noticed once read.
   *
   * Not drawn at all while a tool's preview is on screen in an empty model
   * (see `render`): words under a rectangle being dragged out are in the way
   * of the one thing the eye should be on, and the gesture already answers
   * the question they ask.
   */
  function emptyHint(width: number, height: number) {
    const k = uiOf(view);
    const lines: [string, string, string][] = [
      [`${13 * k}px`, "#7a8b9b", "Nothing drawn yet."],
      [`${12 * k}px`, "#56697b", coarse
        ? "Pick a tool from the toolbar, long-press for the menu, or type help() in the command line."
        : "Pick a tool from the toolbar, right-click for the menu, or type help() in the command line."],
    ];
    g.save();
    g.textAlign = "center";
    g.textBaseline = "middle";
    // Wrapped at its commas if the window is too narrow for the long line, so
    // a phone-width view still reads every way in rather than the middle of one.
    const rows: [string, string, string][] = [];
    for (const [size, colour, text] of lines) {
      g.font = `${size} "IBM Plex Mono", ui-monospace, Menlo, monospace`;
      if (g.measureText(text).width <= width - 40) rows.push([size, colour, text]);
      else for (const part of text.split(/(?<=,) /)) rows.push([size, colour, part]);
    }
    const step = 20 * k;
    let y = height / 2 - ((rows.length - 1) * step) / 2;
    for (const [size, colour, text] of rows) {
      g.font = `${size} "IBM Plex Mono", ui-monospace, Menlo, monospace`;
      g.fillStyle = colour;
      g.fillText(text, width / 2, y);
      y += step;
    }
    g.restore();
  }

  /**
   * This frame's faces, ready to say what is behind them — null when there is
   * no solid to be behind, which is what keeps a plain sketch's drawing exactly
   * what it was. Set by `render` before the entity pass, read by `strokeEdge`.
   */
  let occluded: Occlusion | null = null;
  /**
   * The same, when the faces are opaque — a shaded view — and null otherwise:
   * what hides things from the drawing, and (handed to the engine) from the
   * pick, the snapper and box select.
   */
  let hides: Occlusion | null = null;
  /** Set while the entity pass is drawing casings rather than marks — see `render`. */
  let casing = false;
  /** This frame's quiet entities, and what of the drawing is revealed — set by `render` (quiet.ts). */
  let quiet: ReadonlySet<string> = new Set();
  let shown: ReadonlySet<string> = new Set();

  /**
   * An edge — a polyline in the world: a line's two ends, a curve's drawn
   * samples, a frame's arm — stroked in `colour` where nothing is in front of
   * it, at the context's current width. Where a face is in front, a shaded
   * view draws nothing and the hidden mode draws it in its hidden ink
   * (occlusion.ts). Returns the ink its last point was drawn in, for whatever
   * is drawn at that end (a frame's arrowhead) — null when that end is not
   * drawn at all.
   *
   * An edge all in one ink is the path the entity pass always drew, the same
   * calls in the same order: a circle's last sample is its first, and closing
   * the path joins them as a corner like any other rather than leaving two
   * butt ends. Only an edge a face cuts is drawn as runs.
   */
  function strokeEdge(world: number[][], closed: boolean, colour: string): string | null {
    const runs = occluded ? inkRuns(occluded, world, closed) : null;
    // The casing pass rims what is drawn in full ink and nothing else: a
    // solid's own dark edge needs no rim on its light faces, and a hidden run
    // (the hidden mode) is meant to be faint.
    const width = g.lineWidth;
    const rim = casing && colour !== SOLID_EDGE;
    const inkOf = (hidden: boolean) => (casing ? CASING : hidden ? hiddenInk(colour) : colour);
    const skip = (hidden: boolean) => (hides !== null && hidden) || (casing && (hidden || !rim));
    // Construction ink is mid-dark already, so it needs only a hairline of rim
    // to part it from a face of its own shade; a full rim would draw it on a
    // solid as a heavy dark line, which is the opposite of thin and muted.
    if (casing) g.lineWidth = width + 2 * (colour === CONSTRUCTION ? CONSTRUCTION_CASING_PX : CASING_PX);
    try {
      if (!runs || runs.length === 1) {
        const hidden = runs !== null && runs[0].hidden;
        if (hides && hidden) return null;
        if (skip(hidden)) return casing && hidden ? null : inkOf(hidden);
        const pts = world.map((w) => engine.worldToScreen(w));
        g.strokeStyle = inkOf(hidden);
        g.beginPath();
        g.moveTo(...pts[0]);
        for (const pt of pts.slice(1)) g.lineTo(...pt);
        if (closed) g.closePath();
        g.stroke();
        return inkOf(hidden);
      }
      let ink: string | null = colour;
      for (const run of runs) {
        if (hides && run.hidden) { ink = null; continue; }
        ink = casing && run.hidden ? null : inkOf(run.hidden);
        if (skip(run.hidden)) continue;
        g.strokeStyle = inkOf(run.hidden);
        g.beginPath();
        g.moveTo(...run.points[0]);
        for (const pt of run.points.slice(1)) g.lineTo(...pt);
        g.stroke();
      }
      return ink;
    } finally {
      g.lineWidth = width;
    }
  }

  /**
   * How near the viewer an entity is, for the painter's sort: a point's own
   * depth, the middle of a line, the centre of a circle or arc, a frame's
   * origin. One number per entity is coarse — a long edge crossing a short one
   * can sort the wrong way at the crossing — and is enough: strokes are never
   * opaque to each other in any way that matters, and the only opaque things,
   * a solid's faces, are drawn first, by depth (see facelayer.ts).
   */
  function entityDepth(e: Entity): number {
    const at = (name: string) => depth(view, model.coords(name));
    switch (e.kind) {
      case "point": return at(e.name);
      case "line": return (at(e.refs[0]) + at(e.refs[1])) / 2;
      case "circle":
      case "arc": return at(e.center);
      case "frame": return at(e.origin);
    }
  }

  /**
   * A coordinate frame: short arrows out of its origin, along +x and +y — and
   * +z for a 3D frame — lettered, with the frame's name beside it the way a
   * point's name sits beside the point.
   *
   * **The default frame is drawn brighter**, because that difference is the
   * whole of what the pointer means: a bare `hor` is level with *that* frame
   * and not with any other one on the canvas. It is the only ambient state in
   * the app that changes what a typed word does, so it had better be visible
   * without asking.
   *
   * Arms are a fixed pixel length when they lie flat to the screen, and
   * foreshorten as the frame turns away (see framemarker.ts) — the refs'
   * distance carries no meaning — and the letters are what make a *tilted*
   * frame readable at a glance, which is exactly the case the whole package
   * exists for. An axis pointing straight at the viewer has no arm to draw,
   * and draws only its letter. Drawn in the entity pass, not with the glyphs: a
   * frame is a thing in the drawing that can be clicked, dragged and deleted,
   * not a note about one.
   */
  function drawFrame(name: string, lit: boolean, chosen = false) {
    const marker = frameMarker(model, view, name);
    if (!marker) return; // collapsed onto its own origin: no axes to draw
    // The arms in the world, for asking what is in front of them: an arm is
    // its axis from the origin for as far as its fixed pixel length reaches
    // (framemarker.ts), so its screen tip is exactly the marker's.
    const basis = frameBasis(model, name)();
    // Behind a solid at its origin, in a shaded view, the marker is not drawn
    // at all — the place it stands for is out of sight, and picking agrees.
    if (!inSight(hides, basis.origin)) return;
    const reach = frameArmPx(view) / view.scale;
    const k = uiOf(view);
    const armEnd = (u: number[]) => basis.origin.map((c, i) => c + (u[i] ?? 0) * reach);
    const isDefault = model.defaultFrame === name;
    const colour = lit ? "#e8a33d" : chosen ? SELECTION : isDefault ? "#c9dcec" : "#7b93a8";
    g.save();
    g.strokeStyle = colour;
    g.fillStyle = colour;
    g.lineWidth = lit || chosen ? 2.2 : isDefault ? 1.6 : 1.2;
    g.font = `${10 * k}px ui-monospace, Menlo, monospace`;
    const arms: [[number, number], string, number[]][] = [[marker.x, "x", basis.ux], [marker.y, "y", basis.uy]];
    if (marker.z && basis.uz) arms.push([marker.z, "z", basis.uz]);
    for (const [tip, letter, axis] of arms) {
      const [dx, dy] = [tip[0] - marker.origin[0], tip[1] - marker.origin[1]];
      const len = Math.hypot(dx, dy);
      if (!(len > 0.5)) {
        // Pointing at the viewer: a dot of an arm. The letter alone, just off
        // the origin, still says the axis is there and which way it faces.
        label(letter, marker.origin[0] + 4 * k, marker.origin[1] + 12 * k);
        continue;
      }
      const [ux, uy] = [dx / len, dy / len];
      if (occluded) {
        // With a solid about, an arm is an edge like any other — dimmed where
        // a face is in front of it, or (shaded) not drawn there — and its head
        // takes the ink the arm reached its tip in. A tip out of sight takes
        // its head and letter with it; the letters are otherwise labels and
        // keep their colour.
        const ink = strokeEdge([basis.origin, armEnd(axis)], false, colour);
        if (ink === null) continue;
        g.strokeStyle = ink;
        g.beginPath();
      } else {
        g.beginPath();
        g.moveTo(marker.origin[0], marker.origin[1]);
        g.lineTo(tip[0], tip[1]);
      }
      // An arrowhead as two strokes rather than a filled triangle: at this size
      // a fill reads as a blob, and the open head is what a datum triad uses.
      for (const s of [1, -1]) {
        const a = Math.atan2(uy, ux) + s * 0.4;
        g.moveTo(tip[0], tip[1]);
        g.lineTo(tip[0] - Math.cos(a) * 6 * k, tip[1] - Math.sin(a) * 6 * k);
      }
      // The casing pass rims the head as `strokeEdge` rimmed the arm.
      const width = g.lineWidth;
      if (casing) g.lineWidth = width + 2 * CASING_PX;
      g.stroke();
      g.lineWidth = width;
      label(letter, tip[0] + (ux * 8 - 3) * k, tip[1] + (uy * 8 + 3.5) * k);
    }
    g.font = `${11 * k}px monospace`;
    // Away from both arms, not at a fixed corner: the arms turn with the frame,
    // and a label pinned below-right would sit on top of one of them as soon as
    // the frame was tilted — which is the case this package is about. Opposite
    // their bisector is the one direction that stays clear whatever the tilt.
    const bx = (marker.x[0] + marker.y[0]) / 2 - marker.origin[0];
    const by = (marker.x[1] + marker.y[1]) / 2 - marker.origin[1];
    const bl = Math.hypot(bx, by) || 1;
    label(name, marker.origin[0] - ((bx / bl) * 14 + 3) * k, marker.origin[1] - ((by / bl) * 14 - 4) * k);
    g.restore();
  }

  /**
   * The constraint marks, in the same visual family as the hover tag: a small
   * rounded box, dim until the cursor is on it. Dim on purpose — there is one
   * of these per constraint and a drawing has many, so they have to read as an
   * annotation layer rather than as geometry.
   */
  function renderGlyphs(hoveredRelation: string | null, chosen: Set<string>) {
    // A glyph follows its anchor: one on a quiet corner or a solid's quiet
    // edge is drawn when that is (quiet.ts) — or when it is itself selected.
    // Only the drawing leaves it out: the engine still picks it, as it still
    // picks the corner.
    const marks = engine.glyphs().filter((m) => chosen.has(m.relation) || glyphDrawn(m, quiet, shown, hoveredRelation));
    if (!marks.length) return;
    const k = uiOf(view);
    g.save();
    // At the interface size, as the boxes are (glyphs.ts sizes them from
    // GLYPH_CHAR_W, this font's advance, times the same factor).
    g.font = `${12 * k}px ui-monospace, Menlo, monospace`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    for (const mark of marks) if (mark.ends) dimensionLines(mark, mark.relation === hoveredRelation, k);
    for (const mark of marks) {
      const on = mark.relation === hoveredRelation;
      // A selected constraint is its box in the selection's colour, a little
      // heavier: the mark is the whole of what a relation looks like.
      const picked = !on && chosen.has(mark.relation);
      const [x, y] = mark.screen;
      roundedBox(x - mark.halfW, y - mark.halfH, mark.halfW * 2, mark.halfH * 2, 3 * k);
      g.fillStyle = on ? "#20303f" : "#0e141bee";
      g.fill();
      g.strokeStyle = on ? "#e8a33d" : picked ? SELECTION : "#2c3d4f";
      g.lineWidth = picked ? 1.6 : 1;
      g.stroke();
      // A dimension is brighter than an annotation on purpose: it states
      // something the user asked for, where `∥` states something they may only
      // have implied. Onshape draws its dimensions the same way — a value
      // reads as part of the drawing, an inferred mark as a note about it.
      g.fillStyle = on ? "#e8a33d" : picked ? SELECTION : mark.isLabel ? "#cfe0ee" : "#8fa7bb";
      // Nudged down a hair: several of these marks (— ∥ ⊥ ∴) sit high in their
      // em box, and centring by metrics leaves them looking as though they are
      // escaping upward out of the box.
      g.fillText(mark.symbol, x, y + 0.5 * k);
    }
    g.restore();
  }

  /**
   * A `dist` label's witness and dimension lines: a stub out from each end of
   * what is being measured, and a line between them at the label's own level,
   * with an arrow into each end.
   */
  function dimensionLines(mark: Glyph, on: boolean, k: number) {
    const [a, b] = mark.ends!;
    const [lx, ly] = mark.screen;
    // How far out the dimension line sits: the label's own offset, projected
    // back onto the perpendicular so the line passes through the label.
    const px = b[1] - a[1], py = a[0] - b[0];
    const len = Math.hypot(px, py);
    if (!(len > 1e-6)) return;
    const [ux, uy] = [px / len, py / len];
    const off = (lx - a[0]) * ux + (ly - a[1]) * uy;
    const at = (p: [number, number], t: number): [number, number] => [p[0] + ux * t, p[1] + uy * t];

    g.save();
    g.strokeStyle = on ? "#e8a33d" : "#33485c";
    g.lineWidth = 1;
    g.setLineDash([3, 3]);
    g.beginPath();
    // Witness lines start clear of the geometry, the way a draughtsman's do —
    // touching the point would make them read as part of the drawing.
    for (const end of [a, b]) {
      const gap = (off >= 0 ? 4 : -4) * k;
      g.moveTo(...at(end, gap));
      g.lineTo(...at(end, off + gap));
    }
    g.moveTo(...at(a, off));
    g.lineTo(...at(b, off));
    g.stroke();
    // Arrowheads, pointing outward into the witness lines.
    const dx = (b[0] - a[0]) / Math.hypot(b[0] - a[0], b[1] - a[1]);
    const dy = (b[1] - a[1]) / Math.hypot(b[0] - a[0], b[1] - a[1]);
    g.fillStyle = on ? "#e8a33d" : "#40566b";
    for (const [end, s] of [[a, 1], [b, -1]] as const) {
      const tip = at(end, off);
      g.beginPath();
      g.moveTo(tip[0], tip[1]);
      g.lineTo(tip[0] + (s * dx * 7 + ux * 2.5) * k, tip[1] + (s * dy * 7 + uy * 2.5) * k);
      g.lineTo(tip[0] + (s * dx * 7 - ux * 2.5) * k, tip[1] + (s * dy * 7 - uy * 2.5) * k);
      g.closePath();
      g.fill();
    }
    g.restore();
  }

  /** A rounded rectangle path. `ctx.roundRect` is newer than this needs to be. */
  function roundedBox(x: number, y: number, w: number, h: number, r: number) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  function solveAndRender() {
    const report = model.solve();
    if (report.solved) statusLine.show("solved", "SOLVED");
    else statusLine.show("conflict", `CONFLICT: ${report.offenders.map((o) => o.label).join(", ")}`);
    render();
    return report;
  }

  /**
   * Clicking geometry **while a command is being written** drops its *name*
   * into the command line. cellwork's idea, and it fits here even better:
   * every relation takes entity names, so clicking two lines after `fillet(`
   * writes most of the call for you. With the command line empty a click
   * selects instead (the engine's `selection`) — a selection is what grouping,
   * hiding and deleting a set in one gesture need, and what every CAD tool's
   * click does; the text in the line is the signal, and it is on screen.
   */
  function insertName(name: string) {
    const v = cmdEl.value;
    // Separate arguments with a comma, because these are function calls: two
    // clicks after `dist(` should leave `dist("p1", "p2"`, ready to finish,
    // rather than something that still needs punctuating by hand.
    const needsComma = /[\w"\]]\s*$/.test(v);
    cmdEl.value = v + (needsComma ? ", " : "") + `"${name}"`;
    // Not under a finger: focusing the line raises iOS's keyboard over the
    // drawing the next name is to be tapped from. The name is in the line;
    // a tap on the line brings the keyboard back, as any field's does.
    if (lastPointer !== "touch") cmdEl.focus();
    log(`${name} → command line`, "out");
  }

  /**
   * Puts an unfinished command in the line for the user to complete — what the
   * menu's Set value… does, since only the user knows the number.
   *
   * It **replaces** what is there rather than appending, which is the opposite
   * of `insertName` and right for the opposite reason. A name is another
   * argument to whatever is being composed; a partial command is a different
   * command, and `dist("p1", set("d4.value", ` is not a thing anyone was
   * typing. Nothing is submitted either way — the seam the menu's `run` goes
   * through is deliberately not this one.
   */
  function typeCommand(text: string) {
    cmdEl.value = text;
    cmdEl.focus();
    // The caret at the end, so the next keystroke is the number. Chrome puts it
    // where it last was on a programmatic value change, which for a line that
    // was previously empty is position 0 — i.e. in front of the whole command.
    cmdEl.setSelectionRange(text.length, text.length);
    log(`${text}… → command line`, "out");
  }

  // The canvas follows its own box. Since the chrome became floating panels
  // nothing inside the page reflows it any more — the log used to, taking
  // height as it filled — but the box still changes with the window, and a
  // bitmap left at its old aspect quietly squashes the drawing: circles come
  // out as ellipses, which no assertion catches and one glance does.
  new ResizeObserver(() => {
    sizeCanvas();
    render();
  }).observe(cv);

  // ---- undo ----------------------------------------------------------------
  //
  // The stack holds serialised models and nothing else (see undo.ts). All the
  // judgement lives here, in the host, because "what is one undo step" is a
  // question about the *interface* — a claim about what the user thinks they
  // just did — and nothing below this file is entitled to an opinion on it.
  //
  // The policy is one comparison: snapshot before the action, snapshot after,
  // and record a step only if the two differ. That is what keeps `ls()`,
  // `help()`, a click that picked nothing and a tool's first click out of the
  // history without any of them having to be enumerated. Being the same text
  // `save()` writes, a snapshot also compares by value for free.

  const undoStack = new UndoStack<string>();
  const snapshot = () => saveModel(model, false);
  /** The document — its name, dirty flag and commands (filehost.ts); made once `handles` exists, below. */
  let files: Files | undefined;

  let actionDepth = 0;
  let actionBefore = "";
  /** Set by undo()/redo(): they move through the history, they do not add to it. */
  let movedHistory = false;

  function beginUserAction() {
    // Only the outermost bracket counts. A command entry that opens a file, or
    // a pointer event that lands mid-`await` in the REPL, would otherwise
    // record the same edit twice.
    if (actionDepth++ === 0) {
      actionBefore = snapshot();
      movedHistory = false;
    }
  }

  /**
   * Closes the bracket, and **returns whether the model changed** — the same
   * comparison the undo stack is deciding on, handed back rather than computed
   * a second time somewhere else.
   *
   * That answer has a second customer: a command entry that changed the model
   * has to re-solve, or the header goes on reporting the verdict from before
   * whatever was just typed. Enumerating which commands are edits is exactly
   * what this file has been avoiding since undo was written, and there is no
   * reason to start now when the arithmetic is already here.
   *
   * `false` for a nested close (only the outermost bracket has an answer) and
   * for a history move, which restored a model that `swapModel` has already
   * solved and drawn.
   */
  function endUserAction(): boolean {
    if (actionDepth === 0) return false; // defensive: an unbalanced `after` records nothing
    if (--actionDepth > 0) return false;
    if (movedHistory) { movedHistory = false; return false; }
    const changed = undoStack.pushIfChanged(actionBefore, snapshot());
    // Every edit, however it was made, is a change the autosave hears of.
    if (changed) files?.changed();
    // A tool's guidance is about the click before this one; once something
    // has been made it is stale, and a header still saying "click inside a
    // closed outline" over the solid that click just made would be the
    // stale-readout bug in a new place.
    if (changed && statusLine.noteClass === "guide") stepNote("", 0);
    return changed;
  }

  /** Runs `fn` as one undoable step. */
  function asUserAction<T>(fn: () => T): T {
    beginUserAction();
    try {
      return fn();
    } finally {
      endUserAction();
    }
  }

  /**
   * One move through the history, by whichever door — the chord, the menu's
   * Undo, or `undo()` typed — so all three do the same thing in the same order.
   *
   * **What is on screen is put away first.** The menu closes, because every
   * command on it names the model about to be replaced. The gesture in
   * progress is cancelled, as Escape cancels it, because its preview is drawn
   * from a model that is about to stop existing — and cancelling first is also
   * what makes a drag interrupted by Ctrl+Z a step of its own that the same
   * keystroke then takes back, rather than a pull baked into the restored model.
   *
   * **The tool stays armed**, as a fresh instance of itself: the gesture was
   * the tool's state, and the state is what went. Someone drawing lines who
   * undoes the last one wants to draw the next, not to re-arm. The exception
   * would be a tool the restored model cannot run (`toolUnavailable`), left
   * disarmed with the rule's reason; none is today — a curve tool whose
   * frame the undo took away makes a new one at its next click.
   *
   * Every outcome is said twice: the returned line, for the log, and a brief
   * note beside the status verdict — the empty stack included, which used to
   * be a log line nobody looks at and read as the key doing nothing.
   */
  function step(direction: "undo" | "redo"): string {
    menu.close();
    const armed = engine.armed;
    engine.cancel();
    const target = direction === "undo" ? undoStack.undo(snapshot()) : undoStack.redo(snapshot());
    if (target !== undefined) {
      // Flagged before the swap, not after: `swapModel` re-enters this file
      // (it cancels any gesture, which can close a user action), and the flag has
      // to already be set by the time it does.
      movedHistory = true;
      swapModel(openModelText(target, APP_DIM));
    }
    if (armed) {
      const why = toolUnavailable(model, armed.name);
      if (why === null) engine.arm(armed.name, armed.options, armed.target);
      else log(`${armed.name} disarmed: ${why}`, "out");
    }
    render();
    const said = target === undefined ? `nothing to ${direction}` : direction === "undo" ? "undid" : "redid";
    stepNote(said);
    return target === undefined ? said : `${said} — ${undoStack.depth} back, ${undoStack.redoDepth} forward`;
  }

  /**
   * The note beside the status verdict that says what the last undo or redo
   * did. **Beside the verdict, never in place of it**: the verdict is the one
   * thing the header must not get wrong, and a readout that spent a second and
   * a half saying "undid" instead of CONFLICT would be the stale-readout bug
   * this project has already paid for once. Cleared on a timer, and replaced
   * by the next step's note if that comes first.
   */
  function stepNote(text: string, ms = STEP_NOTE_MS, cls = "") {
    statusLine.note(text, ms, cls);
  }

  /**
   * The context menu, and the seam it goes through.
   *
   * **`run` is `submit` — the very function the Enter key calls** — and finding
   * that seam was the design question this package had to answer. A menu item is
   * specified as "a shortcut to a command the log shows", which is a statement
   * about *machinery*, not about outcome: it has to log the entry, push it onto
   * the recall history, bracket it as one undo step, and re-solve if it changed
   * anything. All four of those already live in `submit` and nowhere else, so
   * anything short of calling it would be a second, slightly different answer to
   * what typing a command means — and the two would drift.
   *
   * The alternative considered and rejected was writing the text into `#cmd` and
   * dispatching a synthetic Enter. That reaches the same function by pretending
   * to be a keyboard, which makes the seam invisible to a reader, destroys
   * whatever the user had half-typed, and would break the moment the input's
   * keydown handling changed. One named function passed to the menu is the
   * smaller and more honest hook.
   */
  const menu = new ContextMenu(menuEl, {
    run: (command) => void submit(command),
    insert: insertName,
    type: typeCommand,
  });

  /**
   * The toolbar goes through the same seam as the menu, for the same reasons:
   * a button types `arm("line")` into `submit`, so the log shows it, the
   * recall history has it, and arming by button is in every respect arming by
   * typing — journal and undo included, which for `arm` is nothing at all.
   *
   * No button is greyed: every tool makes what it needs and answers a click it
   * cannot use with guidance, so the toolbar no longer asks `toolUnavailable`
   * (the menu and `step` still do, and it answers null).
   *
   * A glyph is a built-in's own, by name, and every other tool's the generic
   * one (see tools/icons.ts for why by name).
   */
  const toolbar = new Toolbar(toolbarEl, {
    tools: listTools,
    icon: toolIcon,
    active: () => engine.active?.name ?? null,
    run: (command) => void submit(command),
  });

  /**
   * The options panel, through the same seam: a field edited types
   * `arm("extrude", {depth: 25})` into `submit`. Its rows are read off the
   * armed tool's declaration by its registered name (`engine.armed`, which a
   * tool defined at the command line may not share with its `name`), and its
   * values are what the tool is armed with — so `arm` typed by hand shows here
   * just as an edit made here shows in the log.
   */
  //
  // A feature tool's panel carries ✓ and ✗ too, learning whether ✓ would do
  // anything from the engine (`dialog`), and pressing them is Enter and
  // Escape: the same `confirm` and `escape` the keys reach. A field mid-edit
  // is shown to the tool as a trial value, so the preview follows the typing;
  // its line is typed only when the field commits.
  const optionsPanel = new OptionsPanel(optionsPanelEl, optionsEl, {
    armed: () => {
      const a = engine.armed;
      if (!a) return null;
      const specs = declaredOptions(getToolCtor(a.name), a.name);
      const rows = Object.entries(specs).map(([name, s]) => ({
        name, label: s.label ?? name, unit: unitSymbol(s.unit), value: a.options[name] as OptionValue,
      }));
      const dialog = engine.dialog();
      return rows.length || dialog ? { tool: a.name, rows, dialog } : null;
    },
    run: (command) => submit(command),
    confirm: () => {
      engine.confirm();
      syncToolbar();
    },
    cancel: () => escape(),
    trial: (option, value) => engine.trial(option, value),
  }, metrics);
  optionsShown = () => optionsPanel.size();

  const engine = new ToolEngine(model, cv, view, {
    onSolveRender: solveAndRender,
    onRenderOnly: render,
    // With text in the command line a click is an argument to the call being
    // written, as it always was; with none, a click selects (the engine's
    // `selection`). The text is the signal, and it is on screen.
    onPick: (pick) => insertName(pick.name),
    composing: () => cmdEl.value.trim() !== "",
    onUserAction: (phase) => (phase === "before" ? beginUserAction() : endUserAction()),
    // A tool's line is the user's business, not the console's. What a commit
    // made (`e1  extrude of …`) is an answer, and looks like one. Guidance — a
    // click that missed, answered with what would work — is muted in the log
    // and said in the header's note too, where the eye already is, for long
    // enough to read a sentence; never red, which is the model's. Anything
    // else a tool logs is a refusal, in an entry error's red.
    onLog: (line, outcome) => {
      if (outcome === "guide") {
        log(line, "out");
        stepNote(line, GUIDE_NOTE_MS, "guide");
        return;
      }
      log(line, outcome === "done" ? "out" : "err");
    },
    // A tool whose commit is a command types it, as the menu does — the sketch
    // tool's `plane(a, b, c)` — so it is logged, recalled and undone as typed.
    // The promise is handed back for the extrude tool, which waits for the
    // plane it typed to be in before extruding along it.
    onRun: async (command) => { await submit(command); },
    // A feature's confirm: every line it types, as typed — logged, recalled,
    // refused in red if the command line refuses it — inside **one** user
    // action, so one Ctrl+Z takes the whole selection's solids and the planes
    // made for them. The lines are awaited one by one, the bracket held open
    // across them (each `submit`'s own bracket is nested, and records nothing),
    // and the first refusal stops the rest: they were planned on it.
    onPerform: (steps) => perform(steps),
    // The same lines, on a copy (see featurepreview.ts) — with this view, so a
    // plane made for the preview faces the way the commit's will.
    onPreview: (steps) => previewSteps(model, view, steps),
    optionMemory,
    onContextMenu: (pick, sx, sy) => {
      // The tag and the menu would otherwise sit on top of one another, both
      // naming the same thing — and the tag cannot update while the cursor is
      // over the menu, so it would go stale as well as redundant.
      hoverEl.hidden = true;
      // On empty canvas the menu is also told which region the click is
      // inside, for "Sketch on this face" — asked here, where the camera is,
      // so the menu stays a pure function of what it is handed.
      const history = { canUndo: undoStack.canUndo, canRedo: undoStack.canRedo };
      const selected = engine.selection.prune(model);
      menu.show(menuFor(model, pick, pick ? null : engine.regionAt(sx, sy), history, viewMode, selected), sx, sy);
    },
    // A finger's long-press opened the menu and then dragged on: that is the
    // box, and the menu is not what the hand is doing any more.
    onContextMenuWithdrawn: () => { menu.close(); },
  });

  /**
   * The action strip, through the same seam as the toolbar and the menu: each
   * button types its line into `submit` — `undo()`, `redo()`, the Delete key's
   * `del(...)`, `cancel()` — so the log shows it and it is in every respect
   * the typed command. Only under a finger (see `coarse`).
   */
  const actionStrip = actionsEl
    ? new ActionStrip(actionsEl, {
      state: () => ({
        canUndo: undoStack.canUndo,
        canRedo: undoStack.canRedo,
        selected: engine.selection.prune(model),
        armed: engine.active !== null,
      }),
      run: (command) => void submit(command),
    })
    : null;

  /**
   * **A press on the canvas keeps the canvas for the whole gesture.** The engine
   * captures the pointer for a drag, a box and a pan, but not while a tool is
   * armed — and with panels floating over the drawing, a tool's press-drag that
   * wandered over the log would otherwise hand its moves and its release to the
   * log, leaving the tool waiting for an up that never comes. Capturing here, on
   * every press, is what makes "a drag that starts on the canvas never crosses
   * to a panel" true for every gesture the engine has or will have, without the
   * engine having to know panels exist. The panels capture their own presses
   * (see panels.ts), which is the other half.
   *
   * Registered after the engine's listener, so it runs after the engine has
   * dispatched the press — and so does the toolbar sync on release, by which
   * time a tool that finished on that click has cleared `engine.active`.
   */
  cv.addEventListener("pointerdown", (e) => {
    if (!cv.hasPointerCapture(e.pointerId)) cv.setPointerCapture(e.pointerId);
    // **A finger on the drawing puts the keyboard away.** iOS leaves a field
    // focused — and its keyboard over half the drawing — when the tap lands on
    // something that is not focusable, which a canvas is not; a mouse's press
    // blurs it anyway. A field mid-edit commits on blur, as it always has.
    if (e.pointerType === "touch") {
      const at = document.activeElement;
      if (at instanceof HTMLInputElement || at instanceof HTMLTextAreaElement) at.blur();
      tag(e);
    }
    syncToolbar();
  });
  cv.addEventListener("pointerup", (e) => {
    if (e.pointerType === "touch") hoverEl.hidden = true;
    syncToolbar();
  });

  // The hover tag follows the cursor and names whatever is under it.
  cv.addEventListener("pointermove", (e) => tag(e));
  function tag(e: PointerEvent) {
    const pick = engine.hover;
    // No tag while a tool is armed: the snap marker is saying the useful thing
    // by then, and a tag left over from before the gesture would follow the
    // cursor showing a name that is no longer under it.
    // `model.has`, not `model.entities.has`: a hovered glyph is a *relation*
    // pick, and the tag names it exactly as it names a point.
    if (!pick || engine.active || !model.has(pick.name)) {
      hoverEl.hidden = true;
      return;
    }
    const rect = cv.getBoundingClientRect();
    hoverEl.hidden = false;
    hoverEl.textContent = describePick(model, pick);
    // Under a finger the tag goes above it — down and to the right is under
    // the hand — and is held inside the canvas, a phone being narrow.
    const [x, y] = [e.clientX - rect.left, e.clientY - rect.top];
    if (e.pointerType === "touch") {
      const w = hoverEl.offsetWidth;
      hoverEl.style.left = `${Math.max(4, Math.min(rect.width - w - 4, x - w / 2))}px`;
      hoverEl.style.top = `${Math.max(4, y - 44 - hoverEl.offsetHeight)}px`;
    } else {
      hoverEl.style.left = `${x + 12}px`;
      hoverEl.style.top = `${y + 12}px`;
    }
  }
  cv.addEventListener("pointerleave", () => { hoverEl.hidden = true; });

  function handles() {
    return {
      model,
      view,
      // The command surface captures the source of a tool defined at the
      // command line, and the entry text is something only the evaluator
      // knows. `repl` is initialised on the next line but this is only ever
      // called from inside an entry, by which time it exists.
      currentEntry: () => repl.entry,
      // The tool-voice channel, for `open()` mentioning what a file carries.
      log: (line: string) => log(line, "out"),
      toolSources,
      optionMemory,
      // Measured fresh on every ask, not cached: the window can be resized at
      // any time, and a size read once at startup would put "the middle of the
      // view" somewhere that is no longer the middle of what is on screen.
      viewSize: (): [number, number] => {
        const r = cv.getBoundingClientRect();
        return [r.width, r.height];
      },
      arm: (name: string, options?: Record<string, unknown>, target?: string) => engine.arm(name, options, target),
      pick: () => engine.hover?.name ?? null,
      // The canvas's selection, for `sel()` and `select(...)`: UI state, so
      // typed through `submit` it brackets an action that records nothing.
      selection: (names?: readonly string[]) => {
        if (names !== undefined) engine.select(names);
        return [...engine.selection.prune(model)];
      },
      snapping: (on?: boolean) => {
        if (on !== undefined) engine.snapping = on;
        return engine.snapping;
      },
      glyphs: (on?: boolean) => {
        if (on !== undefined) {
          engine.glyphsOn = on;
          // A hover held on a glyph that has just been switched off would leave
          // the tag naming something no longer on screen, and the entities it
          // constrains lit with nothing to explain why.
          if (!on && engine.hover?.kind === "relation") engine.hover = null;
          render();
        }
        return engine.glyphsOn;
      },
      cancel: () => engine.cancel(),
      // How solids are shown. Typed through `submit` like everything, and so
      // bracketed as a user action that records nothing: the model is
      // untouched, as for the layout and the camera.
      viewMode: (mode?: string) => {
        if (mode === undefined) return viewMode;
        if (!isViewMode(mode)) throw viewModeError(mode);
        viewMode = mode;
        rememberViewMode(browserStorage(), mode);
        // A hover on something the new mode hides would leave it lit, and its
        // tag up, with nothing on screen under the cursor.
        engine.hover = null;
        hoverEl.hidden = true;
        render();
        return viewMode;
      },
      refresh: () => { solveAndRender(); },
      // The interface size and which panes are shown: the viewer's, like the
      // layout — typed through `submit`, recording nothing.
      ui: (options?: unknown) => uiCommand(options),
      // The chrome's arrangement. Typed through `submit` like everything else,
      // and so bracketed as a user action — which records nothing, because the
      // model is untouched: layout is the viewer's, not the drawing's.
      layout: (command?: string) => {
        if (command === undefined) return panels.report();
        if (command === "reset") return panels.reset();
        throw new Error(`layout() reports and layout("reset") restores the defaults; "${command}" is neither`);
      },
      solve: () => solveAndRender(),
      // Opening a file is one undo step, so opening the wrong one is one Ctrl+Z
      // from harmless. (Typed at the command line this is already inside
      // `submit`'s bracket; the bracket here is what covers `openFile()`, whose
      // work happens in an event handler long after the entry returned.)
      openModel: (json: string) => asUserAction(() => swapModel(openModelText(json, APP_DIM))),
      undo: () => step("undo"),
      redo: () => step("redo"),
      download: (json: string, filename: string) => {
        const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
      },
      // The document's commands, and the name line the app menu reads.
      newFile: () => files!.newFile(),
      openFile: () => files!.openFile(),
      saveFile: () => files!.saveFile(),
      shareFile: () => files!.shareFile(),
      document: () => files!.document(),
    };
  }

  /**
   * The document (docs/plans/files.md). `document()` is the host function the
   * app menu reads for its name line; the four commands are typed through
   * `submit` like every menu item.
   */
  files = new Files({
    text: () => saveModel(model, true, toolSources.all()),
    snapshot,
    // A file from any door — the input, a picker, a drop, the desktop — is
    // opened the way `open()` opens one: one undo step, and what the file
    // carries said through the same function, or the doors would drift into
    // different answers to what opening a file means. Nothing is evaluated.
    open: (text) => {
      asUserAction(() => swapModel(openModelText(text, APP_DIM)));
      for (const line of carryIntoSession(savedTools(text), toolSources)) log(line, "out");
    },
    fresh: () => asUserAction(() => swapModel(new Model(APP_DIM))),
    log: (line, cls) => log(line, cls ?? "out"),
    phone: coarse,
    autosave,
    restored: restored?.record ?? null,
  });

  // A new version waiting is offered beside the status, never imposed: a tap
  // saves the drawing, then reloads into it (src/update.ts).
  watchForUpdates({ button: document.getElementById("update") as HTMLButtonElement, flush: () => files!.flush() });

  const repl = new Repl(neocadScope(handles()));

  /**
   * `ui()` — the interface size and the panes. `ui({ scale: 0.8 })` sets the
   * size (held to 60–160 %, and said so when held), `ui({ scale: "default" })`
   * goes back to this device's; `ui({ hide: "log" })` and `ui({ show: "log" })`
   * — a name or a list of names — hide and show panes. `ui()` says what is in
   * force. The app menu types exactly these. Nothing journals: it is this
   * viewer's, on this device.
   */
  function uiCommand(options?: unknown): string {
    if (options === undefined) return describeUi();
    if (!options || typeof options !== "object" || Array.isArray(options)) throw new Error(UI_USAGE);
    const o = options as Record<string, unknown>;
    const unknown = Object.keys(o).filter((key) => !["scale", "show", "hide"].includes(key));
    if (unknown.length) throw new Error(`ui() takes scale, show and hide — ${unknown.map((u) => JSON.stringify(u)).join(", ")} is not one. ${UI_USAGE}`);
    const said: string[] = [];
    if ("scale" in o) {
      if (o.scale === "default" || o.scale === null) setScale(null);
      else {
        const c = clampScale(o.scale);
        if (c === null) throw new Error(`ui({ scale }) takes a number, 0.6 to 1.6, or "default" — ${JSON.stringify(o.scale) ?? String(o.scale)} is neither`);
        if (c !== o.scale) said.push(`${o.scale} held to ${formatScale(c)}`);
        setScale(c);
      }
    }
    for (const [key, shown] of [["show", true], ["hide", false]] as const) {
      if (!(key in o)) continue;
      const ids = Array.isArray(o[key]) ? o[key] as unknown[] : [o[key]];
      for (const id of ids) {
        if (typeof id !== "string") throw new Error(`ui({ ${key} }) takes a pane's name or a list of them — ${JSON.stringify(id)} is not one`);
        panels.setShown(id, shown);
      }
    }
    syncToolbar();
    return [...said, describeUi()].join("\n");
  }

  function describeUi(): string {
    const panes = panels.panes();
    const hidden = panes.filter((p) => !p.shown).map((p) => p.id);
    // The device's 100 % said in its parts, so a person can see why their
    // phone draws what it draws: the form factor and the text size.
    const why = `100% here is ${deviceUi}× a desktop's: ${coarse ? (formFactor(device) === 1.3 ? "a phone" : "a tablet") : "a mouse"} ` +
      `${formFactor(device)}, text size ${textFactor(device).toFixed(2)}`;
    return `interface ${formatScale(uiScale)} (${why})` +
      `; panes ${panes.map((p) => p.id).join(", ")}` + (hidden.length ? `; hidden ${hidden.join(", ")}` : "; all shown");
  }

  /**
   * The interface size, set — or with null forgotten, back to the device's
   * default — and everything that draws told: the panels and their
   * stylesheet, the options panel, the logo, and the view the drawing's marks
   * are sized from.
   */
  function setScale(s: number | null): void {
    rememberScale(browserStorage(), s);
    uiScale = s ?? 1;
    metrics = metricsAt(drawnScale());
    view.ui = metrics.scale;
    applyChrome();
    optionsPanel.setMetrics(metrics);
    panels.setMetrics(metrics);
    render();
  }

  /**
   * The app menu, opened by the logo, through the same seam as every other
   * menu: each control types its line into `submit`. Its File items type the
   * files package's commands (docs/plans/files.md), and are off with their
   * reason until the command line's scope has them.
   */
  const appMenu = new AppMenu(document.getElementById("appmenu")!, logoEl, {
    run: (command) => submit(command),
    // The files package's host function (docs/plans/files.md): the name and
    // the unsaved dot. Untitled and clean only before it exists.
    document: () => files?.document() ?? UNTITLED,
    defined: (name) => typeof repl.scope[name] === "function",
    scale: () => uiScale,
    panes: () => panels.panes(),
    viewMode: () => viewMode,
    viewModes: VIEW_MODES,
    stamp: document.getElementById("buildstamp"),
    repository: "https://github.com/BrotherCreamy/zerocad",
  });

  /**
   * Points everything at a different model. The tool engine and the command
   * scope both hold their own reference, so both are re-pointed here — the
   * REPL's names are redefined rather than the whole REPL being rebuilt, so
   * anything the user bound at the command line survives opening a file.
   */
  function swapModel(next: Model) {
    model = next;
    // An open menu names entities of the model being replaced, so every command
    // on it is about to be a lie. Undo swaps the model, which is exactly the
    // case: Ctrl+Z with a menu open must not leave `del("l3")` offered for an
    // `l3` that no longer exists.
    menu.close();
    engine.cancel();
    engine.model = next;
    repl.define(neocadScope(handles()));
    exposeDebugHook();
    solveAndRender();
    // Undo, redo, an open and a new all arrive here: the autosave hears of each.
    files?.changed();
  }

  function exposeDebugHook() {
    (window as unknown as { __neocad: unknown }).__neocad = { model, engine, repl, render, files, faces: faceLayer ? "depth" : "painter's" }; // debug/automation hook
  }
  exposeDebugHook();

  const history: string[] = [];
  let historyAt = 0;

  /** A feature's lines, typed as one user action — see `onPerform`. Settles whether every line ran. */
  async function perform(steps: FeatureStep[]): Promise<boolean> {
    beginUserAction();
    let refused: string | null = null;
    try {
      refused = await runSteps(model, steps, (line) => submit(line.text));
    } finally {
      endUserAction();
    }
    // A step refused before it was typed (a region rubbed out under the
    // selection) was never logged by `submit`: said here, as the tool's.
    if (refused !== null && refused !== TYPED_REFUSAL) log(refused, "err");
    solveAndRender();
    return refused === null;
  }

  /**
   * One entry, typed. Settles with null once it has run, or — for `perform`,
   * which must stop at the first refusal — `TYPED_REFUSAL` when it was refused,
   * which it has already said in red by then.
   */
  async function submit(src: string): Promise<string | null> {
    log(`> ${src}`, "in");
    history.push(src);
    historyAt = history.length;

    // A bare tool name arms it — the one shortcut, and only when the whole
    // entry is an identifier that is actually a registered tool.
    if (/^[A-Za-z_$][\w$]*$/.test(src) && getToolCtor(src)) {
      try {
        engine.arm(src);
        log(`armed: ${src}`, "out");
      } catch (err) {
        log(String(err instanceof Error ? err.message : err), "err");
        syncToolbar();
        return TYPED_REFUSAL;
      }
      syncToolbar();
      return null;
    }

    // One entry is one undo step — if it changed anything. The comparison is
    // what decides: `ls()` and `help()` leave the model identical and record
    // nothing, `pt(0,0)` does not and records one. An entry that draws four
    // points is deliberately one step too, because one thing was typed.
    beginUserAction();
    let changed = false;
    let ok = true;
    try {
      const result = await repl.eval(src);
      ok = result.ok;
      for (const line of result.output) log(line, "out");
      if (!result.ok) log(`${result.error!.name}: ${result.error!.message}`, "err");
      else if (result.value !== undefined) log(fmt(result.value), "out");
    } finally {
      changed = endUserAction();
    }

    // **An entry that changed the model re-solves**, the way a tool, a drag and
    // `del` already do. Without it `dist("a","b",50)` added its residual, redrew
    // and left the header reading `SOLVED` over a drawing that plainly violated
    // what had just been typed — the stale-readout family this project has been
    // bitten by before. Onshape's continuous solve, and cellwork's, both agree.
    //
    // Which entries those are is *not* enumerated anywhere: it is the undo
    // bracket's own snapshot comparison, reused. So `ls()` and `help()` cost
    // nothing, and any relation anyone ever adds is covered without being
    // listed. A redundant `solve()` typed afterwards is harmless, which is why
    // the specs that still type one were left alone.
    if (changed) solveAndRender();
    else render();
    return ok ? null : TYPED_REFUSAL;
  }

  cmdEl.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp" && history.length) {
      e.preventDefault();
      historyAt = Math.max(0, historyAt - 1);
      cmdEl.value = history[historyAt] ?? "";
    } else if (e.key === "ArrowDown" && history.length) {
      e.preventDefault();
      historyAt = Math.min(history.length, historyAt + 1);
      cmdEl.value = history[historyAt] ?? "";
    } else if (e.key === "Enter") {
      const src = cmdEl.value.trim();
      cmdEl.value = "";
      // An empty line is the feature's: Enter confirms what is picked, as it
      // does with the focus anywhere else. With text, the text is the entry.
      if (src) void submit(src);
      else if (engine.confirm()) syncToolbar();
    }
  });

  /**
   * **Enter confirms the armed feature** — the owner's "hit the tickbox or
   * enter" — wherever the focus is, but for something that takes typing
   * (a text field's Enter is its own; the options panel's commits the field
   * and then confirms, see panels.ts; the command line's is above) and a
   * button, whose Enter presses it. Pressing a toolbar button by Enter would
   * arm the tool afresh and drop what was picked, so it is prevented when a
   * feature takes the key.
   */
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.ctrlKey || e.metaKey || e.altKey) return;
    const at = document.activeElement as HTMLElement | null;
    if (at && (at.isContentEditable || at instanceof HTMLInputElement || at instanceof HTMLTextAreaElement)) return;
    if (!engine.confirm()) return;
    e.preventDefault();
    syncToolbar();
  });

  /**
   * Escape, and the panel's ✗: a feature's picks first (the tool stays
   * armed), then the tool — see `ToolEngine.escape`.
   */
  function escape() {
    const did = engine.escape();
    syncToolbar();
    log(did === "cleared" ? "selection cleared" : "cancelled", "out");
  }

  /**
   * Escape abandons whatever gesture is in progress. **On `window`, not on the
   * command input**, for the reason the box select found: pressing the mouse on
   * the canvas blurs the input (a canvas is not focusable, so focus falls to
   * the body), so a binding on the input is deaf during exactly the gestures
   * Escape exists to abandon. It still fires while the command line has focus,
   * because keydown bubbles — this widens where the key works and narrows
   * nothing.
   *
   * No carve-out for text in the input: Escape has never meant anything to a
   * text field here, so there is nothing to be ambiguous with.
   */
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    // The menu first, and then nothing else. Escape means "undo the last thing
    // that appeared", and with a menu on screen that is the menu — cancelling
    // the gesture underneath it as well would abandon a half-drawn rectangle
    // that the user was only right-clicking to look away from.
    if (menu.close() || appMenu.close()) {
      log("menu closed", "out");
      return;
    }
    escape();
  });

  /**
   * **Delete deletes the selection**, typed: `del("l1", "l2")` through
   * `submit`, as the menu's Delete types it — logged, recalled, one undo step.
   * Never while a text field has the focus, empty or not: the key is the
   * field's there, and a command line just emptied by the same key would be
   * one keystroke from deleting geometry nobody meant to touch. A click on the
   * canvas — which is how a selection is made — takes the focus off the
   * command line (a canvas is not focusable), so the key is the drawing's
   * exactly when the hand has just been on it. Only Delete, for the same
   * reason: Backspace is what empties a line.
   */
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Delete" || e.ctrlKey || e.metaKey || e.altKey) return;
    const at = document.activeElement as HTMLElement | null;
    if (at && (at.isContentEditable || at instanceof HTMLInputElement || at instanceof HTMLTextAreaElement)) return;
    const names = engine.selection.prune(model);
    if (!names.length || engine.active) return;
    e.preventDefault();
    void submit(`del(${names.map((n) => JSON.stringify(n)).join(", ")})`);
  });

  /**
   * **Typing with nothing editable focused types into the command line.** A
   * press on the canvas, the toolbar or a panel's strip leaves the focus on the
   * body or where it was, and the first keystroke after it should not vanish.
   * Focusing the input during `keydown` is enough: the character is inserted
   * into whatever holds the focus once the keydown has been dispatched.
   *
   * Only printable keys without a modifier — Escape and the arrows keep their
   * own meanings, and Ctrl+Z never gets this far (see below) — and never when
   * something editable already has the focus, which is that thing's keystroke.
   */
  window.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
    const at = document.activeElement as HTMLElement | null;
    if (at && (at.isContentEditable || at instanceof HTMLInputElement || at instanceof HTMLTextAreaElement)) return;
    cmdEl.focus();
  });

  /**
   * **Ctrl+Z (Cmd+Z) always undoes the drawing, and Ctrl+Y and Ctrl+Shift+Z
   * (Cmd+⇧Z) always redo it — wherever the focus is, whatever is on screen.**
   * The owner's direction, 2026-10-29: "why does ctrl+z and ctrl+y not work?
   * should work and be bulletproof".
   *
   * **Capture phase on `window`**, which is the first place a keydown is
   * dispatched to, ahead of every target and bubble listener in the document —
   * and `stopPropagation` there, so nothing below it (the command input, a
   * panel, a button, the menu, whatever is added later) can see the chord,
   * let alone swallow it. Only these chords are stopped; every other key
   * carries on to whatever it was going to.
   *
   * **No carve-out for text in the command line any more.** There was one: with
   * uncommitted text in the box, Ctrl+Z was handed to the browser's text undo,
   * on the theory that undoing the model mid-sentence was the worse mistake.
   * Measured, it was the one case in which Ctrl+Z "did not work" — the box
   * emptied and the drawing stayed — and the owner overruled it. So the key is
   * the drawing's, `preventDefault` stops the browser's text undo (the
   * keystroke cannot empty the box either), and the half-typed text simply
   * stays where it was. Anything already submitted is still one ↑ away.
   */
  window.addEventListener("keydown", (e) => {
    const chord = historyChord(e);
    if (!chord) return;
    e.preventDefault();
    e.stopPropagation();
    log(step(chord), "out");
  }, true);

  /**
   * **Ctrl+S (⌘S) types `saveFile()` and Ctrl+O (⌘O) types `openFile()`**,
   * the browser's Save Page and Open File prevented — through `submit`, so
   * the log shows the command and a menu item, the key and typing are one
   * act. Wherever the focus is, as Ctrl+Z is: neither key means anything to
   * a text field, and what is half-typed in the command line stays. Not
   * while an input method is composing (see `fileChord`), whose key it is.
   * Capture phase, as the history chord, so nothing below can swallow it.
   */
  window.addEventListener("keydown", (e) => {
    const chord = fileChord(e);
    if (!chord) return;
    e.preventDefault();
    e.stopPropagation();
    void submit(chord === "save" ? "saveFile()" : "openFile()");
  }, true);

  // Drops, the desktop's launch queue and the autosave's hidden-flush.
  files.install();

  render();
  statusLine.show("ready", "ready — type help(), a tool name, or any expression");
  log("type help() for the command surface");
  // **The keyboard stays away until asked for.** A focused field on iOS is a
  // keyboard over the drawing (raised by the next tap, if not by this), so
  // under a finger the command line waits to be tapped, as any field does.
  if (!coarse) cmdEl.focus();
}

// Before the kernel loads, so a pinch during the wait cannot zoom the page
// either (pagelock.ts).
lockPage(document);

main().catch((e) => {
  statusLine.show("error", "ERROR — see log");
  log(String((e && e.stack) || e), "err");
  console.error(e);
});
