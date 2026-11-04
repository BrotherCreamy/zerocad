// ZeroCAD's mark — the logo over the drawing's top-left corner and, from the
// same markup, the home-screen icon (scripts/icons.ts writes
// public/icons/icon.svg from `iconSvg` and rasterises it), so the two are one
// mark and cannot drift apart. The owner: *"rather than say zerocad, it
// should be a tiny logo in the top left corner, that is overlaid over the
// viewport. Be creative with the logo, but keep it simple."*
//
// **A zero drawn the way the app draws**, out of its own primitives: a circle
// in the hovered amber, crossed by a construction line — the app's thin teal —
// with a point at each end, in the points' ink. It reads as "0", as "∅" (the
// empty set: a drawing with nothing in it yet is where every one starts), and
// as what it is, a circle and a line held by two points.
//
// **Every stroke has a casing**, as every mark on a solid does in the app
// (main.ts's `CASING`): drawn first, a little wider, in the ground's own
// colour. Invisible on the dark ground, it is the rim that keeps the mark
// legible where the logo floats over a light face.
//
// A leaf: imports nothing, so the page and the build script both read it.

/** The inks — index.html's and main.ts's, by name. */
export const LOGO_INK = {
  /** The hovered thing's amber: the circle. */
  circle: "#e8a33d",
  /** Construction geometry's teal (main.ts's `CONSTRUCTION`): the line. */
  line: "#679b91",
  /** A point's dot. */
  point: "#d5e1ec",
  /** The ground under the drawing, which is the casing's colour too. */
  casing: "#0a0e13",
  /** The panels' ground — the icon's, as it was. */
  ground: "#0e141b",
} as const;

/** The line's two ends, in the mark's 24-unit box: bottom-left to top-right, as ∅ is struck. */
const ENDS: readonly [number, number][] = [[5, 19], [19, 5]];

/**
 * The mark's markup, in a 24-unit box centred on (12, 12): casings, then the
 * line under the circle (a construction line is the quieter mark), then the
 * two points on top, as the app draws points over edges.
 */
export function logoMark(): string {
  const [[x1, y1], [x2, y2]] = ENDS;
  const line = (stroke: string, w: number) =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round"/>`;
  const circle = (stroke: string, w: number) => `<circle cx="12" cy="12" r="7" fill="none" stroke="${stroke}" stroke-width="${w}"/>`;
  const dots = (fill: string, r: number) => ENDS.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>`).join("");
  return [
    line(LOGO_INK.casing, 3.3), circle(LOGO_INK.casing, 4.2), dots(LOGO_INK.casing, 2.9),
    line(LOGO_INK.line, 1.3), circle(LOGO_INK.circle, 2.2), dots(LOGO_INK.point, 1.9),
  ].join("");
}

/** The logo as the page shows it: the mark alone, `size` CSS pixels square, nothing behind it. */
export function logoSvg(size: number): string {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" focusable="false">${logoMark()}</svg>`;
}

/**
 * The home-screen icon: the mark on the panels' ground, full bleed and square
 * (iOS and a maskable icon cut their own corners; scripts/icons.ts rounds the
 * "any" ones). Scaled 15× about the centre, which keeps the furthest of it —
 * a point's casing, 12.8 units out along the diagonal — at 192 px of 512,
 * inside the maskable safe circle's 205.
 */
export function iconSvg(): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">`,
    `<!-- Written by scripts/icons.ts from src/logo.ts — edit the mark there, then npm run build:icons. -->`,
    `<rect width="512" height="512" fill="${LOGO_INK.ground}"/>`,
    `<g transform="translate(256 256) scale(15) translate(-12 -12)">${logoMark()}</g>`,
    `</svg>`,
    "",
  ].join("\n");
}
