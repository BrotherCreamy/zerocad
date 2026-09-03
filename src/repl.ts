// The command line the whole project is pointed at: type a tool's definition
// in, press Enter, and drag one out in the viewport a second later — through
// the same `defineTool` registration a built-in tool uses, with nothing
// privileged about the built-ins.
//
// "Scoped evaluator, not raw eval" means identifier lookup inside a REPL
// entry resolves against a curated scope object rather than against the
// page's globals. That is done the standard way: run the entry inside a
// `with` block over a Proxy whose `has` trap claims *every* name, so no
// identifier ever falls through to globalThis, and whose `get` trap throws a
// clear ReferenceError for anything not deliberately provided.
//
// To be precise about what that is and isn't: this is *curation*, not a
// security boundary. It exists so a REPL entry sees a small, documented,
// intentional surface — the kernel, the model, the relation vocabulary, the
// tool registry, and standard JS — and so a typo gets "no such name: modle"
// instead of silently reading some unrelated page global. Code typed here
// still runs on the main thread with the engine's own authority; genuinely
// untrusted code would need a worker or an iframe, which is a different
// feature with a different threat model.
//
// Two REPL affordances worth knowing, both consequences of the `with` scope:
//   - a bare assignment (`box = class extends Tool {...}`) persists into the
//     scope and is visible to later entries, because the Proxy's `set` trap
//     catches it;
//   - a `const`/`let`/`class` *declaration* does not — those bind to the
//     entry's own function scope and vanish with it. Declare with a bare
//     assignment when you want to keep something around.

type Bag = Record<string, unknown>;

export interface ReplResult {
  ok: boolean;
  value: unknown;
  error?: Error;
  output: string[]; // anything the entry sent to console.log/warn/error
}

// Everything from the JS standard library a REPL entry can see. Deliberately
// a list rather than "whatever globalThis has": DOM, network, storage and
// timers are absent because a tool or relation has no business reaching them,
// and their absence is what makes the scope legible.
function standardGlobals(): Bag {
  return {
    Math, JSON, Number, String, Boolean, Array, Object, Symbol, Map, Set,
    Date, RegExp, Promise, BigInt,
    Error, TypeError, RangeError, ReferenceError, SyntaxError,
    isNaN, isFinite, parseInt, parseFloat,
    Infinity, NaN, undefined,
    structuredClone,
  };
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as
  new (...args: string[]) => (...args: unknown[]) => Promise<unknown>;

export class Repl {
  /** The live scope. Bare assignments in an entry land here and persist. */
  readonly scope: Bag;
  /**
   * The text of the entry being evaluated right now, or `null` between
   * entries. Published because the entry text is the one honest record of what
   * a user ran, and something above this file wants it *while* it runs: a tool
   * defined at the command line is saved as the entry that defined it (see
   * `toolsource.ts`), and by the time `eval` returns that text is gone.
   *
   * Deliberately a plain fact rather than a hook: this file stays ignorant of
   * why anyone would want it, exactly as it is ignorant of what a point is.
   * The command surface reads it through a host handle (`currentEntry`), so
   * the dependency is visible in the wiring rather than ambient.
   *
   * Nested evaluation (an entry that awaits something which evaluates another)
   * saves and restores rather than clearing, so the outer entry's text is
   * still there when it resumes.
   */
  entry: string | null = null;
  private output: string[] = [];

  constructor(globals: Bag = {}) {
    const console = {
      log: (...a: unknown[]) => this.output.push(a.map(fmt).join(" ")),
      warn: (...a: unknown[]) => this.output.push("warn: " + a.map(fmt).join(" ")),
      error: (...a: unknown[]) => this.output.push("error: " + a.map(fmt).join(" ")),
    };
    this.scope = { ...standardGlobals(), console, ...globals };
    // `globalThis` deliberately resolves to the scope itself: an entry that
    // reaches for it gets the curated bag, not the page.
    this.scope.globalThis = this.scope;
  }

  /** Adds (or replaces) names in the scope after construction. */
  define(names: Bag): void {
    Object.assign(this.scope, names);
  }

  names(): string[] {
    return Object.keys(this.scope).sort();
  }

  private proxy(): Bag {
    const scope = this.scope;
    return new Proxy(scope, {
      // Claim every name, so `with` never lets a lookup escape to globalThis.
      has: () => true,
      get(target, key) {
        // `with` consults this before anything else; undefined means
        // "nothing in this object is exempt from the scope".
        if (key === Symbol.unscopables) return undefined;
        if (key in target) return target[key as string];
        throw new ReferenceError(`no such name: ${String(key)}`);
      },
      set(target, key, value) {
        target[key as string] = value; // bare assignment persists
        return true;
      },
    }) as Bag;
  }

  /**
   * Runs one REPL entry. An entry that is a single expression yields its
   * value (so `2 + 2` answers 4); anything else runs as statements. `await`
   * works at the top level of an entry.
   */
  async eval(source: string): Promise<ReplResult> {
    this.output = [];
    const src = source.trim();
    if (!src) return { ok: true, value: undefined, output: [] };

    let run: (scope: Bag) => Promise<unknown>;
    try {
      run = this.compile(`return (\n${src}\n);`); // expression first, for its value
    } catch {
      try {
        run = this.compile(src); // ...otherwise it's statements
      } catch (e) {
        return { ok: false, value: undefined, error: asError(e), output: this.output };
      }
    }

    const outer = this.entry;
    this.entry = src;
    try {
      const value = await run(this.proxy());
      return { ok: true, value, output: this.output };
    } catch (e) {
      return { ok: false, value: undefined, error: asError(e), output: this.output };
    } finally {
      this.entry = outer;
    }
  }

  private compile(body: string): (scope: Bag) => Promise<unknown> {
    // Not strict-mode: `with` is a syntax error under "use strict", and `with`
    // is the only construct that reroutes *every* free identifier through an
    // object. That is the trade this evaluator is built on.
    const fn = new AsyncFunction("__scope__", `with (__scope__) {\n${body}\n}`);
    return (scope: Bag) => fn(scope) as Promise<unknown>;
  }
}

function asError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e));
}

/** Short, readable rendering of a REPL value for the log pane. */
export function fmt(v: unknown): string {
  if (typeof v === "string") return v;
  if (v === undefined) return "undefined";
  if (v === null) return "null";
  if (typeof v === "function") return `[function ${v.name || "anonymous"}]`;
  if (typeof v === "bigint") return `${v}n`;
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  if (v instanceof Map) return `Map(${v.size})`;
  if (v instanceof Set) return `Set(${v.size})`;
  if (Array.isArray(v)) return `[${v.map(fmt).join(", ")}]`;
  if (typeof v === "object") {
    try {
      const s = JSON.stringify(v);
      if (s !== undefined) return s.length > 400 ? s.slice(0, 400) + "…" : s;
    } catch { /* cyclic or otherwise unserialisable — fall through */ }
    return String(v);
  }
  return String(v);
}
