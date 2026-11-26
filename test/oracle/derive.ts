// The oracle's answers, derived — one function per case, each computing the
// part's volume, surface area, bounding box and centroid **from the formula**,
// never from the program's output (docs/plans/oracle.md). Running this file
// writes every case's `expected.json`; `test/oracle.test.ts` asserts the
// committed file equals what this gives, so a number and its derivation
// cannot drift apart, and then replays each case's `recipe.txt` and compares.
//
//   node --experimental-strip-types test/oracle/derive.ts     # rewrite every expected.json
//
// The bars are chosen from the measured error with a margin of ten (the
// table is in the CHANGELOG entry that built this), never looser than 1e-6
// relative unless the case says why. `box` and `centroid` bars are absolute,
// as a share of the part's size (its bounding box's diagonal).

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type V3 = [number, number, number];

export interface Expected {
  volume: number;
  area: number;
  /** `[min, max]` corners. */
  bbox: [V3, V3];
  /** The centre of volume. */
  centroid: V3;
  /** The kernel's face count, where the geometry fixes it. */
  faces?: number;
  /** How many bodies the app reports — one, unless the case says otherwise and why. */
  bodies: number;
  /** Relative for volume and area; a share of the bounding box's diagonal for box and centroid. */
  bars: { volume: number; area: number; box: number; centroid: number };
  /** The formula and the numbers that go into it, in words. */
  derivation: string;
}

// ---- the pieces every case is built from ---------------------------------------

/** The plate every box case starts from: 80 × 80 about the origin on the ground, extruded 10 up. */
export const PLATE = { a: 80, b: 80, c: 10 };

interface Lump { volume: number; centroid: V3 }

/** The centroid of lumps added (positive volume) and removed (negative volume) from one another. */
function combine(...lumps: Lump[]): Lump {
  const volume = lumps.reduce((s, l) => s + l.volume, 0);
  const centroid = [0, 1, 2].map((i) => lumps.reduce((s, l) => s + l.volume * l.centroid[i], 0) / volume) as V3;
  return { volume, centroid };
}

const plate = (): Lump => ({ volume: PLATE.a * PLATE.b * PLATE.c, centroid: [0, 0, PLATE.c / 2] });
const plateArea = () => 2 * (PLATE.a * PLATE.b + PLATE.b * PLATE.c + PLATE.c * PLATE.a);
const plateBox = (): [V3, V3] => [[-PLATE.a / 2, -PLATE.b / 2, 0], [PLATE.a / 2, PLATE.b / 2, PLATE.c]];

/** A box's diagonal: what the absolute bars are a share of. */
const diag = (box: [V3, V3]) => Math.hypot(box[1][0] - box[0][0], box[1][1] - box[0][1], box[1][2] - box[0][2]);

/**
 * A circular segment: the part of a disc of radius `r` beyond a chord at
 * signed distance `s` from the centre, measured toward the segment (so
 * s < 0 is the larger piece, holding the centre). Half-angle θ = acos(s/r);
 * area r²θ − s√(r² − s²); its centroid lies (2/3)(r² − s²)^{3/2} / area from
 * the centre toward the chord (the standard 4r sin³θ / (3(2θ − sin 2θ)));
 * the chord is 2√(r² − s²) long and the arc 2rθ.
 */
export function segment(r: number, s: number): { area: number; offset: number; chord: number; arc: number } {
  const theta = Math.acos(s / r);
  const h = Math.sqrt(r * r - s * s);
  const area = r * r * theta - s * h;
  return { area, offset: (2 / 3) * h ** 3 / area, chord: 2 * h, arc: 2 * r * theta };
}

/** The corner left between a square corner and the quarter circle of radius `r` rounding it: its area and its centroid's distance in from each face. */
export function spandrel(r: number): { area: number; inset: number } {
  // The square r × r (centroid r/2 in from each face) less the quarter disc
  // centred (r, r) from the corner, whose own centroid is 4r/(3π) from its
  // centre toward the corner, so r − 4r/(3π) in from each face.
  const square = r * r, quarter = (Math.PI * r * r) / 4;
  const area = square - quarter;
  const inset = (square * (r / 2) - quarter * (r - (4 * r) / (3 * Math.PI))) / area;
  return { area, inset };
}

// ---- the cases ---------------------------------------------------------------------

export const CASES: Record<string, () => Expected> = {
  box: () => {
    const { a, b, c } = PLATE;
    return {
      volume: a * b * c, area: plateArea(), bbox: plateBox(), centroid: [0, 0, c / 2], faces: 6, bodies: 1,
      bars: { volume: 1e-12, area: 1e-12, box: 1e-9, centroid: 1e-9 },
      derivation: `A box a × b × c = ${a} × ${b} × ${c}: V = abc = ${a * b * c}; A = 2(ab + bc + ca) = ${plateArea()}; `
        + `6 faces; the centroid at the middle, (0, 0, c/2). The box is analytic: exact to roundoff.`,
    };
  },

  "box-through-hole": () => {
    const r = 12, at: [number, number] = [10, 5];
    const { c } = PLATE;
    const hole: Lump = { volume: -Math.PI * r * r * c, centroid: [at[0], at[1], c / 2] };
    const body = combine(plate(), hole);
    const area = plateArea() - 2 * Math.PI * r * r + 2 * Math.PI * r * c;
    return {
      volume: body.volume, area, bbox: plateBox(), centroid: body.centroid, faces: 7, bodies: 1,
      bars: { volume: 1e-11, area: 5e-6, box: 1e-9, centroid: 1e-9 },
      derivation: `The plate less a cylinder of radius r = ${r} through its thickness c = ${c}, centred at (${at}) — off the middle `
        + `so the centroid says where the hole is: V = abc − πr²c = ${plate().volume} − ${Math.PI * r * r * c}; `
        + `A = 2(ab + bc + ca) − 2πr² (the two discs lost) + 2πrc (the wall gained) = ${plateArea()} − ${2 * Math.PI * r * r} + ${2 * Math.PI * r * c}; `
        + `7 faces; centroid = (V_plate·(0, 0, c/2) − V_hole·(${at}, c/2)) / V. The area's bar is 5e-6, above the 1e-6 floor: the kernel `
        + `integrates a curved face's area to a requested 1e-6 (SmApiFaceComputeArea in scripts/solids/glue.cpp) and this wall measured 3.5e-7 off `
        + `(the same hole at the plate's middle measured 5e-8), so a margin of ten lands at 5e-6.`,
    };
  },

  "box-blind-hole": () => {
    const r = 12, h = 6, at: [number, number] = [10, 5];
    const { c } = PLATE;
    // The hole runs from the lid at z = c down to z = c − h: its centroid is at c − h/2.
    const hole: Lump = { volume: -Math.PI * r * r * h, centroid: [at[0], at[1], c - h / 2] };
    const body = combine(plate(), hole);
    const area = plateArea() - Math.PI * r * r + 2 * Math.PI * r * h + Math.PI * r * r;
    return {
      volume: body.volume, area, bbox: plateBox(), centroid: body.centroid, faces: 8, bodies: 1,
      bars: { volume: 1e-11, area: 1e-6, box: 1e-9, centroid: 1e-9 },
      derivation: `The plate less a cylinder of radius r = ${r} cut h = ${h} deep from the lid (c = ${c}), centred at (${at}): `
        + `V = abc − πr²h = ${plate().volume} − ${Math.PI * r * r * h}; A = 2(ab + bc + ca) − πr² (the lid's disc) + 2πrh (the wall) + πr² (the floor) `
        + `= ${plateArea()} + ${2 * Math.PI * r * h}; 8 faces; centroid = (V_plate·(0, 0, c/2) − V_hole·(${at}, c − h/2)) / V. `
        + `Area bar 1e-6 as the through hole's (measured 4e-8).`,
    };
  },

  "box-edge-lens": () => {
    // The owner's file: a circle on the lid crossing the plate's edge x = 40,
    // its centre d = 10 inside the edge, cut through all. What is removed is the
    // part of the disc inside the plate — the segment beyond the chord at
    // signed distance s = −d from the centre (the larger piece, holding the
    // centre), whose centroid is `offset` from the centre toward the chord.
    const r = 18, cx = 30, d = PLATE.a / 2 - cx;
    return lens("inside", r, cx, -d);
  },

  "box-edge-notch": () => {
    // The D-notch of docs/images/564: the centre d = 6 outside the edge, so
    // what is removed is the smaller segment, beyond the chord at s = +d.
    const r = 18, cx = 46, d = cx - PLATE.a / 2;
    return lens("outside", r, cx, d);
  },

  "box-edge-lens-by-region": () => {
    // The same lens, cut as the journal spells the Cut tool's press — the
    // region by its face's members, then the extrude of the region — typed.
    // The same body is meant, so the same numbers; the case is red for bug 87
    // (the region resolves to the lid minus the lens) until the fix lands.
    const r = 18, cx = 30, d = PLATE.a / 2 - cx;
    const same = lens("inside", r, cx, -d);
    return { ...same, derivation: `${same.derivation} The same lens as box-edge-lens, cut by the journal's own spelling: `
      + `region("l6", "origin", ["l6", "c1"]) then extrude("rg2", …). Red: bug 87.` };
  },

  cylinder: () => {
    const r = 15, h = 20;
    return {
      volume: Math.PI * r * r * h, area: 2 * Math.PI * r * r + 2 * Math.PI * r * h,
      bbox: [[-r, -r, 0], [r, r, h]], centroid: [0, 0, h / 2], faces: 3, bodies: 1,
      bars: { volume: 1e-11, area: 1e-6, box: 1e-9, centroid: 1e-9 },
      derivation: `A circle of radius r = ${r} on the ground about the origin, extruded h = ${h}: V = πr²h = ${Math.PI * r * r * h}; `
        + `A = 2πr² + 2πrh = ${2 * Math.PI * r * r} + ${2 * Math.PI * r * h}; 3 faces (two discs, one wall); centroid (0, 0, h/2). `
        + `Area bar 1e-6 for the wall's integration (measured 5e-8).`,
    };
  },

  "boss-on-plate": () => {
    // The owner's part's boss: a cylinder of radius 3, 8 long, standing out
    // of the wall x = 40 at mid-height — the union of two solids whose
    // interiors are disjoint, so the volumes add and the joined disc leaves
    // both areas.
    const r = 3, len = 8;
    const { a, c } = PLATE;
    const boss: Lump = { volume: Math.PI * r * r * len, centroid: [a / 2 + len / 2, 0, c / 2] };
    const body = combine(plate(), boss);
    const area = plateArea() - Math.PI * r * r + 2 * Math.PI * r * len + Math.PI * r * r;
    return {
      volume: body.volume, area, bbox: [[-a / 2, -PLATE.b / 2, 0], [a / 2 + len, PLATE.b / 2, c]], centroid: body.centroid, faces: 8, bodies: 1,
      bars: { volume: 1e-11, area: 1e-6, box: 1e-9, centroid: 1e-9 },
      derivation: `The plate with a cylinder of radius r = ${r}, ${len} long, joined on its wall x = ${a / 2} at (${a / 2}, 0, ${c / 2}): `
        + `V = abc + πr²·${len} = ${plate().volume} + ${boss.volume}; A = 2(ab + bc + ca) − πr² (the wall's disc under the boss) + 2πr·${len} (the boss's wall) + πr² (its end) `
        + `= ${plateArea()} + ${2 * Math.PI * r * len}; 8 faces; centroid = (V_plate·(0, 0, c/2) + V_boss·(${a / 2 + len / 2}, 0, c/2)) / V. Area bar 1e-6 (measured 5e-8).`,
    };
  },

  "tube-by-revolve": () => {
    // A rectangle 20 ≤ x ≤ 30, 0 ≤ y ≤ 10 on the ground, turned once about
    // the origin's y axis: an annular tube, outer R = 30, inner r = 20, h = 10.
    const R = 30, r = 20, h = 10;
    const volume = Math.PI * (R * R - r * r) * h;
    const area = 2 * Math.PI * (R * R - r * r) + 2 * Math.PI * (R + r) * h;
    return {
      volume, area, bbox: [[-R, 0, -R], [R, h, R]], centroid: [0, h / 2, 0], faces: 4, bodies: 1,
      bars: { volume: 1e-8, area: 2e-6, box: 1e-9, centroid: 1e-8 },
      derivation: `A rectangle ${r} ≤ x ≤ ${R}, 0 ≤ y ≤ ${h} revolved 360° about the y axis: V = π(R² − r²)h = ${volume}; `
        + `A = 2π(R² − r²) (two annuli) + 2π(R + r)h (two walls) = ${2 * Math.PI * (R * R - r * r)} + ${2 * Math.PI * (R + r) * h}; 4 faces; `
        + `centroid on the axis at (0, h/2, 0). The kernel sweeps a revolve as a general surface of revolution and integrates it: `
        + `volume measured 4.5e-10 off, so its bar is 1e-8; the centroid 1.0e-10 of the size, so 1e-8; the walls' area 2.0e-7, so 2e-6 — `
        + `above the 1e-6 floor because the face-area integration is asked at 1e-6 and the two walls of ~1900 each carry it.`,
    };
  },

  "vase-by-revolve": () => {
    // The profile: the rectangle 0 ≤ x ≤ 20, 0 ≤ y ≤ 30 with a semicircle of
    // radius 15 bulging out of its right side (centre (20, 15)), turned once
    // about the y axis. Pappus: V = 2π ∫x dA, A_side = 2π ∫x ds over the arc.
    const w = 20, hgt = 30, r = 15;
    const rect = { area: w * hgt, x: w / 2 };
    // The half-disc's centroid is 4r/(3π) from its centre, outward.
    const half = { area: (Math.PI * r * r) / 2, x: w + (4 * r) / (3 * Math.PI) };
    const volume = 2 * Math.PI * (rect.area * rect.x + half.area * half.x);
    // ∫x ds over the semicircle x = w + r cos φ, ds = r dφ, φ from −π/2 to π/2: r(wπ + 2r).
    const zone = 2 * Math.PI * r * (w * Math.PI + 2 * r);
    const discs = 2 * Math.PI * w * w;
    return {
      volume, area: discs + zone, bbox: [[-(w + r), 0, -(w + r)], [w + r, hgt, w + r]], centroid: [0, hgt / 2, 0], faces: 3, bodies: 1,
      bars: { volume: 1e-9, area: 2e-5, box: 1e-9, centroid: 1e-9 },
      derivation: `A rectangle 0 ≤ x ≤ ${w}, 0 ≤ y ≤ ${hgt} with a semicircle of radius ${r} on its right side (centre (${w}, ${hgt / 2})), `
        + `revolved 360° about the y axis. Pappus: V = 2π ∫x dA = 2π(${rect.area}·${rect.x} + ${half.area}·${half.x}) = ${volume}; `
        + `A = two discs of radius ${w} (2π·${w}²) + the arc's zone 2π ∫x ds = 2π·r(wπ + 2r) = ${zone}; 3 faces; the profile is symmetric about `
        + `y = ${hgt / 2}, so the centroid is (0, ${hgt / 2}, 0). The arc becomes a NURBS surface of revolution: volume measured 9e-11 off, bar 1e-9; `
        + `the zone's area 2.5e-6 off — the kernel integrates a face's area to a requested 1e-6 (glue.cpp), which this general surface of revolution `
        + `does not quite meet — so the area's bar is 2e-5, a decade above the measured 2e-6 and the one case looser than the 1e-6 floor.`,
    };
  },

  "fillet-one-edge": () => {
    // The plate's edge between its lid and the wall y = −40 (e1.lid|e1.m0),
    // rounded r = 3 along its whole length L = 80. What leaves is a prism on
    // the spandrel; the two end walls (x = ±40) each lose the spandrel's area
    // too — which the spec's formula left out.
    const r = 3;
    const { a, b, c } = PLATE;
    const L = a;
    const sp = spandrel(r);
    const removed: Lump = { volume: -sp.area * L, centroid: [0, -b / 2 + sp.inset, c - sp.inset] };
    const body = combine(plate(), removed);
    const area = plateArea() - 2 * r * L + ((Math.PI * r) / 2) * L - 2 * sp.area;
    return {
      volume: body.volume, area, bbox: plateBox(), centroid: body.centroid, faces: 7, bodies: 1,
      bars: { volume: 1e-11, area: 1e-7, box: 1e-9, centroid: 1e-9 },
      derivation: `The plate's lid edge along y = −${b / 2} (L = ${L}) rounded r = ${r}: the spandrel r²(1 − π/4) = ${sp.area} leaves along the edge, `
        + `V = abc − r²(1 − π/4)L = ${plate().volume} − ${sp.area * L}; A = 2(ab + bc + ca) − 2rL (two strips of the faces) + (πr/2)L (the quarter cylinder) `
        + `− 2·r²(1 − π/4) (each end wall loses the spandrel) = ${area}; 7 faces. The spandrel's centroid is ${sp.inset} in from each face `
        + `(the square's r/2 less the quarter disc's r − 4r/(3π), by area), so the removed prism is centred (0, −${b / 2} + ${sp.inset}, ${c} − ${sp.inset}) `
        + `and the body's centroid follows. Area bar 1e-7: the quarter cylinder measured 1e-9 off.`,
    };
  },

  "fillet-four-edges": () => {
    // The plate's four vertical edges rounded r = 5: four spandrel prisms
    // leave, the perimeter becomes 2(a + b) − 8r + 2πr, and the lid and base
    // each lose four spandrels. Symmetric, so the centroid stays.
    const r = 5;
    const { a, b, c } = PLATE;
    const sp = spandrel(r);
    const volume = plate().volume - 4 * sp.area * c;
    const perimeter = 2 * (a + b) - 8 * r + 2 * Math.PI * r;
    const area = 2 * (a * b - 4 * sp.area) + perimeter * c;
    return {
      volume, area, bbox: plateBox(), centroid: [0, 0, c / 2], faces: 10, bodies: 1,
      bars: { volume: 1e-10, area: 1e-7, box: 1e-9, centroid: 1e-9 },
      derivation: `The plate's four vertical edges rounded r = ${r}: V = abc − 4r²(1 − π/4)c = ${plate().volume} − ${4 * sp.area * c}; `
        + `A = 2(ab − 4r²(1 − π/4)) (lid and base) + (2(a + b) − 8r + 2πr)c (the walls, perimeter ${perimeter}) = ${area}; 10 faces `
        + `(four walls, four quarter cylinders, lid, base); symmetric, centroid (0, 0, c/2). The rounds come back as B-spline faces: `
        + `volume measured 2.1e-12 off, bar 1e-10; area 1.1e-9, bar 1e-7.`,
    };
  },

  "cut-that-splits": () => {
    // A slot 10 wide right across the plate, cut through all, leaves two boxes
    // 35 × 80 × 10. The app reports them as one body (the kernel's one B-rep of
    // two shells), so `bodies` is 1 and the face count is both boxes' — the
    // case documents what the app reports and asserts the volume.
    const slot = 10;
    const { a, b, c } = PLATE;
    const a2 = (a - slot) / 2;
    const volume = 2 * a2 * b * c;
    const area = 2 * 2 * (a2 * b + b * c + c * a2);
    return {
      volume, area, bbox: plateBox(), centroid: [0, 0, c / 2], faces: 12, bodies: 1,
      bars: { volume: 1e-12, area: 1e-12, box: 1e-9, centroid: 1e-9 },
      derivation: `A slot ${slot} wide across the plate's middle, cut through all: two boxes a′ × b × c with a′ = (a − ${slot})/2 = ${a2}. `
        + `V = 2a′bc = ${volume}; A = 2·2(a′b + bc + ca′) = ${area}; 12 faces (two boxes' six). The app reports one body — the kernel's one `
        + `B-rep holding two shells — so bodies is 1 here by observation, not by derivation. Symmetric about x = 0: centroid (0, 0, c/2). Analytic, exact.`,
    };
  },
};

/** The lens cases' shared derivation: a circle of radius `r` centred (`cx`, 0) on the lid, the plate's edge at x = a/2, cut through all. */
function lens(where: "inside" | "outside", r: number, cx: number, s: number): Expected {
  const { a, c } = PLATE;
  const seg = segment(r, s);
  // The removed prism stands on the segment: its centroid is the segment's,
  // `offset` from the circle's centre into the segment's own side — into the
  // plate, −x — whichever side of the centre the chord is. (First written
  // toward the chord, +x, and the kernel's centroid disagreed by 7e-3 of the
  // part: the notch's would have been outside the plate. A hand-derived
  // answer is checked by the kernel as much as the other way round.)
  const removed: Lump = { volume: -seg.area * c, centroid: [cx - seg.offset, 0, c / 2] };
  const body = combine(plate(), removed);
  const area = plateArea() - 2 * seg.area - seg.chord * c + seg.arc * c;
  const d = Math.abs(s);
  return {
    volume: body.volume, area, bbox: plateBox(), centroid: body.centroid, faces: 8, bodies: 1,
    bars: { volume: 1e-10, area: 1e-6, box: 1e-9, centroid: 1e-9 },
    derivation: `A circle of radius r = ${r} on the lid, its centre (${cx}, 0) ${d} ${where} the plate's edge x = ${a / 2}, cut through all. `
      + `What leaves is the prism on the circular segment inside the plate: with s = ${s} the chord's signed distance from the centre toward `
      + `the segment, θ = acos(s/r), area = r²θ − s√(r² − s²) = ${seg.area}, chord 2√(r² − s²) = ${seg.chord}, arc 2rθ = ${seg.arc}. `
      + `V = abc − area·c = ${plate().volume} − ${seg.area * c}; A = 2(ab + bc + ca) − 2·area (lid and base) − chord·c (the wall's strip) `
      + `+ arc·c (the curved wall) = ${area}; 8 faces (the wall x = ${a / 2} is cut in two). The segment's centroid is (2/3)(r² − s²)^{3/2}/area `
      + `= ${seg.offset} from the centre into the segment's side, −x, so the body's centroid is (V_plate·(0, 0, c/2) − V_seg·(${cx - seg.offset}, 0, c/2)) / V. `
      + `The curved wall is a B-spline face: volume measured 2.3e-12 off (the lens; the notch 5.7e-13), bar 1e-10; area 2.7e-8, bar 1e-6 (the requested integration accuracy).`,
  };
}

/** Each case's expected values, rounded through JSON as the committed file is. */
export function derived(name: string): Expected {
  return JSON.parse(JSON.stringify(CASES[name]())) as Expected;
}

export const CASE_NAMES = Object.keys(CASES);

export { diag };

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const name of CASE_NAMES) {
    const path = fileURLToPath(new URL(`./${name}/expected.json`, import.meta.url));
    writeFileSync(path, `${JSON.stringify(CASES[name](), null, 2)}\n`);
    console.log(`wrote ${path}`);
  }
}
