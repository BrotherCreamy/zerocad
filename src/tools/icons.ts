// The toolbar's glyphs: one small inline SVG per built-in tool — Select and the
// Hand included, which are the engine's rather than the registry's — and the
// generic one every other tool gets.
//
// **A table keyed by the registered name, beside the registry — not a static on
// the tool class.** Three reasons. A static is inherited, so a tool defined at
// the command line as `class extends CircleTool` under a new name would quietly
// wear the circle, which is exactly the guessing the rule forbids; a name is not
// inherited. The name is also what every other surface keys a tool by — the
// command line arms it by name, and `toolUnavailable` (../toolavail.ts) decides
// availability by name — so a re-registered `defineTool("circle", …)` keeps the
// circle's glyph for the same reason it keeps the circle's availability rule:
// it is what `arm("circle")` arms. And the glyphs are one visual family,
// which is easiest to keep one family when they sit in one table: one stroke
// width, one corner radius, no fills but a dot.
//
// Every glyph draws in `currentColor`, so the button's colour — the armed amber,
// the hover lift — is the glyph's colour, exactly as it was the label's.
//
// This file knows nothing of the model; it is strings. The toolbar (../panels.ts)
// never imports it: its host asks `toolIcon` and hands the string over.

/** The family: a 16-unit box, 1.5-unit round strokes, nothing filled. */
function svg(name: string, body: string): string {
  return `<svg class="ico" data-glyph="${name}" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" ` +
    `fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

/** A dot: the one fill the family allows — a point is a dot. */
const dot = (x: number, y: number, r = 1.9) => `<circle cx="${x}" cy="${y}" r="${r}" fill="currentColor" stroke="none"/>`;

/**
 * The built-in tools' glyphs, by the name each is registered under. A test
 * holds this to the registry: a built-in without a glyph, or a glyph for a name
 * nothing registers, fails it.
 */
export const TOOL_ICONS: Readonly<Record<string, string>> = {
  // Select and the Hand (tool.ts's ENGINE_TOOLS): the pointer arrow and an
  // open hand, the two every drawing program puts first. Outlines like the
  // rest — a filled arrow was the obvious choice and would be the family's
  // only solid shape, as heavy as every other glyph together at 16 px.
  select: svg("select", `<path d="M3.5 2v11l2.9-2.6 2 4.2 1.9-.9-2-4.1 3.9-.2z"/>`),
  // Three fingers and a thumb: a fourth finger at 16 px merged with its
  // neighbours into a mitten (tried, and looked at at 1× and 3×).
  hand: svg("hand", `<path d="M6 8V3.5a1.25 1.25 0 0 1 2.5 0V7.5"/><path d="M8.5 7.5V2.75a1.25 1.25 0 0 1 2.5 0V8"/>` +
    `<path d="M11 8V4.25a1.25 1.25 0 0 1 2.5 0V10a4.5 4.5 0 0 1-4.5 4.5H8.4a3.6 3.6 0 0 1-2.7-1.2L2.5 9.8a1.2 1.2 0 0 1 1.8-1.6L6 9.8"/>`),
  point: svg("point", dot(8, 8, 2.6)),
  line: svg("line", `<path d="M3 13 13 3"/>`),
  rectangle: svg("rectangle", `<rect x="2.5" y="4" width="11" height="8" rx="1"/>`),
  // A hexagon, the polygon tool's default — pointed left and right, so its
  // flat top and bottom sit level with the rectangle's beside it in the flyout.
  polygon: svg("polygon", `<path d="M13.5 8 10.75 12.75H5.25L2.5 8 5.25 3.25h5.5z"/>`),
  // A stadium: two straight sides and two round ends, as wide as the rectangle.
  slot: svg("slot", `<path d="M5.5 5h5a3 3 0 0 1 0 6h-5a3 3 0 0 1 0-6z"/>`),
  circle: svg("circle", `<circle cx="8" cy="8" r="5.5"/>`),
  // Wider than tall by the circle's own width, so it is read as a circle's
  // cousin and not as a squashed slot.
  ellipse: svg("ellipse", `<ellipse cx="8" cy="8" rx="6" ry="3.75"/>`),
  // Half a turn, opening downward: anything shallower reads at 16 px as a bent
  // line. (The 3-point circle's and arc's dotted glyphs went with their buttons:
  // one circle tool and one arc tool, docs/plans/one-circle-one-arc.md.)
  arc: svg("arc", `<path d="M2.5 12A5.5 5.5 0 0 1 13.5 12"/>`),
  // Two edges meeting at a corner, the corner itself replaced by a quarter
  // circle on its inside — what a fillet does to the corner it is given.
  fillet: svg("fillet", `<path d="M3 13.5V8.5A5.5 5.5 0 0 1 8.5 3H13.5"/>`),
  // A draughtsman's dimension: two witness lines and the arrowed line between
  // them — what the tool puts on the drawing (docs/plans/sketch-relations.md).
  dimension: svg("dimension", `<path d="M2.5 3.5v9M13.5 3.5v9M2.5 8h11"/><path d="M5 6.2 2.5 8 5 9.8M11 6.2 13.5 8 11 9.8"/>`),
  // Two edges at a right angle with the square drawn in their corner: a
  // relation between two things, the commonest one there is.
  constrain: svg("constrain", `<path d="M3 13.5h10.5M3 13.5V2.5"/><path d="M3 9.5h4v4"/>`),
  // A slab seen from above: the face raised off its base, the three vertical
  // edges that can be seen, and the base's two front edges — the back two are
  // behind the slab, and drawn they cross its front face.
  extrude: svg("extrude", `<path d="M2 7.5h7l5-3.5H7zM2 7.5v6h7l5-3.5V4M9 7.5v6"/>`),
  // A profile inside the turn that sweeps it: three quarters of a circle,
  // arrowed so it reads as a motion rather than a third shape. (An axis drawn
  // through it, and the turn as a foreshortened ellipse, were tried first: at
  // 16 px the two read as an anchor.)
  revolve: svg("revolve", `<rect x="5.75" y="6.75" width="4.5" height="3.5" rx="1"/>` +
    `<path d="M13.5 8.5A5.5 5.5 0 1 1 8 3"/><path d="M6.6 1.4 8.6 3 6.6 4.6"/>`),
  // A plane in perspective with a pencil on it: drawing on a face.
  sketch: svg("sketch", `<path d="M1.5 13.5h9l4-4h-3"/><path d="M1.5 13.5l4-4h1.5"/>` +
    `<path d="M6.5 10.5l1-3L13 2l2 2-5.5 5.5zM11.5 3.5l2 2"/>`),
};

function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * The glyph for a tool with none of its own: a small square carrying the first
 * two letters of its name, so a tool defined at the command line is still a
 * button and still says which one. The letters are its name's, escaped — a name
 * is whatever string `defineTool` was given.
 */
export function genericIcon(name: string): string {
  const letters = escapeXml(Array.from(name).slice(0, 2).join(""));
  return svg("generic", `<rect x="1.5" y="1.5" width="13" height="13" rx="1"/>` +
    `<text x="8" y="10.9" text-anchor="middle" font-size="7.5" font-family="inherit" fill="currentColor" ` +
    `stroke="none">${letters}</text>`);
}

/** A tool's glyph: its own if it is a built-in, the generic one otherwise. Never guessed. */
export function toolIcon(name: string): string {
  return Object.hasOwn(TOOL_ICONS, name) ? TOOL_ICONS[name] : genericIcon(name);
}
