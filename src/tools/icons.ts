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
//
// **The glyphs themselves are each module's** (../modules.ts): the module that
// registers a tool registers its glyph beside it, drawn with `svg` and `dot`
// from here so the family stays one family. This file keeps the family's
// helpers, the table the modules fill, and the generic glyph.

/** The family: a 16-unit box, 1.5-unit round strokes, nothing filled. */
export function svg(name: string, body: string): string {
  return `<svg class="ico" data-glyph="${name}" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" ` +
    `fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

/** A dot: the one fill the family allows — a point is a dot. */
export const dot = (x: number, y: number, r = 1.9) => `<circle cx="${x}" cy="${y}" r="${r}" fill="currentColor" stroke="none"/>`;

/**
 * The tools' glyphs, by the name each is registered under — filled by the
 * modules, in module order (`defineIcon`). A test holds this to the registry:
 * a built-in without a glyph, or a glyph for a name nothing registers, fails it.
 */
export const TOOL_ICONS: Readonly<Record<string, string>> = {};

/** Registers `name`'s glyph. A module's; refused for a name that has one, so two modules cannot both draw it. */
export function defineIcon(name: string, glyph: string): void {
  if (hasIcon(name)) throw new Error(`the tool "${name}" already has a glyph`);
  (TOOL_ICONS as Record<string, string>)[name] = glyph;
}

/** Drops `name`'s glyph — a removed module's. */
export function undefineIcon(name: string): void {
  delete (TOOL_ICONS as Record<string, string>)[name];
}

export function hasIcon(name: string): boolean {
  return Object.hasOwn(TOOL_ICONS, name);
}

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
