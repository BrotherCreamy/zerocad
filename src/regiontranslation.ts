// A file from before regions (format 16 and older) opened into today's
// vocabulary: **its holes become regions** — persist.ts's translation for
// docs/plans/regions-as-operations.md.
//
// Before format 17 a feature's record *was* its region: the outline, then every
// loop the user confirmed inside it, even-odd deciding which were holes and
// which islands (docs/plans/explicit-regions.md). Today a feature stands on a
// named region made by operations, so each old feature entry is opened as
//
//   region(member, frame, outline)          → rgN
//   subtract("rgN", hole, face, [])         — one per loop inside, or add for an island
//   extrude("rgN", depth, frame, loops, …)  — the entry, on the region
//
// and each old entry that changed a record's inner loops — a `hole`, an
// `unhole`, a `fillet` or `regen` whose regeneration (by the old inference,
// before explicit regions) took in a loop drawn inside — becomes the region
// step it meant: `hole` the step itself (`subtract`), `unhole` the step that
// fills (`add`), and a regeneration's new loop a step just before it, given no
// regeneration of its own (`[]`), since the entry after it rebuilds the
// feature exactly as it always did.
//
// **The model is the same, by construction**: every one of those entries
// carries what it rebuilt resolved, so a replay is handed exactly the profiles
// the old entries were — the same twins, walls, relations and names — and the
// region steps journal nothing but the chain. `test/regionsops.test.ts` opens
// every fixture with holes and compares.
//
// **Hole or island is the one thing decided**, since an old record does not
// say: a loop an odd number of loops below its outline is a hole (subtract),
// an even number an island (add), read off the file's *saved* geometry once it
// is restored — at the replay's seeds a loop built of free lines and relations
// may not close at all (operations.ts, `extrude`). The step and its journal
// entry are written `subtract` (`add` for an `unhole`) on the way in and
// corrected in `settle`, which is equivalent because a replay handed its
// regeneration never reads the op. A loop the saved drawing no longer has
// keeps the first reading: a hole, as most are.

import type { JournalEntry, Model, ProfileMember, RegionStep } from "./model.ts";
import { memberName } from "./model.ts";
import { findLoops } from "./loops.ts";
import { regionValue, treeDepth } from "./operations.ts";

/** What a replay step ran as, and the journal entry it was installed as (null when left out). */
export interface Ran {
  out: unknown;
  entry: JournalEntry | null;
}

/** A step whose op is read off the saved geometry once it is back. */
interface Pending {
  region: string;
  step: RegionStep;
  entry: JournalEntry;
  /** Made from an `unhole` — filling — so a hole is `add` and an island `subtract`. */
  fills: boolean;
}

const names = (l: readonly ProfileMember[]) => [...new Set(l.map(memberName))];
const key = (l: readonly ProfileMember[]) => names(l).sort().join("|");

function isLoops(v: unknown): v is ProfileMember[][] {
  return Array.isArray(v) && v.length > 0 && v.every((l) => Array.isArray(l) && l.length > 0);
}

function isRegenerated(v: unknown): v is [string, ProfileMember[][]][] {
  return Array.isArray(v) && v.every((e) => Array.isArray(e) && e.length === 2 && typeof e[0] === "string" && isLoops(e[1]));
}

/**
 * The translation for a file of `version`, against the model being replayed:
 * `give` runs one step through `exec` (persist.ts's replay of one entry), as
 * the entries it means today; `settle`, once the saved values are back,
 * decides each step's hole or island. Inert for format 17 and later.
 */
export function regionTranslation(model: Model, version: number) {
  const active = version < 17;
  const pending: Pending[] = [];

  /** A step of region `r` run and kept for `settle`. */
  const step = (exec: (e: JournalEntry) => Ran, op: "subtract" | "add", r: string, member: string,
                face: string[], regenerated: unknown, fills: boolean) => {
    const ran = exec({ op, args: [r, member, face, regenerated] });
    const reg = model.regions.get(r);
    if (ran.entry && reg) pending.push({ region: r, step: reg.steps.at(-1)!, entry: ran.entry, fills });
    return ran;
  };

  /** The loops a list gives feature `e`, or null. */
  const listed = (list: [string, ProfileMember[][]][], e: string) => list.find(([n]) => n === e)?.[1] ?? null;

  /** The inner loops of `now` that feature `e`'s record does not have yet. */
  const added = (e: string, now: ProfileMember[][]) => {
    const was = new Set((model.features.get(e)?.loops ?? []).slice(1).map(key));
    return now.slice(1).filter((l) => !was.has(key(l)));
  };

  function give(entry: JournalEntry, exec: (e: JournalEntry) => Ran): void {
    if (!active) { exec(entry); return; }
    const { op, args } = entry;
    // A feature entry: its region first, then the feature on it.
    if ((op === "extrude" || op === "revolve") && typeof args[0] === "string" && !model.regions.has(args[0])) {
      const at = op === "extrude" ? 3 : 4;
      const loops = args[at], frame = args[at - 1];
      if (isLoops(loops) && typeof frame === "string") {
        const outline = names(loops[0]);
        const member = outline.includes(args[0]) ? args[0] : outline[0];
        const r = exec({ op: "region", args: [member, frame, outline] }).out;
        if (typeof r === "string") {
          for (const l of loops.slice(1)) step(exec, "subtract", r, memberName(l[0]), names(l), [], false);
          exec({ op, args: [r, ...args.slice(1)] });
          return;
        }
      }
      exec(entry);
      return;
    }
    // A hole made or filled by name: the step it is now.
    if ((op === "hole" || op === "unhole") && typeof args[0] === "string" && isRegenerated(args[2])) {
      const f = model.features.get(args[0]);
      const now = listed(args[2], args[0]);
      if (f?.region !== undefined && now) {
        const face = op === "hole" ? added(f.name, now)[0]
          : f.loops.slice(1).find((l) => !new Set(now.slice(1).map(key)).has(key(l)));
        if (face) {
          const n = names(face);
          const member = typeof args[1] === "string" && n.includes(args[1]) ? args[1] : n[0];
          step(exec, op === "hole" ? "subtract" : "add", f.region, member, n, args[2], op === "unhole");
          return;
        }
      }
      exec(entry);
      return;
    }
    // A regeneration that took in a loop drawn inside (the inference before
    // explicit regions): that loop's step first, rebuilding nothing.
    const list = op === "regen" ? args[1] : op === "fillet" ? [...args].reverse().find(isRegenerated) : undefined;
    if (isRegenerated(list)) {
      for (const [e, loops] of list) {
        const f = model.features.get(e);
        if (f?.region === undefined) continue;
        for (const l of added(e, loops)) step(exec, "subtract", f.region, memberName(l[0]), names(l), [], false);
      }
    }
    exec(entry);
  }

  /** Each step's hole or island, from the saved geometry — see the top of the file. */
  function settle(): void {
    if (!pending.length) return;
    let all;
    try {
      all = findLoops(model);
    } catch {
      return;
    }
    for (const p of pending) {
      const r = model.regions.get(p.region);
      const k = r ? r.steps.indexOf(p.step) : -1;
      if (!r || k < 1) continue;
      let v;
      try {
        v = regionValue(model, p.region, all);
      } catch {
        continue;
      }
      const outline = v.faces[0], at = v.faces[k];
      if (outline === null || at === null) continue;
      const d = treeDepth(v.parent, at, outline);
      if (d === 0) continue;
      const hole = d % 2 === 1;
      const op = hole !== p.fills ? "subtract" : "add";
      p.step.op = op;
      p.entry.op = op;
    }
  }

  return { give, settle };
}
