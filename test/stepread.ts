// A Part 21 reader, the STEP suites' own (test/step.test.ts, the extrude and
// revolve bodies; test/stepkernel.test.ts, the solid kernel's), and the walk a
// kernel makes of a closed shell: every reference defined, every loop closed,
// every edge used by two faces once each way. Moved here from step.test.ts
// when a second suite needed it, unchanged.

import assert from "node:assert/strict";

// ---- a Part 21 reader, this suite's own ------------------------------------------------

export type Value = number | string | boolean | null | { ref: number } | { enum: string } | { typed: string; args: Value[] } | Value[];

export interface Instance {
  id: number;
  /** The entity type, or for a complex instance every part's type. */
  types: string[];
  /** The arguments of a simple instance; for a complex one, each part's by type. */
  args: Value[];
  parts: Map<string, Value[]>;
  refs: number[];
}

/** Reads a parameter list; `s[i]` is the opening parenthesis. */
function parseList(s: string, i: number): [Value[], number] {
  assert.equal(s[i], "(", `a list at ${i}`);
  const out: Value[] = [];
  i++;
  while (s[i] !== ")") {
    let v: Value;
    [v, i] = parseValue(s, i);
    out.push(v);
    if (s[i] === ",") i++;
  }
  return [out, i + 1];
}

function parseValue(s: string, i: number): [Value, number] {
  const c = s[i];
  if (c === "(") return parseList(s, i);
  if (c === "#") {
    const m = /^#(\d+)/.exec(s.slice(i))!;
    return [{ ref: Number(m[1]) }, i + m[0].length];
  }
  if (c === "'") {
    let j = i + 1, text = "";
    for (;;) {
      if (s[j] === "'" && s[j + 1] === "'") { text += "'"; j += 2; continue; }
      if (s[j] === "'") break;
      text += s[j++];
    }
    return [text, j + 1];
  }
  if (c === ".") {
    const m = /^\.([A-Z_]+)\./.exec(s.slice(i))!;
    if (m[1] === "T" || m[1] === "F") return [m[1] === "T", i + m[0].length];
    return [{ enum: m[1] }, i + m[0].length];
  }
  if (c === "$" || c === "*") return [null, i + 1];
  const num = /^[+-]?\d+(\.\d*)?(E[+-]?\d+)?/.exec(s.slice(i));
  if (num) {
    // Part 21's REAL has a point; an INTEGER has none. The exporter writes
    // only these two shapes, and JavaScript's own (`1e-7`) would not match.
    return [Number(num[0]), i + num[0].length];
  }
  const typed = /^([A-Z_0-9]+)\(/.exec(s.slice(i));
  assert.ok(typed, `a value at "${s.slice(i, i + 20)}"`);
  const [args, j] = parseList(s, i + typed[1].length);
  return [{ typed: typed[1], args }, j];
}

function refsIn(v: Value, out: number[] = []): number[] {
  if (Array.isArray(v)) v.forEach((x) => refsIn(x, out));
  else if (v && typeof v === "object" && "ref" in v) out.push(v.ref);
  else if (v && typeof v === "object" && "typed" in v) v.args.forEach((x) => refsIn(x, out));
  return out;
}

export interface StepFile {
  header: string[];
  data: Map<number, Instance>;
}

export function parseStep(text: string): StepFile {
  const lines = text.split("\n");
  assert.equal(lines[0], "ISO-10303-21;");
  assert.equal(lines.at(-2), "END-ISO-10303-21;");
  const dataAt = lines.indexOf("DATA;");
  const header = lines.slice(lines.indexOf("HEADER;") + 1, lines.indexOf("ENDSEC;"));
  const data = new Map<number, Instance>();
  for (const line of lines.slice(dataAt + 1)) {
    if (line === "ENDSEC;") break;
    const m = /^#(\d+)=(.*);$/.exec(line);
    assert.ok(m, `an instance per line: ${line}`);
    const id = Number(m[1]);
    assert.equal(data.has(id), false, `#${id} is defined once`);
    const body = m[2];
    const partsOf = new Map<string, Value[]>();
    let types: string[], args: Value[] = [];
    if (body.startsWith("(")) {
      // A complex instance: its parts side by side, no commas between.
      types = [];
      let i = 1;
      while (body[i] !== ")") {
        const t = /^([A-Z_0-9]+)\(/.exec(body.slice(i))!;
        const [a, j] = parseList(body, i + t[1].length);
        types.push(t[1]);
        partsOf.set(t[1], a);
        i = j;
      }
      assert.deepEqual(types, types.slice().sort(), `#${id}: a complex instance lists its parts alphabetically`);
    } else {
      const t = /^([A-Z_0-9]+)\(/.exec(body)!;
      const [a, j] = parseList(body, t[1].length);
      assert.equal(j, body.length, `#${id} is one instance`);
      types = [t[1]];
      args = a;
    }
    data.set(id, { id, types, args, parts: partsOf, refs: refsIn(args.length ? args : [...partsOf.values()]) });
  }
  return { header, data };
}

/**
 * Every entity type the exporter writes — each one in AP214's schema, which
 * is what OpenCascade checked when it read the fixtures with no fail and no
 * warning. A type outside this set is a type no reader has been shown to take.
 */
export const AP214_TYPES = new Set([
  "APPLICATION_CONTEXT", "APPLICATION_PROTOCOL_DEFINITION", "PRODUCT_CONTEXT", "PRODUCT", "PRODUCT_RELATED_PRODUCT_CATEGORY",
  "PRODUCT_DEFINITION_FORMATION", "PRODUCT_DEFINITION_CONTEXT", "PRODUCT_DEFINITION", "PRODUCT_DEFINITION_SHAPE",
  "SHAPE_DEFINITION_REPRESENTATION", "ADVANCED_BREP_SHAPE_REPRESENTATION",
  "LENGTH_UNIT", "NAMED_UNIT", "SI_UNIT", "PLANE_ANGLE_UNIT", "SOLID_ANGLE_UNIT", "UNCERTAINTY_MEASURE_WITH_UNIT",
  "GEOMETRIC_REPRESENTATION_CONTEXT", "GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT", "GLOBAL_UNIT_ASSIGNED_CONTEXT", "REPRESENTATION_CONTEXT",
  "CARTESIAN_POINT", "DIRECTION", "VECTOR", "AXIS1_PLACEMENT", "AXIS2_PLACEMENT_3D", "LINE", "CIRCLE",
  "PLANE", "CYLINDRICAL_SURFACE", "CONICAL_SURFACE", "SPHERICAL_SURFACE", "TOROIDAL_SURFACE", "SURFACE_OF_REVOLUTION",
  "VERTEX_POINT", "EDGE_CURVE", "ORIENTED_EDGE", "EDGE_LOOP", "FACE_OUTER_BOUND", "FACE_BOUND", "ADVANCED_FACE",
  "CLOSED_SHELL", "ORIENTED_CLOSED_SHELL", "MANIFOLD_SOLID_BREP", "BREP_WITH_VOIDS",
  "TRIMMED_CURVE", "GEOMETRIC_CURVE_SET", "GEOMETRICALLY_BOUNDED_WIREFRAME_SHAPE_REPRESENTATION", "SHAPE_REPRESENTATION_RELATIONSHIP",
]);

export const refOf = (v: Value) => (v as { ref: number }).ref;
export const coordsOf = (f: StepFile, id: number) => f.data.get(id)!.args[1] as number[];

export interface ShellStats {
  vertices: number;
  edges: number;
  faces: number;
  /** Inner bounds — holes in faces — which the Euler–Poincaré formula counts. */
  rings: number;
  surfaces: Record<string, number>;
}

/** The faces of a closed shell walked as a reader walks them, every topological rule asserted on the way. */
export function checkShell(f: StepFile, shellId: number, where: string, senses = false): ShellStats {
  const get = (id: number) => f.data.get(id)!;
  const faces = (get(shellId).args[1] as Value[]).map(refOf);
  const uses = new Map<number, boolean[]>();
  const vertices = new Set<number>();
  const surfaces: Record<string, number> = {};
  let rings = 0;
  for (const faceId of faces) {
    const face = get(faceId);
    assert.equal(face.types[0], "ADVANCED_FACE", where);
    const surfaceType = get(refOf(face.args[2])).types[0];
    surfaces[surfaceType] = (surfaces[surfaceType] ?? 0) + 1;
    let outer = 0;
    for (const boundId of (face.args[1] as Value[]).map(refOf)) {
      const bound = get(boundId);
      if (bound.types[0] === "FACE_OUTER_BOUND") outer++;
      else { assert.equal(bound.types[0], "FACE_BOUND", where); rings++; }
      assert.equal(bound.args[2], true, `${where}: bounds keep their loop's direction`);
      const loop = get(refOf(bound.args[1]));
      const walked = (loop.args[1] as Value[]).map(refOf).map((oe) => {
        const o = get(oe);
        assert.equal(o.types[0], "ORIENTED_EDGE", where);
        const edge = get(refOf(o.args[3]));
        assert.equal(edge.types[0], "EDGE_CURVE", where);
        // A kernel's B-spline may run against its edge, and says so (`senses`);
        // every line and circle runs its edge's way.
        if (!senses || f.data.get(refOf(edge.args[3]))!.types[0] !== "B_SPLINE_CURVE_WITH_KNOTS"
          && !f.data.get(refOf(edge.args[3]))!.types.includes("RATIONAL_B_SPLINE_CURVE")) {
          assert.equal(edge.args[4], true, `${where}: every curve runs its edge's way`);
        }
        const forward = o.args[4] as boolean;
        const list = uses.get(edge.id) ?? [];
        list.push(forward);
        uses.set(edge.id, list);
        const [s, e] = [refOf(edge.args[1]), refOf(edge.args[2])];
        vertices.add(s).add(e);
        return forward ? [s, e] : [e, s];
      });
      // The loop closes as walked: each edge starts where the last one ended.
      walked.forEach(([s], k) => assert.equal(s, walked[(k + walked.length - 1) % walked.length][1], `${where}: face #${faceId}'s loop closes`));
    }
    assert.equal(outer, 1, `${where}: face #${faceId} has one outer bound`);
  }
  // Every edge in two faces, once each way — the shell is closed and
  // consistently oriented (a face turned over would use its edges the same
  // way as its neighbours).
  for (const [edge, senses] of uses) {
    assert.equal(senses.length, 2, `${where}: edge #${edge} bounds two faces`);
    assert.notEqual(senses[0], senses[1], `${where}: edge #${edge} is used once each way`);
  }
  return { vertices: vertices.size, edges: uses.size, faces: faces.length, rings, surfaces };
}

/** Euler–Poincaré for one closed shell with holes in its faces: V − E + F − rings = 2 − 2·genus. */
export const genus = (s: ShellStats) => (2 - (s.vertices - s.edges + s.faces - s.rings)) / 2;

