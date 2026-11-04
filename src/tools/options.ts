// A tool's options: what it declares it can be armed with, how an `arm` call is
// checked against that, and the values a viewer used last.
//
// The owner (docs/plans/effortless.md): *"things should be as easy as every
// other cad tool makes them, by using defaults etc, but then I should be able
// to customise everything also if I want. if the tool has options, there should
// also be some kind of e.g. pop-up menu that allows me to set them visually, or
// it happens in the terminal or whatever."* So a tool **declares** its options —
// `static options = { depth: { default: 10, unit: "length" } }` — and
// everything else is read off the declaration: `arm` refuses what it does not
// name and fills what was left out, `tools()` and `help()` list it, and the
// options panel (panels.ts) is built from it. A tool typed at the command line
// with a `static options` therefore gets all of that by declaring it, exactly
// as a built-in does; a tool that declares none is armed as it always was, its
// options handed over unread.
//
// **The last value is the next default** (Onshape remembers the last extrude
// depth). It is remembered when a tool is *armed* with it, typed or by the
// panel, not when a feature is made with it: the panel types `arm`, and arming
// is the one moment every way of choosing a value goes through. It is the
// viewer's, like their panel layout — kept in `localStorage` under its own key,
// never in the journal or a file, and every touch of storage wrapped, so a
// private window costs the viewer their memory and nothing else.
//
// Nothing here knows what a model is; it is about tools, and plain values.

/**
 * What an option holds. Numbers first — most built-ins' are; a flag is allowed
 * in the shape; and a word from a fixed list (`choices`), which the panel shows
 * as a row of buttons — an extrude's mode (docs/plans/solids-kernel.md).
 */
export type OptionValue = number | boolean | string;

/** One declared option. */
export interface OptionSpec {
  /** The value when nothing was typed and nothing is remembered. Its type is the option's type. */
  default: OptionValue;
  /**
   * What the number measures: `"length"` (the drawing's own units, which have
   * no name), `"angle"` (radians, as everywhere an angle is typed), or any
   * other text, shown as it is after the field.
   */
  unit?: string;
  /** The panel's name for the row; the option's own name when left out. */
  label?: string;
  /**
   * Why `value` will not do, or null when it will — for what the type alone
   * cannot say (a depth of 0 is a number and no solid). Says the rest of
   * "extrude's depth …", so it reads in the refusal.
   */
  check?: (value: OptionValue) => string | null;
  /**
   * The words a text option may be — required when its default is text, and
   * the default among them. The panel shows a button per word but the first,
   * which is the default's "none of these": pressing the button already down
   * goes back to it (an extrude's `auto`, which lets the call decide).
   */
  choices?: readonly string[];
  /**
   * False: never the next default. A value the viewer chose for one feature
   * that would be wrong for the next — a cut — starts from the declared
   * default at every arm, whatever the last one was.
   */
  remember?: boolean;
}

export type OptionSpecs = Readonly<Record<string, OptionSpec>>;

const kindOf = (v: OptionValue): "number" | "boolean" | "string" =>
  (typeof v === "number" ? "number" : typeof v === "string" ? "string" : "boolean");

/** A value as `arm` would be typed with it: numbers rounded for reading, flags as written, words quoted. */
export function formatValue(v: OptionValue): string {
  return typeof v === "number" ? String(Math.round(v * 1e6) / 1e6) : typeof v === "string" ? JSON.stringify(v) : String(v);
}

/** A key as an object literal takes it: bare when it can be, quoted otherwise. */
export function formatKey(name: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);
}

/** `{ depth: 10 }` — values as given, in the declaration's order. */
export function describeValues(specs: OptionSpecs, values: Readonly<Record<string, unknown>>): string {
  const parts = Object.keys(specs).map((k) => {
    const v = values[k];
    return `${formatKey(k)}: ${typeof v === "number" || typeof v === "boolean" || typeof v === "string" ? formatValue(v) : String(v)}`;
  });
  return parts.length ? `{ ${parts.join(", ")} }` : "{}";
}

/** The declared defaults, as a record. */
export function defaultsOf(specs: OptionSpecs): Record<string, OptionValue> {
  return Object.fromEntries(Object.entries(specs).map(([k, s]) => [k, s.default]));
}

/**
 * The options `ctor` declares — `{}` for a tool that declares none — checked
 * for shape. A malformed declaration throws, naming what is wrong: called from
 * `defineTool`, so a tool typed at the command line with a `static options` it
 * got wrong is refused at the line that defined it, not at the first arm.
 */
export function declaredOptions(ctor: unknown, tool = "the tool"): OptionSpecs {
  const raw = (ctor as { options?: unknown } | null)?.options;
  if (raw === undefined || raw === null) return {};
  const shape = "{ name: { default: 10, unit?: \"length\", label?: \"…\" } }";
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${tool}'s static options must be an object, ${shape}`);
  }
  for (const [name, spec] of Object.entries(raw as Record<string, unknown>)) {
    const s = spec as Partial<OptionSpec> | null;
    const d = s?.default;
    if (!s || typeof s !== "object" || !((typeof d === "number" && Number.isFinite(d)) || typeof d === "boolean" || typeof d === "string")) {
      throw new Error(`${tool}'s option ${name} needs a default that is a number, true/false or a word, ${shape}`);
    }
    if (typeof d === "string" && !(Array.isArray(s.choices) && s.choices.every((c) => typeof c === "string") && s.choices.includes(d))) {
      throw new Error(`${tool}'s option ${name} is a word, so it needs a default among its choices: { default: "${d}", choices: ["${d}", …] }`);
    }
    if (s.unit !== undefined && typeof s.unit !== "string") throw new Error(`${tool}'s option ${name}: unit is text`);
    if (s.label !== undefined && typeof s.label !== "string") throw new Error(`${tool}'s option ${name}: label is text`);
    if (s.check !== undefined && typeof s.check !== "function") throw new Error(`${tool}'s option ${name}: check is a function`);
  }
  return raw as OptionSpecs;
}

/** Why `v` cannot be `spec`'s value, or null when it can. */
function fault(spec: OptionSpec, v: unknown): string | null {
  const kind = kindOf(spec.default);
  if (kind === "number" && !(typeof v === "number" && Number.isFinite(v))) {
    return `is a number, not ${typeof v === "string" ? JSON.stringify(v) : String(v)}`;
  }
  if (kind === "boolean" && typeof v !== "boolean") return `is true or false, not ${typeof v === "string" ? JSON.stringify(v) : String(v)}`;
  if (kind === "string" && !(typeof v === "string" && (spec.choices ?? []).includes(v))) {
    return `is one of ${(spec.choices ?? []).map((c) => JSON.stringify(c)).join(", ")}, not ${typeof v === "string" ? JSON.stringify(v) : String(v)}`;
  }
  return spec.check?.(v as OptionValue) ?? null;
}

/**
 * What `tool` is armed with when `arm` is given `given`: every declared option,
 * from `given`, else `remembered`, else the declaration's default. Throws a
 * one-line refusal for an option the tool does not declare, a value of the
 * wrong type, or one its `check` refuses — each naming the options the tool has,
 * so the line says what would do.
 *
 * A tool that declares nothing gets `given` back untouched: it reads whatever
 * it was armed with, as every tool did before options were declared. A
 * remembered value that would not pass now (stored by an older declaration,
 * or by some other script sharing the origin) is passed over, not refused: the
 * viewer did not type it.
 */
export function resolveOptions(
  tool: string, specs: OptionSpecs, given: unknown, remembered: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  const names = Object.keys(specs);
  // The very object, not a copy: an undo re-arms with exactly what the tool had.
  if (names.length === 0) return given && typeof given === "object" ? given as Record<string, unknown> : {};
  const has = `its options are ${describeValues(specs, defaultsOf(specs))}`;
  if (given !== undefined && given !== null && (typeof given !== "object" || Array.isArray(given))) {
    throw new Error(`${tool}'s options are named: arm(${JSON.stringify(tool)}, ${describeValues(specs, defaultsOf(specs))}) — not ${String(given)}`);
  }
  const g = (given ?? {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(g)) {
    if (!Object.hasOwn(specs, k)) throw new Error(`${tool} has no option ${JSON.stringify(k)} — ${has}`);
    const why = fault(specs[k], v);
    if (why) throw new Error(`${tool}'s ${k} ${why} — ${has}`);
  }
  const out: Record<string, unknown> = {};
  for (const k of names) {
    if (Object.hasOwn(g, k)) out[k] = g[k];
    else if (specs[k].remember !== false && Object.hasOwn(remembered, k) && fault(specs[k], remembered[k]) === null) out[k] = remembered[k];
    else out[k] = specs[k].default;
  }
  return out;
}

/** The declared options among `given` — what an `arm` call said, and so what is remembered. */
export function explicitOptions(specs: OptionSpecs, given: unknown): Record<string, OptionValue> {
  if (!given || typeof given !== "object") return {};
  const out: Record<string, OptionValue> = {};
  for (const [k, v] of Object.entries(given as Record<string, unknown>)) {
    // A word is never remembered: the one there is, an extrude's mode, is
    // `remember: false` anyway, and the stored values stay numbers and flags.
    if (Object.hasOwn(specs, k) && specs[k].remember !== false && (typeof v === "number" || typeof v === "boolean")) out[k] = v;
  }
  return out;
}

/**
 * The text after a field: nothing for a length (the drawing's units have no
 * name), `rad` for an angle, anything else as declared.
 */
export function unitSymbol(unit: string | undefined): string {
  if (unit === undefined || unit === "length") return "";
  if (unit === "angle") return "rad";
  return unit;
}

// ---- remembered values ------------------------------------------------------

/** The part of `Storage` this file uses — the same three methods panels.ts's layout does. */
export interface OptionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Where the last values are kept: under their own key, beside the layout's and
 * versioned the same way — a value that means something different reads as
 * nothing remembered, which is the declared default, never wrong.
 */
export const OPTIONS_KEY = "neocad.toolOptions.v1";

type Remembered = Record<string, Record<string, OptionValue>>;

/** Stored values, read leniently: anything not a finite number or a flag, under a tool, is dropped alone. */
export function parseRemembered(text: string | null): Remembered {
  if (!text) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return {};
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Remembered = {};
  for (const [tool, values] of Object.entries(raw as Record<string, unknown>)) {
    if (!values || typeof values !== "object" || Array.isArray(values)) continue;
    const kept: Record<string, OptionValue> = {};
    for (const [k, v] of Object.entries(values as Record<string, unknown>)) {
      if ((typeof v === "number" && Number.isFinite(v)) || typeof v === "boolean") kept[k] = v;
    }
    out[tool] = kept;
  }
  return out;
}

/**
 * The values each tool was last armed with, for this viewer. Held in memory
 * for the session and written through to storage when there is any: a storage
 * that throws on every touch still remembers for as long as the page is open,
 * which is all it can mean there.
 */
export class OptionMemory {
  private storage: OptionStorage | null;
  private held: Remembered;

  constructor(storage: OptionStorage | null) {
    this.storage = storage;
    let text: string | null = null;
    try {
      text = storage?.getItem(OPTIONS_KEY) ?? null;
    } catch {
      text = null;
    }
    this.held = parseRemembered(text);
  }

  /** What `tool` was last armed with, option by option. */
  recall(tool: string): Record<string, OptionValue> {
    return { ...(this.held[tool] ?? {}) };
  }

  /** Remembers `values` for `tool`, over what it had; returns whether storage took it. */
  remember(tool: string, values: Readonly<Record<string, OptionValue>>): boolean {
    if (Object.keys(values).length === 0) return false;
    this.held[tool] = { ...(this.held[tool] ?? {}), ...values };
    if (!this.storage) return false;
    try {
      this.storage.setItem(OPTIONS_KEY, JSON.stringify(this.held));
      return true;
    } catch {
      return false;
    }
  }
}
