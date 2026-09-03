// The source text of tools authored at the command line.
//
// A tool is a class, and a class is a closure over its module — so a tool
// cannot be serialised any more than a residual block can (see persist.ts).
// What *can* be written down is the same thing a saved model writes down: the
// text the user typed. So a REPL entry that calls `defineTool` is remembered
// whole, and a saved file carries that text as **inert data**. Opening the
// file never evaluates it; pasting it back is an ordinary entry, and the paste
// is the consent. Nothing in a file runs that the user did not type.
//
// Three things this is not, each deliberate:
//
//   - **Not model state.** A tool is not part of the drawing. It is not in the
//     journal, `model.ts` has never heard of it, and defining one is not an
//     undo step — the undo bracket compares `save(model)` snapshots, and those
//     are written without tool sources for exactly this reason.
//   - **Not the registry's business.** `tools/tool.ts` keeps the ctor map and
//     stays ignorant of persistence; capture happens in the command layer's
//     `defineTool` wrapper, which is why a built-in — registered by its own
//     module at import time, never through the REPL — is never captured.
//   - **Not a whole-entry parser.** The source is the *whole entry*, not the
//     class expression sliced out of it. An entry may build helpers around its
//     class, and pulling one expression out would be both a parser project and
//     a lie about what the user ran.
//
// The store is per session. A page reload starts empty and a file's tools are
// inert until pasted, which is the point.

import { getToolCtor } from "./tools/tool.ts";

/** One tool's name and the entry text that defined it. Data, everywhere. */
export interface ToolSource {
  name: string;
  /** The whole REPL entry. Never evaluated by the app — only ever rendered. */
  source: string;
}

interface Held {
  source: string;
  /**
   * True when this session watched the entry run. False when it merely came
   * out of a file and nobody has pasted it — the distinction decides who wins
   * a name collision, and nothing else.
   */
  captured: boolean;
}

export class ToolSourceStore {
  private held = new Map<string, Held>();

  /** Records the entry that defined `name`, replacing any earlier record. */
  capture(name: string, source: string): void {
    this.held.set(name, { source, captured: true });
  }

  /**
   * Takes what an opened file carries, and answers with the entries it stored.
   *
   * Two rules, both about not lying afterwards. Sources captured in *this*
   * session are kept over the file's, because the captured one is the text of
   * the class that is actually registered and would be the one that ran.
   * And a previous file's carried sources are dropped, because they belonged
   * to a drawing that is no longer open — carrying them into the next `save()`
   * would smuggle one file's tools into another's.
   */
  carry(sources: readonly ToolSource[]): ToolSource[] {
    for (const [name, held] of [...this.held]) if (!held.captured) this.held.delete(name);
    const taken: ToolSource[] = [];
    for (const s of sources) {
      if (this.held.has(s.name)) continue; // a definition this session watched wins
      this.held.set(s.name, { source: s.source, captured: false });
      taken.push({ name: s.name, source: s.source });
    }
    return taken;
  }

  /** The stored entry for a tool, or undefined if nothing here defined it. */
  get(name: string): string | undefined {
    return this.held.get(name)?.source;
  }

  names(): string[] {
    return [...this.held.keys()];
  }

  /** What a `save()` carries. Empty is the normal case; see `toSaved`. */
  all(): ToolSource[] {
    return [...this.held].map(([name, held]) => ({ name, source: held.source }));
  }

  clear(): void {
    this.held.clear();
  }
}

/**
 * The session's store. A module singleton for the same reason the tool
 * registry is one — there is one command line — but injectable through
 * `EnvHandles.toolSources`, so a test gets a store of its own without having
 * to reset anything.
 */
export const toolSources = new ToolSourceStore();

/**
 * What `open()` says about a tool it is carrying but cannot run.
 *
 * One function so the command line and the file picker cannot end up phrasing
 * the same fact two ways, and so the sentence itself is pinned by a test.
 */
export function carriedNotice(name: string): string {
  return `this file carries the source of tool ${JSON.stringify(name)} — `
    + `toolSource(${JSON.stringify(name)}) shows it; paste it to enable`;
}

/**
 * Takes a file's tool sources into the session and returns the lines to tell
 * the user about them. Evaluates nothing, ever: the sources go into a Map and
 * their names go into a sentence.
 *
 * A carried name that is already a registered tool gets no line, because
 * "paste it to enable" would not be true of something already armable —
 * `tools()` lists it as active and `toolSource` still shows whatever text is
 * stored under it.
 */
export function carryIntoSession(sources: readonly ToolSource[], store: ToolSourceStore = toolSources): string[] {
  return store.carry(sources)
    .filter((s) => getToolCtor(s.name) === undefined)
    .map((s) => carriedNotice(s.name));
}
