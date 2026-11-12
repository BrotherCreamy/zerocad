// **A module is the unit** (docs/plans/workbenches.md). The owner: *"the whole
// framework should be modular and extensible (!). like onshape workbenches"*.
//
// A module is one file that registers everything it brings through one call,
// `defineModule(name, spec)`: its tools (with their icons and toolbar groups),
// its relations (the names they are typed by, where `_` may stand, and the
// journal op a file replays), its operations' and entity constructors' replay
// entries, its entity kinds, its menu items and its help. Every table that used
// to be written by hand beside the code it described — `TOOL_ICONS`,
// `TOOL_GROUPS`, the menu's tool items, the relation vocabulary, persist.ts's
// replay table, help()'s text — is filled from here, in module order, when
// each module loads. The app is the built-in modules (src/modules/), loaded at
// start in a fixed order; a workbench file the person adds is one more.
//
// **Where it sits.** In the `tools/ | operations.ts | persist.ts` row: it
// registers tools into the registry below it and hands persist.ts and
// replenv.ts what they read. Nothing below it imports it. The entity kinds a
// module declares are handed to each layer's own registry — the model's for
// structure, curveplane's for the frame a curve is sampled by, loops',
// picking's and step's for what each of them asks — so each layer still knows
// only what its own facet says, and the kernel still knows nothing.
//
// **Refusals are whole.** A module whose spec names something already
// registered — a tool, a relation's typed name or op, an operation, an entity
// kind, an icon — is refused with that name before anything is registered, so
// a refused module leaves nothing behind. A group may be extended by any
// number of modules: the shapes group is the sketch module's, and a later
// module adds to it; members keep module order.

import type { Model } from "./model.ts";
import { slots, type Slot } from "./clauses.ts";
import { defineTool, getToolCtor, listTools, undefineTool, defineGroup, ungroupTool, type ToolCtor } from "./tools/tool.ts";
import { defineIcon, undefineIcon, hasIcon } from "./tools/icons.ts";
import { defineDimension, defineEntityKind, undefineEntityKind, entityKind, type EntityKindSpec } from "./model.ts";
import { defineRebuild } from "./operations.ts";
import { defineTwin, type TwinKind } from "./twins.ts";
import { defineCurveFrame, undefineCurveFrame, defineCurvePath, undefineCurvePath, type CurveFrameFn, type CurvePathFn } from "./curveplane.ts";
import { defineDescriber, undefineDescriber, type Describer } from "./picking.ts";
import { defineStepCurve, undefineStepCurve, type StepCurveWriter } from "./step.ts";
import { defineSampler, undefineSampler, type Sampler } from "./projection.ts";

type Fn = (...args: unknown[]) => unknown;

/**
 * A relation as a module declares it. Keyed in `ModuleSpec.relations` by its
 * **journal op** — the name a saved file replays (`parallel`) — unless `op` is
 * false, for a typed-only spelling that journals another relation
 * (`horizontal` journals the `parallel` it expands to).
 */
export interface RelationDecl {
  /** The names it is typed by, short first: `["par", "parallel"]`. */
  names: string[];
  /** Where `_` may stand (clauses.ts); `#` marks a number. */
  slots: (Slot | string)[];
  /** `(model, ...args)` → the relation's name. What both the typed call and a replay run. */
  fn: (model: Model, ...args: never[]) => string;
  /** The typed form, where it differs from the replayed one (`fix` lifts two coordinates to three). */
  typed?: (model: Model, ...args: never[]) => string;
  /** False: typed only, nothing of this name in a file. */
  op?: false;
  /**
   * A dimension: which of its arguments is its value (`rad`'s is 1). It is then
   * `d`-named, `set` re-runs it with the new value, and its label is a number.
   */
  dimension?: number;
  /**
   * Whether it has a **twin across a link** (docs/plans/linked-profiles.md,
   * twins.ts): `"shape"` for a relation between entities that holds wherever
   * they are moved together (`dist`, `tan`, `eq`), `"direction"` for one that
   * may also name a frame's axis (`par`, `perp`, `ang`). Left out for a
   * relation that says *where* (`fix`, `onplane`) — twinned, it would pin an
   * extrude's lid where its base is.
   */
  twin?: TwinKind;
}

/** A command a module adds to the command line, built when a scope is (see `ModuleKit`). */
export type CommandFactory = (kit: ModuleKit) => Record<string, unknown>;

/**
 * What a module's typed commands are given: the model and the command line's
 * own helpers — `clauses` wraps a constructor so it takes clauses as `pt` and
 * `circ` do, `anchor` makes the free point a constructor hangs its pieces off
 * (the middle of the view), `facing` reads a curve's typed plane. Built by
 * replenv.ts, which owns them; a module never imports the command surface.
 */
export interface ModuleKit {
  model: Model;
  clauses<F extends (...args: never[]) => string>(who: string, make: F): (...args: unknown[]) => string;
  anchor(): string | null;
  facing(plane: unknown): { seed: number[] | null; hold: string | null };
  /** One line to the log, as a typed command's notes are said (`regen`'s "hole c1 is gone"); absent where there is none. */
  log?(line: string): void;
}

/** An entity kind as a module declares it: the model's structure facet, and what the layers above ask of it. */
export interface EntityDecl extends EntityKindSpec {
  /** Its constructor, by the journal op a file replays (`addEllipse`). */
  add: { op: string; fn: (model: Model, ...args: never[]) => unknown };
  /** The frame it is sampled by, as `curveFrame` lays a circle out (curveplane.ts) — drawn, boxed, looped and picked by it. */
  frame?: CurveFrameFn;
  /**
   * The exact B-spline it is, for a kind that is no conic (curveplane.ts's
   * `curvePath`) — drawn, picked, looped, extruded and written to STEP by it,
   * as a frame lays a circle out (docs/plans/spline.md).
   */
  path?: CurvePathFn;
  /** The hover tag's line for one (picking.ts's `describeEntity`). */
  describe?: Describer;
  /** How a solid's edge or a loose curve of this kind is written to STEP (step.ts). */
  step?: StepCurveWriter;
  /**
   * For a kind with no frame: the world polyline it is drawn as and picked by
   * (projection.ts) — closed back to its start when `closed`. A sampled kind
   * bounds no region and goes to no STEP file (docs/plans/workbenches.md).
   */
  samples?: Sampler;
}

/** A menu tool item: the label the empty-canvas menu shows, and the tool it arms. */
export interface MenuToolItem { label: string; tool: string }

/** A File item in the logo's menu: what it is called and the command it types. */
export interface FileMenuItem { label: string; command: string }

export interface ModuleSpec {
  /** A word or two for the menu and help: `"Sketch: curves, shapes and the curve relations"`. */
  label?: string;
  /** Tools by the name they are armed by, in toolbar order. `{ ctor, listed: false }` keeps one off the toolbar. */
  tools?: Record<string, ToolCtor | { ctor: ToolCtor; listed?: boolean }>;
  /** Toolbar glyphs (tools/icons.ts's family), by tool name. */
  icons?: Record<string, string>;
  /** Toolbar groups this module owns or extends: group → members in button order. */
  groups?: Record<string, string[]>;
  /** The relation vocabulary, keyed by journal op. See `RelationDecl`. */
  relations?: Record<string, RelationDecl>;
  /** Operations a file replays, by journal op: `(model, ...args)`. Their typed forms are commands. */
  operations?: Record<string, (model: Model, ...args: never[]) => unknown>;
  /** Anything else a file replays that is the model's own: `(model) => (...args) => …`. */
  replay?: Record<string, (model: Model) => Fn>;
  /** Entity kinds. See `EntityDecl`. */
  entities?: EntityDecl[];
  /** The empty-canvas menu's tool items. */
  menu?: MenuToolItem[];
  /** The logo menu's File items. */
  files?: FileMenuItem[];
  /** help()'s lines, each section headed as help() heads them. */
  help?: string[] | (() => string[]);
  /** Typed commands the module adds. */
  commands?: CommandFactory;
}

/** A module once loaded: its spec, and what it registered, by name. */
export interface LoadedModule {
  name: string;
  spec: ModuleSpec;
  /** Where it came from: built in, defined at the command line, or a workbench file (its hash). */
  origin: "builtin" | "typed" | { file: string; hash: string };
  tools: string[];
  relations: string[];
  ops: string[];
  entities: string[];
  /** The text that defined it, when one did: a workbench file's, or the command-line entries a typed module grew from. */
  source?: string;
}

const modules = new Map<string, LoadedModule>();
/** A counter for the pieces `extendModule` registers before folding them into the module they extend. */
let pieces = 0;

/** What a refusal names a thing as. */
const what = (kind: string, name: string) => `${kind} ${JSON.stringify(name)}`;

/** Which loaded module registered `thing` among its `key`s, if any. */
function ownerOf(key: "tools" | "relations" | "ops" | "entities", thing: string, except?: string): string | null {
  for (const m of modules.values()) if (m.name !== except && m[key].includes(thing)) return m.name;
  return null;
}

/** The typed names a module's relations take, every spelling. */
function relationNames(spec: ModuleSpec): string[] {
  return Object.values(spec.relations ?? {}).flatMap((r) => r.names);
}

/** Every op a module's spec puts in the replay table. */
function opsOf(spec: ModuleSpec): string[] {
  return [
    ...Object.entries(spec.relations ?? {}).filter(([, r]) => r.op !== false).map(([op]) => op),
    ...Object.keys(spec.operations ?? {}),
    ...Object.keys(spec.replay ?? {}),
    ...(spec.entities ?? []).map((e) => e.add.op),
  ];
}

/**
 * Checks a spec against everything already loaded and against itself — every
 * refusal names the thing — and changes nothing. `except` is a module being
 * replaced, whose own names do not count against it.
 */
export function checkModule(name: string, spec: ModuleSpec, except?: string): void {
  if (typeof name !== "string" || !/^[A-Za-z][\w-]*$/.test(name)) {
    throw new Error(`a module's name is a word — letters, digits, _ or -, starting with a letter — got ${JSON.stringify(name)}`);
  }
  if (spec === null || typeof spec !== "object") throw new Error(`defineModule("${name}", spec): spec is an object of what it registers`);
  const seen = new Set<string>();
  const once = (kind: string, thing: string) => {
    const key = `${kind}:${thing}`;
    if (seen.has(key)) throw new Error(`module "${name}" registers ${what(kind, thing)} twice`);
    seen.add(key);
  };
  const refuse = (kind: string, thing: string, owner: string) => {
    throw new Error(`module "${name}" registers ${what(kind, thing)}, which module "${owner}" already has — name it something else`);
  };
  for (const tool of Object.keys(spec.tools ?? {})) {
    once("tool", tool);
    const owner = ownerOf("tools", tool, except);
    if (owner) refuse("tool", tool, owner);
    if (getToolCtor(tool) && !ownerOf("tools", tool)) refuse("tool", tool, "user");
  }
  for (const icon of Object.keys(spec.icons ?? {})) {
    once("icon", icon);
    if (hasIcon(icon) && !(except && modules.get(except)?.spec.icons?.[icon])) refuse("icon", icon, iconOwner(icon) ?? "core");
  }
  const known = new Set<string>();
  for (const m of modules.values()) if (m.name !== except) for (const n of m.relations) known.add(n);
  for (const n of relationNames(spec)) {
    once("relation", n);
    if (known.has(n)) refuse("relation", n, ownerOf("relations", n, except)!);
  }
  for (const op of opsOf(spec)) {
    once("op", op);
    const owner = ownerOf("ops", op, except);
    if (owner) refuse("op", op, owner);
  }
  for (const e of spec.entities ?? []) {
    once("entity kind", e.kind);
    const owner = ownerOf("entities", e.kind, except);
    if (owner || (entityKind(e.kind) && !except)) refuse("entity kind", e.kind, owner ?? "model");
  }
  for (const [tool, entry] of Object.entries(spec.tools ?? {})) {
    const ctor = typeof entry === "function" ? entry : entry?.ctor;
    if (typeof ctor !== "function") throw new Error(`module "${name}": tool ${JSON.stringify(tool)} is not a class`);
  }
  for (const [group, members] of Object.entries(spec.groups ?? {})) {
    if (!Array.isArray(members) || !members.every((m) => typeof m === "string")) {
      throw new Error(`module "${name}": group ${JSON.stringify(group)} is a list of tool names`);
    }
  }
}

function iconOwner(icon: string): string | null {
  for (const m of modules.values()) if (m.spec.icons && Object.hasOwn(m.spec.icons, icon)) return m.name;
  return null;
}

/**
 * Loads a module: checks it whole, then registers everything it brings, in
 * the order the spec lists it. Answers what it registered.
 */
export function defineModule(name: string, spec: ModuleSpec, origin: LoadedModule["origin"] = "typed"): LoadedModule {
  if (modules.has(name)) {
    throw new Error(`module "${name}" is already loaded — a module is loaded once; removeModule("${name}") first`);
  }
  // Slots may be written as clauses.ts spells them — "point", "#distance" — by a
  // module typed or loaded from a file; held as `Slot`s from here on.
  for (const decl of Object.values(spec.relations ?? {})) {
    if (Array.isArray(decl?.slots)) decl.slots = decl.slots.map((s) => (typeof s === "string" ? slots(s)[0] : s));
  }
  checkModule(name, spec);
  if (loading) {
    const why = manifestDisagrees(loading.manifest, name, spec);
    if (why) throw new Error(`refused — ${why}. Nothing was registered.`);
  }
  // Kinds first: a tool's class or a relation may name one at load.
  for (const e of spec.entities ?? []) {
    defineEntityKind(e);
    if (e.frame) defineCurveFrame(e.kind, e.frame);
    if (e.path) defineCurvePath(e.kind, e.path);
    if (e.describe) defineDescriber(e.kind, e.describe);
    if (e.step) defineStepCurve(e.kind, e.step);
    if (e.samples) defineSampler(e.kind, e.samples, e.closed === true);
  }
  for (const [op, decl] of Object.entries(spec.relations ?? {})) {
    if (decl.twin && decl.op !== false) defineTwin(op, decl.fn, decl.twin);
    if (decl.dimension === undefined || decl.op === false) continue;
    defineDimension(op, decl.dimension);
    const fn = decl.fn as (model: Model, ...args: unknown[]) => unknown;
    defineRebuild(op, (model, args) => void fn(model, ...args));
  }
  for (const [icon, svg] of Object.entries(spec.icons ?? {})) defineIcon(icon, svg);
  for (const [group, members] of Object.entries(spec.groups ?? {})) defineGroup(group, members);
  for (const [tool, entry] of Object.entries(spec.tools ?? {})) {
    if (typeof entry === "function") defineTool(tool, entry);
    else defineTool(tool, entry.ctor, { listed: entry.listed ?? true });
  }
  const loaded: LoadedModule = {
    name, spec, origin,
    tools: Object.keys(spec.tools ?? {}),
    relations: relationNames(spec),
    ops: opsOf(spec),
    entities: (spec.entities ?? []).map((e) => e.kind),
  };
  modules.set(name, loaded);
  return loaded;
}

/**
 * Unloads a module: its tools, icons, group members, relations, ops and
 * workbenches go now. Its entity kinds stay registered while any entity of
 * theirs could still be on screen — a kind cannot be taken from under a model
 * that holds one — and go at the next start, since an added module that was
 * removed is not loaded then. Built-ins cannot be removed.
 */
export function removeModule(name: string): LoadedModule {
  const m = modules.get(name);
  if (!m) throw new Error(`no module "${name}" is loaded`);
  if (m.origin === "builtin") throw new Error(`"${name}" is built in — it cannot be removed`);
  for (const tool of m.tools) { undefineTool(tool); ungroupTool(tool); }
  for (const icon of Object.keys(m.spec.icons ?? {})) undefineIcon(icon);
  modules.delete(name);
  for (const [wb, w] of workbenches) if (w.origin !== "builtin" && w.modules.includes(name)) workbenches.delete(wb);
  return m;
}

/** Drops a module's entity kinds too — for a test, or a host that knows no entity of them is held. */
export function forgetKinds(m: LoadedModule): void {
  for (const e of m.spec.entities ?? []) {
    undefineEntityKind(e.kind);
    undefineCurveFrame(e.kind);
    undefineCurvePath(e.kind);
    undefineDescriber(e.kind);
    undefineStepCurve(e.kind);
    undefineSampler(e.kind);
  }
}

/**
 * A short, stable hash of a text — FNV-1a, 64 bits, as 16 hex digits. What a
 * document's head records a module's source by; not a security measure (the
 * consent is), only "is this the same file".
 */
export function textHash(text: string): string {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < text.length; i++) {
    h ^= BigInt(text.charCodeAt(i));
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, "0");
}

/** The hash a document records a module by: its file's or its typed source's, or "" for one with none. */
export function moduleHash(m: LoadedModule): string {
  if (typeof m.origin === "object") return m.origin.hash;
  return m.source ? textHash(m.source) : "";
}

/** Marks a module as one the app ships — loaded at every start, never removed. builtin.ts's, once each has loaded. */
export function markBuiltin(name: string): void {
  const m = modules.get(name);
  if (!m) throw new Error(`no module "${name}" is loaded`);
  m.origin = "builtin";
}

/** One line of what a module registers, by name: what `modules()` and the consent read. */
export function describeModule(m: LoadedModule): string {
  const parts: string[] = [];
  const list = (word: string, names: string[]) => { if (names.length) parts.push(`${word} ${names.join(", ")}`); };
  list("tools", m.tools.filter((t) => listTools().includes(t)));
  list("relations", Object.entries(m.spec.relations ?? {}).map(([, r]) => r.names[0]));
  list("operations", Object.keys(m.spec.operations ?? {}));
  list("entities", m.entities);
  const origin = m.origin === "builtin" ? "built in" : m.origin === "typed" ? "typed" : `from ${m.origin.file}`;
  return `${parts.join("; ") || "help and menu items only"}  (${origin})`;
}

/**
 * Adds to a module that grows: the `user` module, which `defineRelation`,
 * `defineOperation` and `defineEntity` at the command line join, as
 * `defineTool` puts a tool on the tray with no module. Made on first use;
 * checked whole, as `defineModule` checks, before anything is added.
 */
export function extendModule(name: string, spec: ModuleSpec, source?: string): LoadedModule {
  const m = modules.get(name);
  if (!m) {
    const made = defineModule(name, spec, "typed");
    if (source) made.source = source;
    return made;
  }
  checkModule(name, spec);
  const piece = defineModule(`${name}-piece-${++pieces}`, spec, "typed");
  modules.delete(piece.name);
  const merge = <T>(a: Record<string, T> | undefined, b: Record<string, T> | undefined) => ({ ...(a ?? {}), ...(b ?? {}) });
  m.spec = {
    ...m.spec,
    tools: merge(m.spec.tools, spec.tools),
    icons: merge(m.spec.icons, spec.icons),
    relations: merge(m.spec.relations, spec.relations),
    operations: merge(m.spec.operations, spec.operations),
    replay: merge(m.spec.replay, spec.replay),
    entities: [...(m.spec.entities ?? []), ...(spec.entities ?? [])],
  };
  m.tools.push(...piece.tools);
  m.relations.push(...piece.relations);
  m.ops.push(...piece.ops);
  m.entities.push(...piece.entities);
  if (source) m.source = m.source ? `${m.source}\n${source}` : source;
  return m;
}

/**
 * **A workbench file's manifest** (docs/plans/workbenches.md): what the file
 * says it registers, read from the comment at its top — *not by running it* —
 * so the person is asked about what they can see before anything runs.
 *
 * ```js
 * /* zerocad-workbench
 * { "name": "gears", "label": "Gears", "tools": ["gear"], "relations": ["mesh"],
 *   "operations": [], "entities": ["involute"], "workbench": "gears" }
 * *\/
 * defineModule("gears", { … });
 * defineWorkbench("gears", { modules: ["core", "sketch", "gears"] });
 * ```
 */
export interface Manifest {
  name: string;
  label?: string;
  tools: string[];
  relations: string[];
  operations: string[];
  entities: string[];
  /** The workbench the file defines, if it defines one. */
  workbench?: string;
}

/** The manifest at the top of a workbench file, or a refusal saying what is wrong with it. Runs nothing. */
export function readManifest(source: string): Manifest {
  const m = /^\s*\/\*\s*zerocad-workbench\s*([\s\S]*?)\*\//.exec(source);
  if (!m) throw new Error("this is not a workbench file: it has no /* zerocad-workbench { … } */ manifest at its top");
  let raw: unknown;
  try { raw = JSON.parse(m[1]); } catch (e) {
    throw new Error(`the workbench file's manifest is not JSON: ${e instanceof Error ? e.message : e}`);
  }
  const r = raw as Record<string, unknown>;
  const names = (key: string): string[] => {
    const v = r?.[key] ?? [];
    if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) throw new Error(`the manifest's ${key} is a list of names`);
    return v as string[];
  };
  if (!r || typeof r.name !== "string" || !/^[A-Za-z][\w-]*$/.test(r.name)) throw new Error("the manifest names its module: \"name\": \"gears\"");
  const out: Manifest = {
    name: r.name, tools: names("tools"), relations: names("relations"), operations: names("operations"), entities: names("entities"),
  };
  if (typeof r.label === "string") out.label = r.label;
  if (typeof r.workbench === "string") out.workbench = r.workbench;
  return out;
}

/** Where the manifest and what `defineModule` was handed disagree, said by name; null when they agree exactly. */
export function manifestDisagrees(manifest: Manifest, name: string, spec: ModuleSpec): string | null {
  if (name !== manifest.name) return `the manifest says module "${manifest.name}", the file defines "${name}"`;
  const said: [string, string[], string[]][] = [
    ["tools", manifest.tools, Object.keys(spec.tools ?? {})],
    ["relations", manifest.relations, Object.values(spec.relations ?? {}).map((r) => r.names[0])],
    ["operations", manifest.operations, Object.keys(spec.operations ?? {})],
    ["entities", manifest.entities, (spec.entities ?? []).map((e) => e.kind)],
  ];
  for (const [what, claimed, real] of said) {
    const extra = real.filter((x) => !claimed.includes(x));
    const absent = claimed.filter((x) => !real.includes(x));
    if (extra.length) return `the file registers ${what} its manifest does not show: ${extra.join(", ")}`;
    if (absent.length) return `the manifest shows ${what} the file does not register: ${absent.join(", ")}`;
  }
  return null;
}

/** The workbench file being loaded now, if one is: what `defineModule` checks against. */
export interface FileLoad { fileName: string; hash: string; manifest: Manifest }
let loading: FileLoad | null = null;

export function fileLoading(): FileLoad | null {
  return loading;
}

/**
 * Runs `body` — the file's evaluation — with `load` in force: the one
 * `defineModule` it makes must be the manifest's module, registering exactly
 * what the manifest shows, or it is refused before anything is registered. A
 * file that defines no module, or a module other than its manifest's, is
 * refused after (`body` may have run its top level by then: the consent was to
 * run it; the REPL's scope is curated, not a sandbox).
 */
export async function loadingFile<T>(load: FileLoad, body: () => Promise<T>): Promise<T> {
  if (loading) throw new Error(`a workbench file is already loading (${loading.fileName})`);
  loading = load;
  try {
    const out = await body();
    if (!modules.has(load.manifest.name)) throw new Error(`the file defines no module "${load.manifest.name}", which its manifest names`);
    return out;
  } finally {
    loading = null;
  }
}

/** The loaded modules, in load order. */
export function loadedModules(): LoadedModule[] {
  return [...modules.values()];
}

export function getModule(name: string): LoadedModule | undefined {
  return modules.get(name);
}

/** The module that registered `tool`, or null for one defined at the command line outside any module. */
export function moduleOfTool(tool: string): string | null {
  return ownerOf("tools", tool);
}

/** The module whose op `op` is, or null. What a document's head records a module by. */
export function moduleOfOp(op: string): string | null {
  return ownerOf("ops", op);
}

// ---- what the tables read ------------------------------------------------------

/** Every relation, in module order: `[op or null, decl]`. */
export function moduleRelations(): { op: string | null; decl: RelationDecl; module: string }[] {
  return loadedModules().flatMap((m) => Object.entries(m.spec.relations ?? {})
    .map(([op, decl]) => ({ op: decl.op === false ? null : op, decl, module: m.name })));
}

/** persist.ts's replay table, for one model: every op a loaded module registered, in module order. */
export function replayEntries(model: Model): [string, Fn][] {
  const out: [string, Fn][] = [];
  const call = (fn: (model: Model, ...a: never[]) => unknown) => (...args: unknown[]) =>
    (fn as (model: Model, ...a: unknown[]) => unknown)(model, ...args);
  for (const m of loadedModules()) {
    const s = m.spec;
    for (const e of s.entities ?? []) out.push([e.add.op, call(e.add.fn)]);
    for (const [op, make] of Object.entries(s.replay ?? {})) out.push([op, make(model)]);
    for (const [op, decl] of Object.entries(s.relations ?? {})) if (decl.op !== false) out.push([op, call(decl.fn)]);
    for (const [op, fn] of Object.entries(s.operations ?? {})) out.push([op, call(fn)]);
  }
  return out;
}

/** The empty-canvas menu's tool items, in module order. */
export function menuToolItems(): MenuToolItem[] {
  return loadedModules().flatMap((m) => m.spec.menu ?? []);
}

/** The logo menu's File items, in module order. */
export function fileMenuItems(): FileMenuItem[] {
  return loadedModules().flatMap((m) => m.spec.files ?? []);
}

/** help()'s lines, in module order. */
export function moduleHelp(): string[] {
  return loadedModules().flatMap((m) => {
    const h = m.spec.help;
    return typeof h === "function" ? h() : h ?? [];
  });
}

/** The commands every module adds, built over one kit, in module order. */
export function moduleCommands(kit: ModuleKit): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const m of loadedModules()) if (m.spec.commands) Object.assign(out, m.spec.commands(kit));
  return out;
}

// ---- workbenches -------------------------------------------------------------

/**
 * **A workbench is a named set of modules with its own toolbar** — Onshape's
 * Part Studio and its siblings. The tray shows the tools of its modules, in
 * their groups, in module order; the menu's tool items likewise. A typed name
 * from any loaded module works in any workbench: a typed call is not a toolbar.
 */
export interface Workbench {
  name: string;
  label: string;
  modules: string[];
  origin: "builtin" | "added";
}

const workbenches = new Map<string, Workbench>();

/** The workbench a new document opens in: `part`, today's toolbar exactly. */
export const DEFAULT_WORKBENCH = "part";

let active = DEFAULT_WORKBENCH;

/**
 * The workbench the tray and the menu show now. The document's (main.ts sets
 * it from a file's head and from `workbench(name)`), kept here as the one
 * answer the menu and the toolbar host both read; never journalled.
 */
export function activeWorkbench(): string {
  return workbenches.has(active) ? active : DEFAULT_WORKBENCH;
}

/**
 * Old names a workbench is still known by: `sketch` was the drawing
 * workbench's until 2026-11-12 (docs/plans/no-sketch.md), and a file's head
 * from before says it. Read by `workbenchName`, so `workbench("sketch")` typed
 * and a saved `"workbench": "sketch"` both open the drawing workbench; never
 * listed, never written back (a save writes the name the workbench has now).
 */
export const WORKBENCH_ALIASES: Readonly<Record<string, string>> = { sketch: "drawing" };

/** `name` as the workbench it means now: itself, or the workbench an old name stands for; unchanged when neither is defined. */
export function workbenchName(name: string): string {
  if (workbenches.has(name)) return name;
  const alias = Object.hasOwn(WORKBENCH_ALIASES, name) ? WORKBENCH_ALIASES[name] : null;
  return alias !== null && workbenches.has(alias) ? alias : name;
}

export function setActiveWorkbench(name: string): void {
  const real = workbenchName(name);
  if (!workbenches.has(real)) {
    throw new Error(`no workbench "${name}" — ${listWorkbenches().map((w) => JSON.stringify(w.name)).join(", ")}`);
  }
  active = real;
}

export function defineWorkbench(name: string, spec: { modules: string[]; label?: string }, origin: Workbench["origin"] = "added"): Workbench {
  if (typeof name !== "string" || !/^[A-Za-z][\w-]*$/.test(name)) {
    throw new Error(`a workbench's name is a word, got ${JSON.stringify(name)}`);
  }
  if (workbenches.has(name)) throw new Error(`workbench "${name}" is already defined`);
  if (!spec || !Array.isArray(spec.modules) || spec.modules.length === 0) {
    throw new Error(`defineWorkbench("${name}", { modules: ["core", …] }) — a workbench is a list of modules`);
  }
  for (const m of spec.modules) if (!modules.has(m)) throw new Error(`workbench "${name}" names module "${m}", which is not loaded`);
  const w: Workbench = { name, label: spec.label ?? name[0].toUpperCase() + name.slice(1), modules: [...spec.modules], origin };
  workbenches.set(name, w);
  return w;
}

export function removeWorkbench(name: string): void {
  const w = workbenches.get(name);
  if (!w) throw new Error(`no workbench "${name}"`);
  if (w.origin === "builtin") throw new Error(`"${name}" is built in — it cannot be removed`);
  workbenches.delete(name);
}

/** The workbench `name` means — by its name, or by an old one (`WORKBENCH_ALIASES`) — or undefined. */
export function getWorkbench(name: string): Workbench | undefined {
  return workbenches.get(workbenchName(name));
}

/** Built-in workbenches first, then added ones, each in definition order. */
export function listWorkbenches(): Workbench[] {
  const all = [...workbenches.values()];
  return [...all.filter((w) => w.origin === "builtin"), ...all.filter((w) => w.origin !== "builtin")];
}

/**
 * Whether `tool` is on `workbench`'s tray: a tool of one of its modules, or one
 * defined at the command line outside any module (the `user` module's — the
 * person put it there, and it is on every tray).
 */
export function onWorkbench(workbench: string, tool: string): boolean {
  const w = workbenches.get(workbench);
  if (!w) return true;
  const owner = moduleOfTool(tool);
  if (owner === null || w.modules.includes(owner)) return true;
  // A module no workbench names — typed at the command line, pasted — is on
  // every tray, as a tool typed there is: the person put it there.
  return ![...workbenches.values()].some((b) => b.modules.includes(owner));
}

/** The listed tools on `workbench`'s tray, in registration order. */
export function workbenchTools(workbench: string): string[] {
  return listTools().filter((t) => onWorkbench(workbench, t));
}

/** For a test: forget every module and workbench that is not built in. */
export function resetAdded(): void {
  for (const m of [...modules.values()]) if (m.origin !== "builtin") { removeModule(m.name); forgetKinds(m); }
  for (const w of [...workbenches.values()]) if (w.origin !== "builtin") workbenches.delete(w.name);
}
