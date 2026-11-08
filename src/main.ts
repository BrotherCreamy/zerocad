// Browser entry point: the kernel, the model, the tool engine and the REPL
// wired to a canvas, with the chrome — toolbar, log, command line — floating
// over it as panels (see panels.ts). The command line is the real thing —
// a scoped evaluator over the command surface in replenv.ts — rather than
// the tool-name-only stand-in it replaced. A bare tool name still arms that
// tool, because that shortcut is genuinely the most common entry and reads
// better than arm("rectangle"); anything else is evaluated.

import { ensureKernelLoaded } from "./kernel/problem.ts";
import { Model, ORIGIN, isClosedEntity } from "./model.ts";
import { open as openModelText, save as saveModel, savedHead, savedTools } from "./persist.ts";
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
import { describePick, describeRelation, type Pick } from "./picking.ts";
import { sampledWorld, screenCurve } from "./projection.ts";
import { ContextMenu, menuFor } from "./menu.ts";
import { toolUnavailable } from "./toolavail.ts";
import { AXIS_INKS, frameArmPx, frameMarker } from "./framemarker.ts";
import { LOCKED, constrainedBy, defineGlyphAnchor, type Glyph } from "./glyphs.ts";
import { ENGINE_TOOLS, HAND, SELECT, armedLine, getToolCtor, groupCurrent, toolAlias, toolSummary, toolbarButtons, type ToolbarButton } from "./tools/tool.ts";
import { activeWorkbench, fileMenuItems, getWorkbench, listWorkbenches, onWorkbench, setActiveWorkbench, DEFAULT_WORKBENCH } from "./modules.ts";
import { WorkbenchFiles, indexedDbWorkbenches } from "./workbenchhost.ts";
import {
  ACTIONS, ActionStrip, FINE, OptionsPanel, Panels, Toolbar, actionKey, browserStorage, cornerBox, cornerRoom, defaultLayout, logoBox, panelsLine, scaledMetrics,
  TOUCH_TARGET, touchMetrics, type Insets, type Layout, type Metrics, type Size,
} from "./panels.ts";
import { Tooltips } from "./tooltip.ts";
import {
  clampScale, deviceScale, formFactor, formatScale, recallScale, rememberScale, textFactor, textSource, type Device,
} from "./uiscale.ts";
import { GUIDE_NOTE_MS, STATUS_FADE_MS, STEP_NOTE_MS, StatusLine, diagnosisLine } from "./statusline.ts";
import { AppMenu, UNTITLED } from "./appmenu.ts";
import { LogTail } from "./logtail.ts";
import { Organiser, organiserSections, rowMenu, surfaceMenu } from "./organiser.ts";
import { surfaceNameOf } from "./surfaces.ts";
import { logoSvg } from "./logo.ts";
import { GroupMemory, OptionMemory, declaredOptions, unitSymbol, type OptionValue } from "./tools/options.ts";
import { toolIcon } from "./tools/icons.ts";
import { depth, uiOf, viewAxes, worldToScreen } from "./view.ts";
import { arcSamples, arcSegments, frameReach } from "./arcgeom.ts";
import { curveFrame } from "./curveplane.ts";
import { createFaceLayer, paintFaces } from "./facelayer.ts";
import { Bodies } from "./bodies.ts";
import { describeEdge, edgeAt, edgePoints, edgesInBox } from "./kerneledges.ts";
import { solidsClient, solidsLicence } from "./solidshost.ts";
import { kernelBody } from "./kernelbrep.ts";
import type { KernelSolid } from "./step.ts";
import { SOLID_EDGE, visibleFaces } from "./faces.ts";
import { hiddenInk, inSight, inkRuns, occlusion, type Occlusion } from "./occlusion.ts";
import { VIEW_MODES, drawsFaces, isViewMode, opaque, recallViewMode, rememberViewMode, viewModeError, type ViewMode } from "./viewmode.ts";
import { entityDrawn, glyphDrawn, quietEntities, revealed, solidEdges } from "./quiet.ts";
import { activePlane, focusOf, outOfFocusInk, planePatch, type ActivePlane } from "./activeplane.ts";
import { ModeChip, chipParts, doneCommand, guideText, lookCommand, planeMenu } from "./modechip.ts";
import { frameBasis } from "./relations/refs.ts";
import { lockPage } from "./pagelock.ts";
import { BackStack } from "./backstack.ts";
import { keyboardTop, lifted } from "./keyboard.ts";
import { Installer, type InstallWindow } from "./install.ts";
import type { Diagnosis, Entity } from "./model.ts";
// The app is its modules (docs/plans/workbenches.md): every built-in module,
// in the order that orders the tray, the menu, the replay table and help()
// (modules/builtin.ts). A workbench added from the device is one more, loaded
// after them.
import "./modules/builtin.ts";

/**
 * The status beside the logo — the verdict and the step note — and the rules
 * for when each fades (statusline.ts). The element ids are what they were in
 * the header: `#status`, `#stepnote`.
 */
const statusLine = new StatusLine(document.getElementById("status")!, document.getElementById("stepnote")!);
/** The diagnosis beside the verdict (`showDiagnosis`): "3 free", a conflict's or a redundancy's names. */
const diagnosisEl = document.getElementById("diagnosis")!;
/** The mode chip beside it (modechip.ts): where · what · next. */
const modeEl = document.getElementById("mode")!;
let diagnosisFade: ReturnType<typeof setTimeout> | undefined;
/** The last diagnosis (`Model.diagnose`), read by the drawing: what is free. Null before the first solve. */
let diagnosis: Diagnosis | null = null;
/** The relations the last solve said cannot all hold: drawn in the conflict ink. */
let conflicted = new Set<string>();
/** What the log last said about a conflict, so a re-solve does not say it again. */
let conflictSaid = "";
/** Whether free entities wear the free ink (`freeink(false)` turns it off, as `glyphs(false)` the marks). */
let freeInkOn = true;
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
const openGroupEl = document.getElementById("opengroup")!;
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
  // Android's system font scale (docs/plans/android.md): Chrome reports it as
  // `env(preferred-text-scale)`, a plain number, which script can read only
  // through a length — 100 px times it, with a fallback of 0 for a browser
  // that does not know the variable. Read off the probe's width, not its type
  // size: Chrome applies the system scale to type only by text autosizing,
  // which never acts on a probe (uiscale.ts's `textFactor` has the measurement).
  probe.style.cssText = "position:absolute;visibility:hidden;height:0;width:calc(100px * env(preferred-text-scale, 0))";
  const reported = probe.getBoundingClientRect().width / 100;
  const textScale = reported > 0 ? reported : null;
  probe.remove();
  const shortSide = Math.min(screen.width, screen.height) || Math.min(innerWidth, innerHeight);
  return { coarse, shortSide, appleBody, defaultFont, textScale };
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
// A finger's target is measured against this device's form factor: 44 at its
// 100 % with the default text size, larger with a larger one, and following
// the spin box (panels.ts's `target`).
const metricsAt = (k: number): Metrics => (coarse ? touchMetrics(k, formFactor(device)) : scaledMetrics(FINE, k));
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
  // The finger's target (panels.ts's `target`): every hit box under a coarse
  // pointer is this, so it follows the interface size as the faces do.
  root.setProperty("--target", `${metrics.hit || TOUCH_TARGET}px`);
  logoEl.innerHTML = logoSvg(metrics.logo);
  placeCorner();
}

/**
 * The status, just right of the logo, in the logo's row — and never over a
 * pane (docs/plans/everything-fits.md): it wraps within the room the layout
 * leaves it (`cornerRoom`), which is the whole row while the panes are where
 * the defaults put them, and stops short of one the viewer has dragged into
 * the row. Placed again after every placement of the panels.
 */
let cornerLayout: { layout: Layout; area: Size } | null = null;
/** Puts the panel being typed into back above the keyboard after the panels are placed (set in main(); keyboard.ts). */
let relift: () => void = () => {};
/** Says a locked pane's refusal in the chip's guidance (set in main(), once the chip is). */
let sayLocked: (text: string) => void = (text) => statusLine.note(text);
function placeCorner(): void {
  const i = insets();
  const box = logoBox(metrics);
  const room = cornerLayout ? cornerRoom(cornerLayout.layout, cornerLayout.area, box) : null;
  cornerEl.style.left = `${i.left + box.w}px`;
  cornerEl.style.top = `${i.top}px`;
  cornerEl.style.minHeight = `${Math.min(box.h, room?.h ?? box.h)}px`;
  cornerEl.style.maxWidth = room ? `${room.w}px` : `calc(100% - ${i.left + i.right + box.w + 8}px)`;
  cornerEl.style.maxHeight = room ? `${room.h}px` : "";
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

/**
 * **One tooltip for every control that is an icon or a short word**
 * (tooltip.ts; the owner: *"when I hover over tools, I should see a
 * tooltip"*): after a short hover under a mouse, by a hold under a finger.
 * Made before the panels, whose strips are controls too, and handed to each
 * piece of chrome as the function that attaches one — none of them knows the
 * tooltip exists beyond that. Kept inside the window less its safe-area
 * insets, so never under a notch or the home indicator.
 */
function tooltipBounds() {
  const i = insets();
  const [w, h] = [document.documentElement.clientWidth, document.documentElement.clientHeight];
  return { x: i.left, y: i.top, w: Math.max(0, w - i.left - i.right), h: Math.max(0, h - i.top - i.bottom) };
}
const tooltips = new Tooltips(document.getElementById("tooltip")!, { bounds: tooltipBounds });
const tooltip = tooltips.attach;

/**
 * The keys that do what a button does, for its tooltip: the Hand is Space
 * held (and Select, with a tool armed, is Escape); the action strip's are
 * `actionKey`'s, ⌘ on Apple's systems — an iPad's keyboard included — and
 * Ctrl elsewhere. Asked of the platform and of the user agent too, where a
 * browser reports a generic platform (and an emulated iPhone keeps its host's).
 */
const apple = /Mac|iPhone|iPad|iPod/.test(navigator.platform ?? "") || /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);
const TOOL_KEYS: Readonly<Record<string, string>> = { [HAND]: "hold Space", [SELECT]: "Esc" };

/**
 * **Install app** (install.ts; docs/plans/android.md): the browser's offer,
 * kept from the moment the page loads — `beforeinstallprompt` can come before
 * the kernel has — and made from the logo menu. An iPhone or iPad (an iPad
 * says it is a Mac with a touch screen) has no offer; the menu says how
 * Safari installs instead.
 */
const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
const installer = new Installer(window as unknown as InstallWindow, { ios });

/** The logo's: no command, it opens the menu. */
tooltip(logoEl, () => ({ name: "ZeroCAD", summary: "Opens the menu: files, interface size, panes and view" }));

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
 * Which member each toolbar group armed last — the tool its button shows
 * (docs/plans/toolbar-groups.md). The viewer's, kept as their option values
 * are and beside them, never in the engine or the journal.
 */
const groupMemory = new GroupMemory(browserStorage());

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
 * chrome in a heap while the WASM downloads. The toolbar is the one tray: a line
 * (or two, where one will not fit) of however many tools are registered *when it is asked* — the
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
/**
 * The tray's buttons: the current workbench's tools in their groups
 * (docs/plans/workbenches.md) — `part`, the default, is every tool, today's
 * tray exactly. Typed names are not filtered: a typed call is not a toolbar.
 */
function trayButtons(): ToolbarButton[] {
  const bench = activeWorkbench();
  return toolbarButtons((t) => onWorkbench(bench, t));
}

const panels = new Panels(
  document.getElementById("viewwrap")!,
  (area) => defaultLayout(area, trayButtons().length, metrics),
  browserStorage(),
  { toolbar: () => trayButtons().length, ...(actionsEl ? { actions: () => ACTIONS.length } : {}) },
  {
    check: Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV),
    fitted: { options: { size: () => optionsShown(), beside: "toolbar" } },
    metrics,
    // The logo is a panel nothing moves: what is pushed into the corner stops
    // against it, and the way into the app menu is never under anything.
    fixed: { logo: { el: logoEl, size: () => logoBox(metrics) } },
    insets,
    tooltip,
    // The corner keeps clear of wherever the panes now are.
    onShow: (layout, area) => { cornerLayout = { layout, area }; placeCorner(); relift(); },
    // A drop the resolver could not make sound commits nothing, and says so
    // where the eye already is for what just happened (docs/plans/panels-preview.md).
    onRefused: (text) => statusLine.note(text),
    // Locked (docs/plans/panels-overlay-lock.md): a press on a strip's place
    // says why nothing moves, in the chip's guidance once the chip is built;
    // a rotation that made the locked layout re-fit says so in the status.
    onLocked: (text) => sayLocked(text),
    onRefit: (text) => statusLine.note(text, 5000),
  },
);
// The insets change without the window resizing — a rotation does both, but
// an emulator's override, or iOS settling its bars, may do only this. The
// probe's border box is its padding, so it is what changes.
new ResizeObserver(() => { placeCorner(); panels.apply(); }).observe(probeEl, { box: "border-box" });

/**
 * The log's see-through form (logtail.ts): its last three lines over the
 * drawing, read off the docked log's own lines and their stamps.
 */
const logTail = new LogTail(document.getElementById("otail")!, logEl);

function log(msg: string, cls?: string) {
  const d = document.createElement("div");
  d.textContent = msg;
  if (cls) d.className = cls;
  // When it was said: what the see-through log fades it by.
  d.dataset.at = String(Date.now());
  logEl.appendChild(d);
  logEl.scrollTop = logEl.scrollHeight;
  logTail.sync();
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
 * A frame's name beside its marker: the grey-blue every frame's arms were
 * drawn in before they were coloured (the default's lighter shade), now the
 * name's alone — the arms say which axis is which (`AXIS_INKS`).
 */
const FRAME_NAME_INK = "#9fb4c7";

/**
 * Construction geometry's ink and width (docs/plans/construction.md): a muted
 * teal, a hue no other mark uses — not the sketch's grey-blue dimmed, which
 * would read as the hidden view's ink — and under a pixel wide, against the
 * sketch's 1.4. Drawn solid, never dashed: a dash means selection here.
 */
const CONSTRUCTION = "#679b91";
/**
 * **The free ink** (docs/plans/sketch-relations.md): an entity some motion can
 * still move with every relation holding — Onshape's blue for what is not yet
 * defined — where a fully held one keeps the sketch's own pale ink. A clear
 * blue, saturated where the held ink is grey, so the two read apart at a
 * glance and neither is the hover's amber or the selection's violet.
 */
const FREE = "#5aa2ff";
/** The sketch's own ink: what a held entity is drawn in. */
const HELD = "#afc6d9";
/** A glyph whose relation cannot hold with the others: the conflict's red, the status's. */
const CONFLICT_INK = "#e0605c";
/** A redundant relation's glyph: the softer orange the status says it in. */
const REDUNDANT_INK = "#d99a6c";
/**
 * **The mode's accent** (docs/plans/mode-feedback.md): the tools' green
 * (region.ts's `REGION_GREEN`, the snap marker's), which is the sketch tool's
 * colour — what a gesture has placed and not finished with, and the outline of
 * the plane being sketched on.
 */
const ACCENT = "#55c07a";
/** What an armed tool's next pick could take: the accent made paler, lit but not yet chosen. */
const TAKES = "#9fdcb2";
/** The plane's face tinted: the accent lighter, translucent — and fainter where it is behind the solid. */
const PLANE_TINT = "rgba(143, 224, 168, 0.3)";
const PLANE_TINT_BEHIND = "rgba(143, 224, 168, 0.08)";
/** A frame's plane, as a patch: the tint fainter still, its grid fainter than that, its edge half the accent. */
const PATCH_TINT = "rgba(143, 224, 168, 0.06)";
const PLANE_GRID = "rgba(143, 224, 168, 0.16)";
const PATCH_EDGE_ALPHA = 0.55;
/** The plane's outline: a little heavier than the sketch's 1.4, so the face reads as the one in use. */
const PLANE_EDGE_PX = 1.8;
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
  /** The organiser pane, once it is built below; the drawing pass syncs it (`syncOrganiser`). */
  let organiser: Organiser | null = null;
  if (restored) {
    const r = restored.record;
    log(`restored ${r.name}${r.dirty ? " (unsaved changes)" : ""} — autosaved on this device`, "out");
    for (const line of carryIntoSession(savedTools(r.text), toolSources)) log(line, "out");
  }
  const view: View = { ox: 0, oy: 0, scale: 3, ui: metrics.scale };
  sizeCanvas();

  // The solid kernel (docs/plans/solids-kernel.md): bodies of two or more
  // features — a boss added, a hole cut — are the kernel's, in a Worker that
  // is started the first time one needs it. Its answers arrive later and
  // redraw; until then the last good body stands (bodies.ts).
  const solidBodies = new Bodies(solidsClient(), () => render());
  /** The kernel's report as last said, so a line is logged once and not every frame. */
  let solidSaid = "";
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
    // The kernel's bodies, in place of their features' own faces: read the
    // program off the model (sent only when it changed) and take the last
    // good answer.
    // A tool on kernel edges (fillet, chamfer) has every body built by the
    // kernel while it is armed, a single extrude included, so it has edges.
    solidBodies.everything = engine.active?.kernelEdges === true;
    solidBodies.sync(model);
    const kernelSolid = solidBodies.drawn();
    sayKernel();
    if (faceLayer) {
      if (faced) faceLayer.draw(model, view, r.width, r.height, replaced, kernelSolid);
      else faceLayer.clear();
    } else if (faced) {
      paintFaces(g, model, view, replaced, kernelSolid);
    }
    // A wireframe has no faces to carry the kernel's edges: drawn here, in the sketch's ink.
    if (!faced) wireKernelEdges();

    // What of the drawing is behind a face — asked of the same faces on the
    // CPU (occlusion.ts), whichever renderer drew them. **Shaded, a solid is
    // opaque** (the owner: "It should be opaque"): what is behind a face is not
    // drawn, and the engine is handed the same answer so it is not picked,
    // snapped to or boxed either — one answer a frame, for the eye and the
    // hand. In the hidden mode it is drawn, in a dimmed ink, and everything
    // stays aimable. No solid (or no faces), no question: a plain sketch draws
    // exactly as it always has, at no cost.
    const faces = faced && model.features.size ? visibleFaces(model, view, replaced, kernelSolid) : [];
    occluded = faces.length ? occlusion(faces, view) : null;
    hides = occluded && opaque(viewMode) ? occluded : null;
    engine.occlusion = hides;

    // **The plane being sketched on, drawn** (activeplane.ts; docs/plans/
    // mode-feedback.md): the face it was taken from tinted, a frame's plane a
    // patch with a faint grid — under the drawing, over the faces, in every
    // view, and dimmed where it is behind the solid. With it, what is held on
    // the plane is in focus and the rest is drawn one step dimmed. Drawing
    // only: none of it reaches the pick.
    // The work plane is drawn and focused on; a default frame on its own is
    // only named (activeplane.ts): it draws heavier already, and the drawing
    // typed under it is held by no relation.
    plane = activePlane(model, view.scale, model.workPlane);
    named = plane ?? activePlane(model, view.scale, model.defaultFrame);
    focus = focusOf(model, plane);
    drawActivePlane(plane);
    placedNow = new Set(engine.placed());
    takesNow = new Set(engine.takes());

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
      : staged(name) ?? focused(name, model.isConstruction(name) ? CONSTRUCTION : solid.has(name) ? SOLID_EDGE : inkOf(name)));
    const weight = (name: string) => (lit.has(name) ? 2.2 : chosen.has(name) ? 2.6
      : placedNow.has(name) ? 2 : model.isConstruction(name) ? CONSTRUCTION_PX : 1.4);

    // **Quiet geometry** (quiet.ts; the owner: points "disappear when they are
    // the endpoint of a line or a corner (except when you hover over them)",
    // lines "when they form the edge of a solid"). Shaded only: in it a
    // corner is not drawn, and a solid's own edges are left to the fine line
    // the face layer drew with the faces — until the hand is on them. Quiet is
    // not hidden: none of this reaches the pick, so a quiet corner is still
    // hovered, snapped to and dragged, and drawn while it is.
    const kernelFeatures = solidBodies.kernelFeatures();
    quiet = quietEntities(model, {
      shaded: opaque(viewMode), faced: new Set([...faces.map((f) => f.feature), ...kernelFeatures]), kernel: kernelFeatures,
    });
    shown = revealed(model, [
      ...lit,
      ...chosen,
      ...(engine.snap?.targets ?? []),
      ...(engine.armedUnder ? [engine.armedUnder.name] : []),
      ...engine.dragging,
      // What the armed tool could take, and what its gesture has placed: lit, so shown.
      ...takesNow,
      ...placedNow,
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
    // The hidden view draws a solid's own edges in this pass, the runs behind a
    // face dimmed, which an extrude's are through its twins. A kernel body's
    // twins are quiet (quiet.ts), so its own edges are drawn here instead, the
    // same way: in the solid's ink, through the same occlusion. Before the
    // entities, so a point's dot is over them.
    if (occluded && !opaque(viewMode)) hiddenKernelEdges();
    entityPass(edges, points, stroke, weight, lit, chosen);
    // A kernel body's edges the hand is on, or that are selected
    // (docs/plans/solid-fillets.md): drawn as the solid's edges are — along
    // the kernel's own curve, through the same occlusion — in the hover's
    // amber or the selection's violet, at their weights. On top of the
    // entities, as a lit line is over the drawing it is part of.
    litKernelEdges(hov?.kind === "edge" ? hov.name : null);

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
    syncOrganiser();
    syncChip();
  }

  /** This frame's plane, what is in focus on it, and what the armed tool has placed or could take (`render`). */
  let plane: ActivePlane | null = null;
  /** The plane the chip names: the work plane, else the default frame's. */
  let named: ActivePlane | null = null;
  let focus: ReadonlySet<string> | null = null;
  let placedNow: ReadonlySet<string> = new Set();
  let takesNow: ReadonlySet<string> = new Set();
  /** The chip, once the engine it reads is made. */
  let chip: ModeChip | null = null;

  /**
   * The gesture's stage, in ink: what it has placed and not finished with, in
   * the tools' green until it ends; what its next pick could take, lit in a
   * paler green. Undefined for anything else, which keeps its own ink.
   */
  function staged(name: string): string | undefined {
    return placedNow.has(name) ? ACCENT : takesNow.has(name) ? TAKES : undefined;
  }

  /** `ink` as the focus rule draws `name`: itself while it is held on the plane (or no plane is set), else one step dimmed. */
  function focused(name: string, ink: string): string {
    return focus === null || focus.has(name) || ink === SOLID_EDGE ? ink : outOfFocusInk(ink);
  }

  /**
   * The plane as drawn (docs/plans/mode-feedback.md). **A face** — the one the
   * plane was taken from, or the plain loop it lies on — tinted in the tools'
   * green made lighter and outlined in the green itself; where a solid is in
   * front of it, or it faces away (it is being looked at from inside the
   * solid), the tint fades and the outline is drawn in the hidden view's ink
   * for that green — as a hidden edge is — so it is there from every side.
   * **A frame's plane**, or one no loop joins, a patch sized to what is held
   * on it, with a faint grid whose step follows the zoom (`planePatch`).
   */
  function drawActivePlane(p: ActivePlane | null) {
    if (!p) return;
    const toward = viewAxes(view).toward;
    const facing = p.n[0] * toward[0] + p.n[1] * toward[1] + p.n[2] * toward[2];
    const project = (pts: number[][]) => pts.map((w) => engine.worldToScreen(w));
    g.save();
    g.setLineDash([]);
    if (p.outlines) {
      const centre = p.outlines[0].reduce((s, q) => s.map((c, i) => c + q[i]), [0, 0, 0]).map((c) => c / p.outlines![0].length);
      const behind = (p.kind === "face" && facing < 0) || !inSight(occluded, centre);
      g.beginPath();
      for (const o of p.outlines) {
        const pts = project(o);
        g.moveTo(...pts[0]);
        for (const q of pts.slice(1)) g.lineTo(...q);
        g.closePath();
      }
      g.fillStyle = behind ? PLANE_TINT_BEHIND : PLANE_TINT;
      g.fill("evenodd");
      g.lineWidth = PLANE_EDGE_PX;
      for (const o of p.outlines) strokeRuns(o, true, behind);
    } else {
      const held = [...(focus ?? [])].filter((n) => model.entities.get(n)?.kind === "point").map((n) => model.coords(n));
      const patch = planePatch(p, held, view.scale);
      const corners = project(patch.corners);
      g.beginPath();
      g.moveTo(...corners[0]);
      for (const q of corners.slice(1)) g.lineTo(...q);
      g.closePath();
      g.fillStyle = PATCH_TINT;
      g.fill();
      g.strokeStyle = PLANE_GRID;
      g.lineWidth = 1;
      g.beginPath();
      for (const [a, b] of patch.lines) {
        g.moveTo(...engine.worldToScreen(a));
        g.lineTo(...engine.worldToScreen(b));
      }
      g.stroke();
      g.lineWidth = PLANE_EDGE_PX;
      strokeRuns(patch.corners, true, false, PATCH_EDGE_ALPHA);
    }
    g.restore();
  }

  /** A plane's outline, in the green where it is in sight and in the green's hidden ink where a face is in front (or all of it, `behind`). */
  function strokeRuns(world: number[][], closed: boolean, behind: boolean, alpha = 1) {
    const runs = occluded ? inkRuns(occluded, world, closed) : [{ hidden: false, points: world.map((w) => engine.worldToScreen(w)) }];
    g.globalAlpha = alpha;
    for (const run of runs) {
      g.strokeStyle = behind || run.hidden ? hiddenInk(ACCENT) : ACCENT;
      g.beginPath();
      g.moveTo(...run.points[0]);
      for (const q of run.points.slice(1)) g.lineTo(...q);
      if (closed && runs.length === 1) g.closePath();
      g.stroke();
    }
    g.globalAlpha = 1;
  }

  /**
   * The chip, as this frame has it: the plane's name, what is in the hand, and
   * the next step — or the guidance a tool last gave, while it is fresh.
   */
  function syncChip() {
    if (!chip) return;
    const what = engine.lit;
    const next = engine.next();
    // Guidance answers the click that missed, at the stage it missed in: once
    // the gesture has moved on (a region picked after a miss) it is stale, and
    // the step is said again.
    if (chipGuide && (chipGuide.at !== next || chipGuide.what !== what)) {
      clearTimeout(chipGuide.timer);
      chipGuide = null;
    }
    if (chip.show(chipParts(named?.label ?? null, what, next, chipGuide?.text ?? null), optionsPanel.size() !== null)) fitChip();
  }

  /**
   * The chip given way where the verdict would be cut (`ModeChip.fit`): asked
   * when the chip changes, when the corner is placed again, and when anything
   * after the chip changes, starts to fade or has faded — the observers below.
   *
   * **A fading verdict still needs its line.** It used to count as gone the
   * moment it was marked faded, so the chip took its next step back at once
   * and pushed the verdict past the corner's room while it was still fading
   * out: `SOLVED 36 free` drawn cut in half under the chip on an upright
   * iPhone for the 0.6 s of the fade (docs/images/196; docs/plans/
   * touch-density.md). Now what is drawn at all — its opacity above nothing —
   * counts, and the chip is fitted again when the fade ends.
   */
  function fitChip() {
    chip?.fit(() => {
      const room = cornerEl.getBoundingClientRect();
      return ["status", "diagnosis", "stepnote"].some((id) => {
        const el = document.getElementById(id)!;
        if (!el.textContent) return false;
        const style = getComputedStyle(el);
        if (style.display === "none" || Number(style.opacity) <= 0.01) return false;
        return el.getBoundingClientRect().bottom > room.bottom + 0.5;
      });
    });
  }
  // The fade's end, which no attribute marks: only then has the line been given up.
  cornerEl.addEventListener("transitionend", (e) => {
    const p = (e as TransitionEvent).propertyName;
    if (p === "opacity" || p === "display") fitChip();
  });
  new MutationObserver(() => fitChip()).observe(document.getElementById("status")!, { attributes: true, childList: true, characterData: true, subtree: true });
  new MutationObserver(() => fitChip()).observe(diagnosisEl, { attributes: true, childList: true, characterData: true, subtree: true });
  new MutationObserver(() => fitChip()).observe(document.getElementById("stepnote")!, { attributes: true, childList: true, characterData: true, subtree: true });
  // The corner placed again (a rotation, a pane moved into its row) changes its room.
  new ResizeObserver(() => fitChip()).observe(cornerEl);

  /**
   * A tool's guidance, in the chip's third part for `GUIDE_NOTE_MS` — or until
   * something is made, the tool changes, or its next step does.
   */
  let chipGuide: { text: string; at: string | null; what: string; timer: ReturnType<typeof setTimeout> } | null = null;
  function guideChip(text: string | null) {
    if (chipGuide) clearTimeout(chipGuide.timer);
    chipGuide = text === null ? null
      : { text, at: engine.next(), what: engine.lit, timer: setTimeout(() => { chipGuide = null; syncChip(); }, GUIDE_NOTE_MS) };
    syncChip();
  }
  sayLocked = (text) => guideChip(text);

  /**
   * What the kernel has to say — a cut that removed nothing, a boolean it
   * refused, a sketch on a face that is gone, the kernel not there — logged
   * once when it changes, and the first line beside the verdict as guidance:
   * never in place of the verdict, which is the solver's.
   */
  function sayKernel() {
    const { lines } = solidBodies.report();
    const said = lines.join("\n");
    if (said === solidSaid) return;
    const old = new Set(solidSaid.split("\n"));
    solidSaid = said;
    for (const line of lines) if (!old.has(line)) log(`solid: ${line}`, "guide");
    if (lines.length) stepNote(`solid: ${lines[0]}`, GUIDE_NOTE_MS, "guide");
  }

  /** The kernel's edges in the hidden view: full where seen, dimmed behind a face, as `strokeEdge` draws any solid edge. */
  function hiddenKernelEdges() {
    const width = g.lineWidth;
    g.lineWidth = 1.4;
    try {
      for (const v of solidBodies.views()) {
        if (model.hidden.has(v.name)) continue;
        const s = v.result.solid!;
        for (const line of s.lines) {
          if (s.edges[line.edge]?.name.endsWith(":seam")) continue;
          const pts: number[][] = [];
          for (let i = 0; i < line.points.length / 3; i++) pts.push([line.points[i * 3], line.points[i * 3 + 1], line.points[i * 3 + 2]]);
          if (pts.length > 1) strokeEdge(pts, false, SOLID_EDGE);
        }
      }
    } finally {
      g.lineWidth = width;
    }
  }

  /**
   * The kernel edges lit: the one hovered, in amber, and the selected ones, in
   * violet — every kernel edge answering to the name (a split face's pieces
   * share it), on the bodies as made rather than a preview of them.
   */
  function litKernelEdges(hovered: string | null) {
    const views = solidBodies.madeViews();
    if (!views.length) return;
    const chosenEdges = new Set(engine.selection.pruneEdges((n) => views.some((v) => v.result.solid!.edges.some((e) => e.name === n))));
    if (!hovered && !chosenEdges.size) return;
    const width = g.lineWidth;
    g.lineCap = "round";
    try {
      for (const v of views) {
        if (model.hidden.has(v.name)) continue;
        const s = v.result.solid!;
        for (const line of s.lines) {
          const name = s.edges[line.edge]?.name;
          if (!name || name.endsWith(":seam")) continue;
          const lit = name === hovered;
          if (!lit && !chosenEdges.has(name)) continue;
          const pts = edgePoints(v, line.edge);
          if (pts.length < 2) continue;
          g.lineWidth = lit ? 2.2 : 2.6;
          strokeEdge(pts, false, lit ? "#e8a33d" : SELECTION);
        }
      }
    } finally {
      g.lineWidth = width;
    }
  }

  /** The kernel's edges in the wireframe view, where there are no faces to draw them with. */
  function wireKernelEdges() {
    g.save();
    g.strokeStyle = "#afc6d9";
    g.lineWidth = 1.4;
    for (const v of solidBodies.views()) {
      if (model.hidden.has(v.name)) continue;
      const s = v.result.solid!;
      for (const line of s.lines) {
        if (s.edges[line.edge]?.name.endsWith(":seam")) continue;
        g.beginPath();
        for (let i = 0; i < line.points.length / 3; i++) {
          const [x, y] = engine.worldToScreen([line.points[i * 3], line.points[i * 3 + 1], line.points[i * 3 + 2]]);
          if (i === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.stroke();
      }
    }
    g.restore();
  }

  /**
   * The organiser's rows, and the open group beside the status — after every
   * redraw, which every edit, selection and undo ends in. The pane rebuilds
   * only when what it shows differs, so a drag's frames cost a comparison.
   */
  function syncOrganiser() {
    organiser?.sync();
    // Short — the marker and the name, the pane's own — because it never
    // fades, and beside the status it lies over whatever is in the logo's row:
    // a phone's action strip in portrait, its command line's strip in
    // landscape. Spelt out in its title.
    const open = model.openGroup;
    const said = open === null ? "" : `● ${open}`;
    if (openGroupEl.textContent !== said) {
      openGroupEl.textContent = said;
      openGroupEl.title = open === null ? "" : `drawing into ${open} — what is made joins it; closegroup() ends it`;
    }
  }

  /**
   * The entities, far to near: edges, curves and frames, then the points and
   * their names on top. Run once as the casing pass (`casing` set) and once
   * as itself — the same code both times, so a casing is exactly the shape of
   * the mark it rims.
   */
  function entityPass(edges: Entity[], points: Entity[], stroke: (name: string) => string,
                      weight: (name: string) => number, lit: Set<string>, chosen: Set<string>) {
    // The origin, which every document has and no entity is (`ORIGIN`): drawn
    // as any frame is, in its RGB triad, from the start — so a fresh document
    // shows where the ground is and which way it faces. First, so everything
    // drawn is over it: a frame of the user's made at the same place
    // (`frame()` in a fresh view lands there) shows its own arms, lit or not,
    // and is the one picked (picking.ts puts the origin last).
    if (model.isFrame(ORIGIN)) drawFrame(ORIGIN, lit.has(ORIGIN), chosen.has(ORIGIN));
    for (const e of edges) {
      g.lineWidth = weight(e.name);
      if (e.kind === "line") {
        strokeEdge([model.coords(e.refs[0]), model.coords(e.refs[1])], false, stroke(e.name));
      } else if (e.kind === "circle" || e.kind === "arc" || e.kind === "ellipse" || e.kind === "earc") {
        // In its plane (see curveplane.ts): a circle the full turn round its
        // centre in its frame's orientation, an arc counter-clockwise from
        // start to end about its plane's +z (for a 2D arc, about +z, as
        // always). Drawn as the projection of a fine polyline, a quarter-pixel
        // from the true curve, which seen square-on is the circle or circular
        // arc and seen at an angle is an ellipse, or part of one — the very
        // curve picking and snapping aim at. (A circle was drawn as a sphere's
        // silhouette until it carried a plane: round from every angle, which
        // was the phase-2 seam showing.) An ellipse is the same frame with a
        // second radius (arcgeom.ts's `rv`), sampled by its longer one.
        const f = curveFrame(model, e);
        if (f) strokeEdge(arcSamples(f, arcSegments(f.sweep, frameReach(f) * view.scale)), isClosedEntity(e), stroke(e.name));
      } else if (e.kind === "frame") {
        drawFrame(e.name, lit.has(e.name), chosen.has(e.name));
      } else {
        // A kind a module declares with no frame: the polyline it samples
        // itself as, which is what picking aims at (projection.ts).
        const pts = sampledWorld(model, e, view.scale);
        if (pts) strokeEdge(pts, false, stroke(e.name));
        // A spline of control points (docs/plans/trim-everything.md) shows its
        // control polygon, thin and dashed: its points off the curve are what
        // shapes it, and without the polygon they read as stray dots (looked at).
        if (e.kind === "bspline" && !casing) {
          const poly = e.points.map((p) => engine.worldToScreen(model.coords(p)));
          g.save();
          g.lineWidth = 1;
          g.setLineDash([3 * uiOf(view), 3 * uiOf(view)]);
          g.strokeStyle = CONSTRUCTION;
          g.beginPath();
          g.moveTo(...poly[0]);
          for (const q of poly.slice(1)) g.lineTo(...q);
          g.stroke();
          g.restore();
        }
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
      g.fillStyle = lit.has(e.name) ? "#e8a33d" : chosen.has(e.name) ? SELECTION : staged(e.name) ?? focused(e.name, inkOf(e.name));
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
    /** How far below the middle the words are centred, in pixels at 100 % (test/e2e/emptyhint.e2e.ts reads the band there). */
    const HINT_DROP = 64;
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
    // Below the middle, not on it: a fresh view puts the origin there, drawn
    // from the start with its "origin" label under it (docs/plans/
    // frameless-curves.md), and the words written over its arms read as one
    // muddle. HINT_DROP clears the marker's label at any interface size.
    let y = height / 2 + HINT_DROP * k - ((rows.length - 1) * step) / 2;
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
      case "arc":
      case "ellipse": return at(e.center);
      case "frame": return at(e.origin);
      // A kind a module declares at run time: where its first point is.
      default: { const refs = model.refsOf(e as Entity); return refs.length ? at(refs[0]) : 0; }
    }
  }

  /**
   * A coordinate frame: short arrows out of its origin, along +x and +y — and
   * +z for a 3D frame — lettered, with the frame's name beside it the way a
   * point's name sits beside the point.
   *
   * **Each arm in its axis's colour, as SolidWorks draws a triad** — x red, y
   * green, z blue, its letter in the same ink (`AXIS_INKS`; the owner: *"a
   * frame should be coloured or something so I can tell the orientation. use
   * rgb colours like solidworks"*). The letters stay: a red–green colour-blind
   * eye reads the two arms by lightness and by letter. **Lit and selected
   * still win** — hovered, the whole marker is amber, selected the
   * selection's violet — so state reads at a glance over the hues.
   *
   * **The default frame is drawn heavier** — thicker arms, bold letters and
   * name — because that difference is the whole of what the pointer means: a
   * typed `par(l, xaxis())` is level with *that* frame and not with any other
   * one on the canvas. It is the only ambient state in the app that changes
   * what a typed word does, so it had better be visible without asking. By
   * weight, not by ink: the inks now say which axis is which.
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
    // One ink for the whole marker while it is lit or selected; else each arm its axis's.
    const state = lit ? "#e8a33d" : chosen ? SELECTION : null;
    const weight = isDefault ? "bold " : "";
    g.save();
    g.lineWidth = lit || chosen ? (isDefault ? 2.6 : 2.2) : isDefault ? 2 : 1.2;
    g.font = `${weight}${10 * k}px ui-monospace, Menlo, monospace`;
    const arms: [[number, number], "x" | "y" | "z", number[]][] = [[marker.x, "x", basis.ux], [marker.y, "y", basis.uy]];
    if (marker.z && basis.uz) arms.push([marker.z, "z", basis.uz]);
    for (const [tip, letter, axis] of arms) {
      const colour = state ?? AXIS_INKS[letter];
      g.strokeStyle = colour;
      g.fillStyle = colour;
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
    // The name in the old frame ink, one for every frame — the default's in bold.
    g.fillStyle = state ?? FRAME_NAME_INK;
    g.font = `${weight}${11 * k}px monospace`;
    // Away from both arms, not at a fixed corner: the arms turn with the frame,
    // and a label pinned below-right would sit on top of one of them as soon as
    // the frame was tilted — which is the case this package is about. Opposite
    // their bisector is the one direction that stays clear whatever the tilt.
    const bx = (marker.x[0] + marker.y[0]) / 2 - marker.origin[0];
    const by = (marker.x[1] + marker.y[1]) / 2 - marker.origin[1];
    const bl = Math.hypot(bx, by) || 1;
    // Not the origin's, unless it is lit or selected: it stands where drawings
    // start, so its name would print over the first corner's — and a triad at
    // the kernel's zero, in every document, says what it is without one.
    if (name !== ORIGIN || state) {
      label(name, marker.origin[0] - ((bx / bl) * 14 + 3) * k, marker.origin[1] - ((by / bl) * 14 - 4) * k);
    }
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
      // A relation the last solve said cannot hold with the others wears the
      // conflict's red, box and mark; a redundant one the softer orange
      // (docs/plans/sketch-relations.md). Hover and selection still outrank
      // both, so the one being aimed at reads as aimed at.
      const verdict = conflicted.has(mark.relation) ? CONFLICT_INK
        : diagnosis?.redundant.includes(mark.relation) ? REDUNDANT_INK : null;
      const [x, y] = mark.screen;
      roundedBox(x - mark.halfW, y - mark.halfH, mark.halfW * 2, mark.halfH * 2, 3 * k);
      g.fillStyle = on ? "#20303f" : "#0e141bee";
      g.fill();
      g.strokeStyle = on ? "#e8a33d" : picked ? SELECTION : verdict ?? "#2c3d4f";
      g.lineWidth = picked || verdict ? 1.6 : 1;
      g.stroke();
      // A dimension is brighter than an annotation on purpose: it states
      // something the user asked for, where `∥` states something they may only
      // have implied. Onshape draws its dimensions the same way — a value
      // reads as part of the drawing, an inferred mark as a note about it.
      g.fillStyle = on ? "#e8a33d" : picked ? SELECTION : verdict ?? (mark.isLabel ? "#cfe0ee" : "#8fa7bb");
      // Nudged down a hair: several of these marks (— ∥ ⊥ ∴) sit high in their
      // em box, and centring by metrics leaves them looking as though they are
      // escaping upward out of the box.
      if (LOCKED.has(mark.op)) padlock(x, y, k);
      else g.fillText(mark.symbol, x, y + 0.5 * k);
    }
    g.restore();
  }

  /**
   * Fix's mark (glyphs.ts's `LOCKED`): a padlock, in the fill style already
   * set — a solid body and an open shackle over it, sized to the glyph box at
   * the interface size `k`, so it is the same weight as the characters beside
   * it.
   */
  function padlock(x: number, y: number, k: number) {
    const [w, h, r] = [8 * k, 5.5 * k, 2.6 * k];
    const top = y - 0.5 * k;
    roundedBox(x - w / 2, top, w, h, 1.2 * k);
    g.fill();
    g.save();
    g.strokeStyle = g.fillStyle;
    g.lineWidth = 1.5 * k;
    g.beginPath();
    g.moveTo(x - r, top);
    g.lineTo(x - r, top - 1.6 * k);
    g.arc(x, top - 1.6 * k, r, Math.PI, 0);
    g.lineTo(x + r, top);
    g.stroke();
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
    // Which relations cannot all hold (model.ts's `conflicting`), by name, as
    // the hover tag and `rels()` name them — the verdict used to list their
    // blocks' labels.
    const c = report.solved ? { relations: [], unowned: [] } : model.conflicting(report);
    conflicted = new Set(c.relations);
    if (report.solved) statusLine.show("solved", "SOLVED");
    // The verdict alone: the names it accuses are the diagnosis beside it, each
    // one a thing to click (`showDiagnosis`), so they are not said twice.
    else statusLine.show("conflict", "CONFLICT");
    // **What is free, and what is said twice**, after the solve and never
    // during a drag: a drag's frames solve through the engine and draw with
    // the last answer, and this runs when the drag ends (its `onSolveRender`).
    // Measured on the biggest drawing the suite builds: see the spec's As built.
    try {
      diagnosis = model.diagnose();
    } catch (err) {
      diagnosis = null;
      console.warn("diagnosis failed", err);
    }
    showDiagnosis(report.solved, c.relations, c.unowned);
    const said = c.relations.join(" ");
    if (said && said !== conflictSaid) {
      // A collapse says what would have folded: the relations hold only if it
      // goes to nothing, which is why the drawing did not move.
      const folds = report.collapsed.length ? ` without collapsing ${report.collapsed.join(", ")}` : "";
      log(`CONFLICT — these cannot all hold${folds}: ${c.relations.map((r) => describeRelation(model.relationOf(r))).join(" · ")}`, "err");
    }
    conflictSaid = said;
    render();
    return report;
  }

  /** An entity's ink when nothing outranks it: free, or held. */
  function inkOf(name: string): string {
    return freeInkOn && diagnosis?.free.has(name) ? FREE : HELD;
  }

  /**
   * The diagnosis beside the verdict (statusline.ts's `diagnosisLine`): its
   * words, and each relation it names as a button that selects it — so a
   * conflict is clicked, then Delete takes it away (constraint-deletion.md).
   * It fades with SOLVED when it only counts what is free; a conflict and a
   * redundancy stay until the next solve replaces them.
   */
  function showDiagnosis(solved: boolean, conflicts: string[], unowned: string[]) {
    const line = model.entities.size === 0 && solved
      ? { cls: "" as const, parts: [], fades: true }
      : diagnosisLine(solved, diagnosis?.dof ?? null, conflicts, unowned, solved ? diagnosis?.redundant ?? [] : []);
    diagnosisEl.textContent = "";
    diagnosisEl.className = line.cls;
    for (const part of line.parts) {
      if (typeof part === "string") {
        diagnosisEl.append(part);
        continue;
      }
      const b = document.createElement("button");
      b.type = "button";
      b.className = "rel";
      b.dataset.relation = part.relation;
      b.textContent = part.relation;
      b.title = `${model.relations.has(part.relation) ? describeRelation(model.relationOf(part.relation)) : part.relation} — click to select it, then Delete removes it`;
      b.addEventListener("click", () => {
        if (!model.relations.has(part.relation)) return;
        // Picked up to be deleted, so whatever tool is in the hand is put down
        // first: Delete is a tool's own while one is armed, and the line below
        // would otherwise promise what the key then does not do (found by the
        // conflict e2e, the constrain tool still armed from adding the par).
        if (engine.active) {
          engine.arm(SELECT);
          syncToolbar();
        }
        engine.select([part.relation]);
        log(`${part.relation} selected — Delete removes it`, "out");
        render();
      });
      diagnosisEl.append(b);
    }
    delete diagnosisEl.dataset.faded;
    clearTimeout(diagnosisFade);
    if (line.fades) diagnosisFade = setTimeout(() => { diagnosisEl.dataset.faded = ""; }, STATUS_FADE_MS);
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
    if (changed && chipGuide) guideChip(null);
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
    // The Hand is kept through an undo as a tool is: someone looking round
    // the drawing who undoes wants to go on looking.
    const hand = engine.hand;
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
    if (hand) engine.arm(HAND);
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
    // Select and the Hand first (docs/plans/select-hand.md): a button each,
    // typing `arm("select")` and `arm("hand")` like every other, and the lit
    // one is the engine's answer to what is in the hand — Select whenever
    // nothing is armed.
    tools: () => trayButtons().flatMap((b) => b.tools),
    // A family's tools share a button (docs/plans/toolbar-groups.md), which
    // shows the one this viewer armed last.
    buttons: trayButtons,
    current: (group, tools) => groupCurrent({ group, tools: [...tools] }, groupMemory.recall(group)),
    remember: (group, tool) => { groupMemory.remember(group, tool); },
    flyout: {
      el: document.getElementById("flyout")!,
      metrics: () => metrics,
      bounds: () => tooltipBounds(),
      // Never over the logo or the status's corner, whatever the corner says
      // now; and clear of every other pane where there is room.
      keep: () => {
        const i = insets();
        const rect = (el: Element) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
        const corner = cornerBox(metrics);
        const texts = Array.from(document.querySelectorAll<HTMLElement>("#corner > *"))
          .filter((el) => !el.hidden && el.textContent && getComputedStyle(el).display !== "none").map(rect)
          .filter((r) => r.w > 0 && r.h > 0);
        return [rect(logoEl), { ...corner, x: corner.x + i.left, y: corner.y + i.top }, ...texts];
      },
      avoid: () => Array.from(document.querySelectorAll<HTMLElement>(".panel[data-panel]"))
        .filter((el) => !el.hidden && el.dataset.panel !== "toolbar")
        .map((el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }),
    },
    icon: toolIcon,
    active: () => engine.lit,
    run: (command) => void submit(command),
    // Each tool's own words (`static summary`), handed in: the toolbar knows
    // nothing of the tools.
    summary: toolSummary,
    key: (tool) => TOOL_KEYS[tool] ?? null,
    tooltip,
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
      // A choice also shows what the gesture has read it as (`Tool.read`), so
      // the method the circle tool took a drag for is on the screen to lock.
      const read = engine.active?.read?.() ?? {};
      const rows = Object.entries(specs).map(([name, s]) => ({
        name, label: s.label ?? name, unit: unitSymbol(s.unit), value: a.options[name] as OptionValue,
        ...(s.choices ? { choices: Object.entries(s.choices), read: s.choices[read[name]] ?? null, ...(s.buttons ? { buttons: true } : {}) } : {}),
        ...(s.flip ? { flip: true } : {}),
        ...(s.beside ? { beside: s.beside } : {}),
      }));
      const dialog = engine.dialog();
      // A tool's commands (the constrain tool's relations), a row each.
      const commands = engine.active?.commands?.() ?? [];
      // The constrain tool shows its panel with nothing picked yet: it says
      // there is nothing to list rather than vanishing (and coming back
      // somewhere else) at the first pick.
      const wantsPanel = rows.length || dialog || commands.length || engine.active?.commands !== undefined;
      return wantsPanel ? { tool: a.name, rows, dialog, commands } : null;
    },
    run: (command) => submit(command),
    // A greyed command row, pressed: why it cannot apply, whole, in the log.
    note: (text) => log(text, "guide"),
    // A command row is typed like any line, and then the tool hears it ran —
    // its picks are spent. Told after the line has run, so it is the line's
    // own undo step and the tool's next pick is the next one's.
    command: async (command) => {
      const tool = engine.active;
      await submit(command);
      tool?.ran?.(command);
      render();
    },
    confirm: () => {
      engine.confirm();
      syncToolbar();
    },
    cancel: () => escape(),
    trial: (option, value) => engine.trial(option, value),
    tooltip,
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
        // The chip's third part, where the next step is said — not the
        // status's note, which keeps the verdict's one-off news
        // (docs/plans/mode-feedback.md).
        log(line, "out");
        guideChip(guideText(line, engine.armed?.name ?? null));
        return;
      }
      log(line, outcome === "done" ? "out" : "err");
    },
    // A tool whose commit is a command types it, as the menu does — the sketch
    // tool's `workplane("a.b.c")` — so it is logged, recalled and undone as
    // typed. The promise is handed back for a tool that must wait for the line
    // to be in before going on.
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
      // A surface under the click, nothing nearer (docs/plans/surfaces.md):
      // its own menu — Thicken…, Offset…, Knit with…, Delete.
      const on = pick ? null : solidBodies.faceAt(view, sx, sy, model.hidden);
      if (on && model.surfaces.has(on.body)) {
        const m = surfaceMenu(model, on.body);
        // With undo and redo after it, as every menu has; not the empty canvas's tools, which would make it a phone's height.
        const history2 = menuFor(model, null, null, history, null, []).items.filter((i) => i.label === "Undo" || i.label === "Redo");
        menu.show({ ...m, items: [...m.items, ...history2] }, sx, sy);
        return;
      }
      // Where on a picked curve the click was, in the world — what a spline's
      // Add point here adds at (docs/plans/spline.md).
      const picked = pick ? model.entities.get(pick.name) : undefined;
      const at = picked ? screenCurve(model, view, picked, 0)?.lift([sx, sy]) ?? null : null;
      menu.show(menuFor(model, pick, pick ? null : engine.regionAt(sx, sy), history, viewMode, selected, at), sx, sy);
    },
    // A finger's long-press opened the menu and then dragged on: that is the
    // box, and the menu is not what the hand is doing any more.
    onContextMenuWithdrawn: () => { menu.close(); },
  });
  // A kernel body's faces are no loop of entities: sketch on face, and a
  // click inside a region, ask the kernel's picture what is under the pixel.
  engine.solidFaceAt = (sx, sy) => solidBodies.faceAt(view, sx, sy, model.hidden);
  // A kernel body's edges, to the hand (docs/plans/solid-fillets.md): picked,
  // boxed, named in the hover tag, and — for the fillet and chamfer tools —
  // their bodies, faces and a preview of a blend in a body's chain. Picked on
  // the bodies as made, never on a preview of one.
  // A fillet's radius and a chamfer's setback are drawn on the first face the
  // blend made — the kernel's face, which only this host holds — nudged off it
  // along its outward normal as seen. None until the kernel has answered.
  const blendAnchor = (m: Model, v: View, r: { name: string }) => {
    // A surface's fillet or chamfer (docs/plans/surfaces.md) is drawn the same way, on its surface.
    const sf = [...m.surfaces.values()].find((x) => x.size === r.name && (x.kind === "fillet" || x.kind === "chamfer"));
    const b = [...m.blends.values()].find((x) => x.size === r.name) ?? (sf ? { name: sf.name, into: surfaceNameOf(m, sf.name) ?? sf.into! } : undefined);
    // Its own edit dialog draws the size where it is being changed.
    if (b && engine.armed?.target === b.name) return [];
    const body = b ? solidBodies.views().find((x) => x.name === b.into) : undefined;
    const s = body?.result.solid;
    if (!b || !body || !s) return [];
    const fi = s.faces.findIndex((f) => f.name === `${b.name}.f0`);
    if (fi < 0) return [];
    const world = s.faces[fi].point;
    const n = body.faces.find((t) => t.face === fi)?.normal ?? [0, 0, 1];
    const [ax, ay] = worldToScreen(v, world);
    const [bx, by] = worldToScreen(v, world.map((c, k) => c + n[k] * 10 / Math.max(v.scale, 1e-9)));
    const len = Math.hypot(bx - ax, by - ay);
    const dir: [number, number] = len > 1e-6 ? [(bx - ax) / len, (by - ay) / len] : [Math.SQRT1_2, Math.SQRT1_2];
    return [{ world, dir, about: [] }];
  };
  defineGlyphAnchor("filletRadius", blendAnchor);
  defineGlyphAnchor("chamferSetback", blendAnchor);
  engine.solids = {
    // What the kernel draws in an entity's place: a kernel body's twins, walls
    // and whole profile members (quiet.ts's solid edges). A profile member that
    // is only a portion of a longer line is still the sketch's (it runs past
    // the solid), and keeps the pick — found by the hidden view's suite.
    skeleton: (name) => {
      const kernel = solidBodies.kernelFeatures();
      return kernel.size > 0 && solidEdges(model, kernel).has(name);
    },
    edgePick: ([sx, sy], occ, reach) => {
      const views = solidBodies.madeViews();
      const hit = edgeAt(views, view, sx, sy, occ, reach, model.hidden);
      if (!hit) return null;
      const v = views.find((x) => x.name === hit.body)!;
      const by = [...model.blends.values()].filter((b) => b.into === hit.body && b.edges.includes(hit.name)).map((b) => b.name);
      // A surface's boundary edge (one face) is said so: what the menu offers there is Extend, not a fillet.
      const lamina = !!v.result.solid?.edges.some((e) => e.name === hit.name && e.lamina);
      return { name: hit.name, kind: "edge", distance: hit.distance, body: hit.body, tag: describeEdge(v, hit.name, by), ...(lamina ? { lamina } : {}) };
    },
    edgesInBox: (rect, mode, occ) => edgesInBox(solidBodies.madeViews(), view, rect, mode, occ, model.hidden),
    views: () => solidBodies.views(),
    edgeAt: ([sx, sy]) => edgeAt(solidBodies.views(), view, sx, sy, engine.occlusion, engine.reach, model.hidden),
    faceAt: ([sx, sy]) => solidBodies.faceAt(view, sx, sy, model.hidden),
    // Asked from inside a tool's drawing, so the frame that sends it is the next one, not this.
    trial: (t) => { if (solidBodies.trial(t)) queueMicrotask(() => render()); },
    trialAnswer: () => solidBodies.trialAnswer(),
  };
  // A phone's words are a finger's from the start: "tap", before any tap.
  engine.pointing = coarse ? "finger" : "mouse";

  /**
   * The mode chip (modechip.ts), through the seams everything else uses: the
   * plane's menu is the context menu, shown under the chip; Done types
   * `workplane(null)` through `submit`; the tool's name shows its options
   * panel — the viewer may have hidden it from the app menu's Panes — and
   * draws the eye to it.
   */
  chip = new ModeChip(modeEl, {
    planeMenu: (anchor) => {
      if (!named) return;
      const wrap = menuEl.parentElement!.getBoundingClientRect();
      menu.show(planeMenu(model, named), anchor.left - wrap.left, anchor.bottom - wrap.top + 2);
    },
    done: () => {
      const line = doneCommand(model);
      if (line) void submit(line);
    },
    look: () => {
      const line = lookCommand(model);
      if (line) void submit(line);
    },
    options: () => {
      if (optionsPanel.size() === null) return;
      panels.setShown("options", true);
      optionsPanelEl.classList.remove("flash");
      void optionsPanelEl.offsetWidth; // restart the animation
      optionsPanelEl.classList.add("flash");
    },
  });
  syncChip();

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
        hand: engine.hand,
      }),
      run: (command) => void submit(command),
      key: (action) => actionKey(action, apple),
      tooltip,
    })
    : null;

  /**
   * The organiser (docs/plans/organiser.md), through the same seam as the
   * menu and the toolbar: every control types its line into `submit` — a
   * row's `select("g1")`, the eye's `hide("g1")`, the ＋'s
   * `opengroup(group())` — and a row's menu is the context menu's own element,
   * so it closes, and is closed, as that one is.
   */
  const organiserEl = document.getElementById("organiser");
  if (organiserEl) {
    organiser = new Organiser(organiserEl, document.querySelector<HTMLElement>('.panel[data-panel="organiser"] .padd'), {
      sections: () => organiserSections(model, engine.selection.prune(model)),
      selection: () => engine.selection.prune(model),
      menu: (name) => rowMenu(model, name, engine.selection.prune(model)),
      showMenu: (m, x, y) => {
        hoverEl.hidden = true;
        const wrap = menuEl.parentElement!.getBoundingClientRect();
        menu.show(m, x - wrap.left, y - wrap.top);
      },
      run: (command) => void submit(command),
      tooltip,
      tree: document.getElementById("otree"),
    });
  }

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
  /**
   * **The page is never scrolled, and iOS is told so again whenever it may
   * have scrolled it.** The owner, from his iPhone: *"a weird bug where the
   * touch input is offset upwards at some point and it persists"*. The page
   * is fixed by its four edges and has nothing to scroll, but WebKit scrolls
   * the layout viewport anyway to bring a focused field above the keyboard,
   * and in an installed app it can leave that scroll behind when the keyboard
   * goes; from then on a touch's client position and the fixed canvas's box
   * disagree by the leftover, every press landing above the finger, until a
   * reload. So the scroll is put back to zero when a field loses focus (after
   * the keyboard's own animation), when the visual viewport settles, and on
   * every press on the drawing — a press already off by the leftover heals the
   * next. Not reproducible in Chromium, which cannot scroll this page at all;
   * the owner's device is the test (TODO.md).
   */
  const unscroll = () => {
    if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
    const root = document.documentElement;
    if (root.scrollTop || root.scrollLeft) { root.scrollTop = 0; root.scrollLeft = 0; }
    if (document.body.scrollTop || document.body.scrollLeft) { document.body.scrollTop = 0; document.body.scrollLeft = 0; }
  };
  document.addEventListener("focusout", () => { setTimeout(unscroll, 350); });
  window.visualViewport?.addEventListener("resize", () => { setTimeout(unscroll, 50); });

  /**
   * **The panel being typed into rides above the keyboard** (keyboard.ts;
   * docs/plans/android.md): moved — by a transform, and narrowed to the free
   * run beside the other panes — while the keyboard covers it, and put back by
   * the panels' own placement when the keyboard goes or the focus leaves. The
   * page is not resized for a keyboard, so the drawing keeps its size.
   */
  let liftedEl: HTMLElement | null = null;
  const lift = () => {
    const vv = window.visualViewport;
    const at = document.activeElement;
    const panel = at instanceof HTMLInputElement || at instanceof HTMLTextAreaElement ? at.closest<HTMLElement>(".panel[data-panel]") : null;
    const top = keyboardTop(document.documentElement.clientHeight, vv);
    if (liftedEl && (liftedEl !== panel || top === null)) {
      const was = liftedEl;
      liftedEl = null;
      was.style.transform = "";
      delete was.dataset.lifted;
      panels.apply(); // its own width and place again
    }
    if (!panel || top === null) return;
    const box = (el: Element) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
    // Where the panels put it, not where a lift already has — its own
    // rectangle, without the ground it reaches under an inset with (`bleed`):
    // lifted off the gesture bar, it has no bar to reach under.
    const pad = getComputedStyle(panel);
    const [padT, padB] = [parseFloat(pad.paddingTop) || 0, parseFloat(pad.paddingBottom) || 0];
    const home = { x: panel.offsetLeft, y: panel.offsetTop + padT, w: panel.offsetWidth, h: panel.offsetHeight - padT - padB };
    const others = Array.from(document.querySelectorAll<HTMLElement>(".panel[data-panel]"))
      .filter((el) => el !== panel && !el.hidden).map(box).concat([box(logoEl)]);
    const to = lifted(home, top, others);
    if (!to) return;
    panel.style.padding = "";
    panel.style.height = `${to.h}px`;
    delete panel.dataset.bleed;
    panel.style.transform = `translate(${to.x - panel.offsetLeft}px, ${to.y - panel.offsetTop}px)`;
    panel.style.width = `${to.w}px`;
    panel.dataset.lifted = "";
    liftedEl = panel;
  };
  relift = lift;
  window.visualViewport?.addEventListener("resize", lift);
  window.visualViewport?.addEventListener("scroll", lift);
  document.addEventListener("focusin", lift);
  document.addEventListener("focusout", () => setTimeout(lift, 0));
  cv.addEventListener("pointerdown", (e) => {
    if (!cv.hasPointerCapture(e.pointerId)) cv.setPointerCapture(e.pointerId);
    unscroll();
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
      // Workbenches and modules (docs/plans/workbenches.md): the tray and the
      // menu follow a switch or a module loaded, and a module's new names are
      // handed to the live evaluator.
      workbench: (name: string) => switchWorkbench(name),
      modulesChanged: () => modulesChanged(),
      rescope: (names: Record<string, unknown>) => repl.define(names),
      workbenchFiles: {
        add: () => workbenchFiles.add(),
        load: (url: string) => workbenchFiles.load(url),
        remove: (name: string) => workbenchFiles.remove(name),
        share: (name: string) => workbenchFiles.share(name),
      },
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
      freeink: (on?: boolean) => {
        if (on !== undefined) {
          freeInkOn = on;
          render();
        }
        return freeInkOn;
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
      // See-through and locked panels (docs/plans/panels-overlay-lock.md): the
      // viewer's, stored beside the layout, recording nothing.
      panels: (options?: unknown) => panelsLine(() => panels.getSwitches(), (s) => panels.setSwitches(s), options),
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
      openModel: (json: string) => { asUserAction(() => swapModel(openModelText(json, APP_DIM))); afterOpen(json); },
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
      installApp: () => installer.install(),
      exportFile: (text: string, name: string, type: string) => files!.exportFile(text, name, type),
      // The bodies the kernel built, exactly: each one's topology asked of the
      // Worker that holds it, with the faces' surfaces from their features.
      kernelSolids: () => {
        const views = solidBodies.views();
        // Surfaces are the kernel's too, and have no features of their own (docs/plans/surfaces.md).
        if (!views.length) return null;
        return (async () => {
          const out: KernelSolid[] = [];
          for (const v of views) {
            const topo = await solidBodies.topology(v.name);
            if (topo) out.push({ body: kernelBody(model, v.name, topo, v.result), features: v.features });
          }
          return out;
        })();
      },
      document: () => files!.document(),
    };
  }

  /**
   * The document (docs/plans/files.md). `document()` is the host function the
   * app menu reads for its name line; the four commands are typed through
   * `submit` like every menu item.
   */
  files = new Files({
    text: () => saveModel(model, true, toolSources.all(), { workbench: activeWorkbench() }),
    snapshot,
    // A file from any door — the input, a picker, a drop, the desktop — is
    // opened the way `open()` opens one: one undo step, and what the file
    // carries said through the same function, or the doors would drift into
    // different answers to what opening a file means. Nothing is evaluated.
    open: (text) => {
      asUserAction(() => swapModel(openModelText(text, APP_DIM)));
      for (const line of carryIntoSession(savedTools(text), toolSources)) log(line, "out");
      afterOpen(text);
    },
    fresh: () => asUserAction(() => swapModel(new Model(APP_DIM))),
    log: (line, cls) => log(line, cls ?? "out"),
    phone: coarse,
    autosave,
    restored: restored?.record ?? null,
    // A dropped workbench file goes to Add workbench…, which shows its manifest and asks.
    workbenchFile: (text, name) => workbenchFiles.offer(text, name),
  });

  // A new version waiting is offered beside the status, never imposed: a tap
  // saves the drawing, then reloads into it (src/update.ts).
  watchForUpdates({ button: document.getElementById("update") as HTMLButtonElement, flush: () => files!.flush() });

  const repl = new Repl(neocadScope(handles()));

  // ---- workbenches and modules (docs/plans/workbenches.md) -------------------
  //
  // Kept to the wiring: the registry is modules.ts, the files are
  // workbenchhost.ts. The workbench is the document's — written into a saved
  // file's head and read back from one — but never an undo step: the snapshot
  // the undo stack compares carries no head.

  /**
   * The organiser's heading names the workbench, so the tray's set is said
   * somewhere a person reads — when it is not the default: in `part` the
   * heading is today's, pixel for pixel, as the tray is.
   */
  function showWorkbench() {
    const title = document.querySelector<HTMLElement>('.panel[data-panel="organiser"] .ptitle');
    if (!title) return;
    const bench = activeWorkbench();
    // Its own span, which gives way to an ellipsis on a phone's narrow pane
    // rather than wrapping the strip (found by looking at the iPhone picture).
    let tag = title.querySelector<HTMLElement>(".ptbench");
    if (bench === DEFAULT_WORKBENCH) { tag?.remove(); return; }
    if (!tag) {
      // The pane's own word in a span of its own too, so on a phone it is the
      // word that gives way to an ellipsis and the workbench that stays.
      const word = title.firstChild;
      if (word && word.nodeType === Node.TEXT_NODE) {
        const span = document.createElement("span");
        span.className = "ptword";
        span.textContent = word.textContent;
        word.replaceWith(span);
      }
      tag = document.createElement("span");
      tag.className = "ptbench";
      title.firstChild?.after(tag);
    }
    tag.textContent = `· ${getWorkbench(bench)?.label ?? bench}`;
  }

  /** The tray, the menu and the options panel after the tray's set changed. */
  function modulesChanged() {
    syncToolbar();
    panels.apply();
    showWorkbench();
  }

  /** `workbench(name)` and the logo menu's switcher. A tool off the new tray is put down. */
  function switchWorkbench(name: string): string {
    setActiveWorkbench(name);
    const armed = engine.armed?.name;
    if (armed && !onWorkbench(name, armed)) engine.cancel();
    modulesChanged();
    files?.changed();
    return `workbench: ${name} — ${getWorkbench(name)!.modules.join(", ")}`;
  }

  /** A document whose head said it needs modules this device lacks: waiting for Add workbench… to bring them. */
  let waitingDocument: string | null = null;

  /**
   * What a file's head says, after it has opened: the workbench it was in (or
   * the default), and any module it needs that this device lacks — said, with
   * Add workbench… offered, and the rest of the drawing already open.
   */
  function afterOpen(text: string) {
    const head = savedHead(text);
    const bench = head.workbench && getWorkbench(head.workbench) ? head.workbench : DEFAULT_WORKBENCH;
    if (bench !== activeWorkbench()) { setActiveWorkbench(bench); modulesChanged(); }
    if (!head.missing.length) { waitingDocument = null; return; }
    waitingDocument = text;
    for (const m of head.missing) {
      log(`this file needs workbench "${m.name}" (source ${m.hash || "typed"}), which is not on this device: what it made `
        + `(${m.ops.join(", ")}) is left out and the rest is open. Add workbench… (addWorkbench()) to load it — saving `
        + "before then would leave those steps out of the file", "out");
    }
    offerMissing(head.missing.map((m) => m.name));
  }

  /** The "missing workbench" offer: a small question with Add workbench… on it. Never blocks the open. */
  function offerMissing(names: string[]) {
    document.getElementById("wbmissing")?.remove();
    const el = document.createElement("div");
    el.id = "wbmissing";
    el.setAttribute("role", "dialog");
    const head = document.createElement("div");
    head.className = "wbhead";
    head.textContent = `This drawing needs workbench ${names.join(", ")}`;
    const note = document.createElement("div");
    note.className = "wbnote";
    note.textContent = "Not on this device. The rest of the drawing is open; add the workbench file to bring the rest back.";
    const buttons = document.createElement("div");
    buttons.className = "wbbuttons";
    const later = document.createElement("button");
    later.type = "button";
    later.textContent = "Not now";
    later.addEventListener("click", () => el.remove());
    const add = document.createElement("button");
    add.type = "button";
    add.className = "wbyes";
    add.textContent = "Add workbench…";
    add.addEventListener("click", () => { el.remove(); void submit("addWorkbench()"); });
    buttons.append(later, add);
    el.append(head, note, buttons);
    document.body.appendChild(el);
  }

  const workbenchFiles = new WorkbenchFiles({
    evaluate: async (source) => {
      const r = await repl.eval(source);
      if (!r.ok) throw r.error ?? new Error("the file did not run");
    },
    log: (line, cls) => log(line, cls ?? "out"),
    exportFile: (text, name, type) => files!.exportFile(text, name, type),
    changed: () => { repl.define(neocadScope(handles())); modulesChanged(); },
    // A document that was waiting for this module opens whole now.
    added: () => {
      if (waitingDocument && !savedHead(waitingDocument).missing.length) {
        const text = waitingDocument;
        waitingDocument = null;
        asUserAction(() => swapModel(openModelText(text, APP_DIM)));
        log("the drawing that needed it is opened again, whole", "out");
      }
    },
    store: indexedDbWorkbenches(),
  });

  // The workbench files kept on this device, loaded after the built-ins, before
  // the first picture. The autosaved drawing was read before they were: one
  // that needs one of them is read again now it is here, and its head's
  // workbench is put on the tray.
  await workbenchFiles.start();
  if (restored) {
    const text = restored.record.text;
    let needs = false;
    try { needs = Array.isArray(JSON.parse(text).modules) && JSON.parse(text).modules.length > 0; } catch { /* opened already */ }
    if (needs && !savedHead(text).missing.length) swapModel(openModelText(text, APP_DIM));
    afterOpen(text);
  }
  showWorkbench();

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
      `${formFactor(device)}, text size ${textFactor(device).toFixed(2)} (${textSource(device)})`;
    // Under a finger, the target in force (panels.ts's `target`): what every
    // row and button answers a press over, so the size's effect can be read off.
    const hits = coarse ? `; a finger's target ${metrics.hit} px` : "";
    return `interface ${formatScale(uiScale)} (${why})${hits}` +
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
    switches: () => panels.getSwitches(),
    stamp: document.getElementById("buildstamp"),
    repository: "https://github.com/BrotherCreamy/zerocad",
    solidsLicence: solidsLicence(),
    // The modules' File items and the workbench switcher (docs/plans/workbenches.md).
    fileItems: fileMenuItems,
    install: () => installer.offer(),
    workbenches: () => listWorkbenches().map((w) => ({ name: w.name, label: w.label, current: w.name === activeWorkbench(), added: w.origin === "added" })),
    tooltip,
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
    (window as unknown as { __neocad: unknown }).__neocad = { model, engine, repl, render, files, faces: faceLayer ? "depth" : "painter's", bodies: solidBodies, diagnosis: () => diagnosis }; // debug/automation hook
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
    if (/^[A-Za-z_$][\w$]*$/.test(src) && (getToolCtor(src) || ENGINE_TOOLS.includes(src) || toolAlias(src))) {
      try {
        engine.arm(src);
        log(armedLine(src), "out");
      } catch (err) {
        log(String(err instanceof Error ? err.message : err), "err");
        syncToolbar();
        return TYPED_REFUSAL;
      }
      // A frame, not only the toolbar: the chip is synced in the draw pass, and
      // without one it said Select under a tool just armed by name until the
      // next pointer event (found by trimeverything.e2e.ts, mouse and finger).
      render();
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
    // With nothing in hand and nothing selected, Escape leaves the sketch — the
    // chip's Done, typed (docs/plans/sketch-mode.md). Only then: with a tool
    // armed it drops the gesture first, as it always has. Only a work plane
    // (sketch mode): a default frame is a plane chosen for the document with
    // plane() and stays until Done, since the Escape that releases a finished
    // tool arrives with nothing armed and would otherwise drop it unasked.
    const idle = !engine.active && !engine.hand && engine.selection.size === 0;
    const leaving = idle && model.workPlane !== null ? doneCommand(model) : null;
    if (leaving) {
      void submit(leaving);
      return;
    }
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
  /**
   * **What is open, top-most first, and how each is closed** — the one seam
   * Escape and Android's back both close through (docs/plans/android.md). A
   * dialog (Add workbench…'s question, the missing-workbench offer) by its
   * first button, which is the one that does nothing (Cancel, Not now); the
   * tooltip, the menus and a flyout by their own `close`.
   */
  const openings = (): string[] => {
    const shown = (id: string) => { const el = document.getElementById(id); return !!el && !el.hidden; };
    return ["tooltip", "wbconsent", "wbmissing", "ctxmenu", "flyout", "appmenu"].filter(shown);
  };
  const closeOpening = (name: string): void => {
    if (name === "tooltip") tooltips.hide();
    else if (name === "ctxmenu") menu.close();
    else if (name === "flyout") toolbar.close();
    else if (name === "appmenu") appMenu.close();
    else document.getElementById(name)?.querySelector<HTMLButtonElement>("button")?.click();
  };
  const OPENING_WORDS: Record<string, string> = {
    tooltip: "tooltip", wbconsent: "question", wbmissing: "offer", ctxmenu: "menu", flyout: "flyout", appmenu: "menu",
  };

  /**
   * **Android's back closes what is open, and otherwise does nothing**
   * (backstack.ts has the rule and what it cannot promise). The guard that
   * makes a back at rest do nothing is up under a finger and in the installed
   * app; in a desktop's tab Back leaves the page, as it always has, once
   * nothing is open.
   */
  const installed = ["standalone", "fullscreen", "minimal-ui"].some((m) => matchMedia?.(`(display-mode: ${m})`)?.matches);
  // **Not on iOS.** It has no back button: the one thing the session history
  // does there is iOS's own edge swipe — back from the left edge, forward from
  // the right — and every entry pushed here gave it somewhere to go (the
  // owner, 2026-11-06: *"if I swipe right from the left or right side, it
  // takes me "back" or forward. How can I disable this"*). A page cannot turn
  // the swipe off; with the page its only entry, there is nothing to swipe
  // to. So on iOS this pushes nothing: no guard, no entry for what opens.
  // Escape and a tap outside still close what is open. test/e2e/iosback.e2e.ts.
  const pushes = !ios;
  const back = new BackStack(window.history, {
    open: openings,
    close: closeOpening,
    tracked: (name) => pushes && name !== "tooltip",
  }, { guard: pushes && (coarse || installed) });
  // Put up at a press, which carries the gesture an entry needs not to be one Back skips.
  window.addEventListener("pointerup", () => back.arm(), true);
  window.addEventListener("keyup", () => back.arm(), true);
  let wasOpen = new Set<string>();
  const watchOpenings = () => {
    const now = new Set(openings());
    // A press opened it: the browser's user activation is still live as this runs.
    const asked = (navigator as { userActivation?: { isActive: boolean } }).userActivation?.isActive ?? true;
    for (const name of now) if (!wasOpen.has(name)) back.opened(name, asked);
    if ([...wasOpen].some((name) => !now.has(name))) back.closed();
    wasOpen = now;
  };
  const watcher = new MutationObserver(watchOpenings);
  for (const id of ["tooltip", "ctxmenu", "flyout", "appmenu"]) {
    const el = document.getElementById(id);
    if (el) watcher.observe(el, { attributes: true, attributeFilter: ["hidden"] });
  }
  // The dialogs come and go as elements of the body.
  watcher.observe(document.body, { childList: true });
  window.addEventListener("popstate", (e) => {
    const did = back.popped(e.state);
    wasOpen = new Set(openings());
    if (typeof did === "object") log(`back: ${OPENING_WORDS[did.closed] ?? did.closed} closed`, "out");
    syncToolbar();
  });

  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    // What is open first, and then nothing else. Escape means "undo the last
    // thing that appeared", and with a menu on screen that is the menu —
    // cancelling the gesture underneath it as well would abandon a half-drawn
    // rectangle that the user was only right-clicking to look away from. (The
    // tooltip and a flyout take their own Escape first, in the capture phase.)
    const top = openings().find((name) => name !== "tooltip");
    if (top) {
      closeOpening(top);
      log(`${OPENING_WORDS[top] ?? top} closed`, "out");
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
   * **Holding Space is a temporary Hand** (docs/plans/select-hand.md): while
   * it is down a left-drag pans from anywhere, over whatever is armed, and
   * when it comes up the tool that was armed is lit again — it never went
   * anywhere (`ToolEngine.hold`). The convention of every drawing program
   * that has a hand. **Not while something takes typing or pressing has the
   * focus** — the command line above all, whose Space is a space, and a
   * focused button, whose Space presses it. On a desktop the line has the
   * focus at start and after a button; a press on the canvas takes it away,
   * which is when the hand is on the drawing anyway. Nothing is typed: Space
   * is a way of holding the pointer, as the middle button is, and the view is
   * not the model.
   */
  const takesKeys = (at: Element | null) => at instanceof HTMLElement && (at.isContentEditable
    || at instanceof HTMLInputElement || at instanceof HTMLTextAreaElement
    || at instanceof HTMLSelectElement || at instanceof HTMLButtonElement);
  window.addEventListener("keydown", (e) => {
    if (e.key !== " " || e.ctrlKey || e.metaKey || e.altKey || takesKeys(document.activeElement)) return;
    e.preventDefault(); // nor a scroll, nor a click on whatever the page thinks is focused
    if (engine.hold(true)) syncToolbar();
  });
  // Let go wherever the focus has gone since, and when the window loses the
  // key-up altogether (switched away mid-hold), so the Hand never sticks.
  window.addEventListener("keyup", (e) => { if (e.key === " " && engine.hold(false)) syncToolbar(); });
  window.addEventListener("blur", () => { if (engine.hold(false)) syncToolbar(); });

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
    // Space with nothing editable focused is the temporary Hand (below), not
    // the first character of a line: a command never starts with one.
    if (e.key === " ") return;
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

  // **A restored drawing is solved before it is called ready**: one autosaved
  // holding a conflict used to open reading "ready", its relations in the
  // sketch's ink, until the next edit solved it — the stale readout again,
  // found by the conflict e2e's reload (docs/plans/conflict-detection.md).
  // A CONFLICT stays up; a drawing that solves is "ready", as a fresh one is.
  const opening = restored ? solveAndRender() : null;
  render();
  if (!opening || opening.solved) statusLine.show("ready", "ready — type help(), a tool name, or any expression");
  log("type help() for the command surface");
  // **The keyboard stays away until asked for.** A focused field on iOS is a
  // keyboard over the drawing (raised by the next tap, if not by this), so
  // under a finger the command line waits to be tapped, as any field does.
  if (!coarse) cmdEl.focus();
}

// Before the kernel loads, so a pinch during the wait cannot zoom the page
// either (pagelock.ts).
lockPage(document);

// **No browser menu on the chrome** (docs/plans/android.md): Chrome on Android
// raises `contextmenu` for a long-press, and a tray button held for its
// tooltip or its flyout was the one surface that let it through (the canvas,
// the logo and the menus cancel their own) — found by the Android e2e. Where
// there is text to take — the command line, the log, a field — the browser's
// menu (copy, paste) stays.
document.addEventListener("contextmenu", (e) => {
  const at = e.target instanceof Element ? e.target : null;
  if (at?.closest("#cmd, #log, input, textarea")) return;
  e.preventDefault();
});

main().catch((e) => {
  statusLine.show("error", "ERROR — see log");
  log(String((e && e.stack) || e), "err");
  console.error(e);
});
