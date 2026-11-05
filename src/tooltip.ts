// The tooltip (docs/plans/tooltips-rgb-frames.md). The owner, after trying the
// hosted app: *"when I hover over tools, I should see a tooltip"*.
//
// Until this, a toolbar button had a native `title`: shown by a desktop browser
// only after a long hover, styled by the OS, and **never on a phone**, which
// has no hover. So every control that is an icon or a short word — a tray's
// buttons, the spin box, the organiser's ＋ and eyes, a panel's strip, the
// logo — has one tooltip instead, drawn by the page in the hover tag's family
// and at the interface size: **the control's name, a line saying what it does,
// and the command it types** (with its key, where it has one).
//
// - **A mouse** sees it after a short hover (`HOVER_MS`) — and at once when it
//   moves straight from one control to the next (`WARM_MS`), as a native
//   toolbar does, so running along the toolbar reads it like a list. It goes
//   on leave and on any press.
// - **A finger** sees it by holding the control (`HOLD_MS`, the canvas
//   recogniser's long-press); lifting without moving then does **not** press
//   the control — the click the lift makes is swallowed — while a tap presses
//   it as it always did, untimed by anything here. It is drawn clear of the
//   finger, above it where there is room, and stays a moment after the lift
//   (`LINGER_MS`) so it can be read without the hand over it.
//
// The native `title` goes from a control that gets one, so two never show at
// once; the control keeps its `aria-label` (its name), and while the tooltip is
// up it is the control's `aria-describedby`, the WAI-ARIA tooltip pattern.
//
// This file knows nothing of the model, the tools or the panels: a control is
// handed in with a function answering its `Tip` when asked, and what the tip
// says is the business of whoever attaches it — the descriptions of the tools
// come from the tools (`static summary`), handed in by main.ts. Placement and
// the text are pure functions, tested without a DOM.

/** What a tooltip says. */
export interface Tip {
  /** The control's name: `Rectangle`, `Undo`. */
  name: string;
  /** One line, in a person's words, of what it does — absent for a tool that declares none. */
  summary?: string | null;
  /** The line it types through the command line, if it types one. */
  command?: string | null;
  /** The key that does the same, where there is one: `Delete`, `Ctrl+Z`, `hold Space`. */
  key?: string | null;
  /** Why it would do nothing now (a disabled button) — said where the command would be. */
  off?: string | null;
}

/** How long a still mouse waits over a control before its tooltip shows. */
export const HOVER_MS = 400;
/** For this long after one tooltip goes, the next control's shows at once — a run along a toolbar. */
export const WARM_MS = 600;
/**
 * How long a finger holds a control before its tooltip shows — the canvas
 * recogniser's long-press (tools/gestures.ts's `LONG_PRESS_MS`, which a test
 * holds this to: this file may not import the tools), so a hold means one
 * thing wherever the finger is.
 */
export const HOLD_MS = 500;
/** How far a held finger may wander before it is a drag (a panel's strip), not a hold — the recogniser's `TAP_SLOP`. */
export const HOLD_SLOP = 8;
/** How long a finger's tooltip stays after the lift. */
export const LINGER_MS = 1500;
/** How far from the point a finger touches the tooltip keeps: a fingertip's half-width and a little. */
export const FINGER_CLEAR = 30;
/** The gap between a tooltip and its control, and the least margin it keeps from the window's edge. */
export const GAP = 6;
export const MARGIN = 4;

/**
 * The tooltip as one line: `Undo (Ctrl+Z) — Takes back the last change —
 * undo()`. What a host without tooltips puts in a control's `title` instead,
 * and what a test compares.
 */
export function tipText(t: Tip): string {
  return [t.key ? `${t.name} (${t.key})` : t.name, t.summary, t.off ?? t.command].filter((s) => s).join(" — ");
}

export interface Box { x: number; y: number; w: number; h: number }
export interface Size { w: number; h: number }
export interface At { x: number; y: number }
/** Which way the line of controls a control sits in runs — a tray's orientation — or null for a control on its own. */
export type Along = "column" | "row" | null;

type Side = "above" | "below" | "left" | "right";

/**
 * Where a tooltip of `size` goes for a control at `anchor`, inside `bounds`
 * (the window less its safe-area insets), in the same coordinates.
 *
 * **A control in a tray never has its tip over its neighbours**
 * (docs/plans/everything-fits.md): the tip goes outside the whole line of
 * controls (`line`, the tray's box — every line of it, where it wrapped), not
 * only outside the control —
 *
 * - **a column** (a tray down an edge): beside it, on the side with more room,
 *   which for a tray docked to an edge is the drawing's; then below or above.
 * - **a row**: under a finger above it — the way iOS puts its callouts, the
 *   hand being below the fingertip — then below it (a strip along the top,
 *   with no room above); under a mouse below it, as native tooltips are,
 *   then above; then beside it.
 *
 * **A control on its own** (`along` null): under a finger above it, then to
 * the side with more room, then under it; under a mouse below, then above.
 *
 * Under a finger every side keeps `FINGER_CLEAR` from the touch point too. The
 * first side that fits whole wins, slid along that side to stay inside; if
 * none fits (a window smaller than the tip), the first is clamped in.
 */
export function tipPlacement(
  anchor: Box, size: Size, bounds: Box, opts: { finger?: At | null; along?: Along; line?: Box | null; clear?: readonly Box[] } = {},
): At & { side: Side } {
  const f = opts.finger ?? null;
  // What the tip keeps off: the tray's whole box for a control in one, so it
  // is beside or past the line — the control's own for one on its own. The
  // slide along a side still centres on the control.
  const off = opts.along && opts.line ? opts.line : anchor;
  const [left, top] = [bounds.x + MARGIN, bounds.y + MARGIN];
  const [right, bottom] = [bounds.x + bounds.w - MARGIN, bounds.y + bounds.h - MARGIN];
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const slideX = (x: number) => clamp(x, left, Math.max(left, right - size.w));
  const slideY = (y: number) => clamp(y, top, Math.max(top, bottom - size.h));
  const cx = f ? f.x : anchor.x + anchor.w / 2;
  const cy = anchor.y + anchor.h / 2;
  const at: Record<Side, () => At> = {
    above: () => ({ x: slideX(cx - size.w / 2), y: Math.min(off.y, f ? f.y - FINGER_CLEAR : Infinity) - GAP - size.h }),
    below: () => ({ x: slideX(cx - size.w / 2), y: Math.max(off.y + off.h, f ? f.y + FINGER_CLEAR : -Infinity) + GAP }),
    right: () => ({ x: Math.max(off.x + off.w, f ? f.x + FINGER_CLEAR : -Infinity) + GAP, y: slideY(cy - size.h / 2) }),
    left: () => ({ x: Math.min(off.x, f ? f.x - FINGER_CLEAR : Infinity) - GAP - size.w, y: slideY(cy - size.h / 2) }),
  };
  // The side with more room first, of the two beside the control.
  const sides: Side[] = off.x - bounds.x >= bounds.x + bounds.w - (off.x + off.w) ? ["left", "right"] : ["right", "left"];
  const order: Side[] = opts.along === "column" ? [...sides, "below", "above"]
    : opts.along === "row" ? (f ? ["above", "below", ...sides] : ["below", "above", ...sides])
    : f ? ["above", ...sides, "below"]
    : ["below", "above", ...sides];
  // And clear of whatever else the control asks it to keep off (a flyout item: the tray it opened from).
  const off2 = opts.clear ?? [];
  const hits = (p: At) => off2.some((o) => p.x < o.x + o.w - 0.5 && o.x < p.x + size.w - 0.5 && p.y < o.y + o.h - 0.5 && o.y < p.y + size.h - 0.5);
  const fits = (p: At) => p.x >= left - 0.5 && p.y >= top - 0.5 && p.x + size.w <= right + 0.5 && p.y + size.h <= bottom + 0.5 && !hits(p);
  for (const side of order) {
    const p = at[side]();
    if (fits(p)) return { ...p, side };
    // Slid along that side, just past a box it is to keep off — above a
    // flyout, to the far side of the tray it opened from.
    for (const o of off2) {
      const slid: At[] = side === "above" || side === "below"
        ? [{ x: o.x + o.w + GAP, y: p.y }, { x: o.x - GAP - size.w, y: p.y }]
        : [{ x: p.x, y: o.y + o.h + GAP }, { x: p.x, y: o.y - GAP - size.h }];
      for (const q of slid) if (fits(q)) return { ...q, side };
    }
  }
  const p = at[order[0]]();
  return { x: slideX(p.x), y: slideY(p.y), side: order[0] };
}

/** The narrowest a tip is made to fit beside a column; below it, the tip keeps its width and the usual fallback. */
export const MIN_TIP_W = 120;

/**
 * The width a tip has beside a column `line` — on its wider side, inside
 * `bounds` less the margin, the gap off the line, and under a finger the
 * finger's clearance too: what `tipPlacement`'s left and right sides need.
 */
export function roomBeside(line: Box, bounds: Box, finger: At | null = null): number {
  const right = bounds.x + bounds.w - MARGIN - (Math.max(line.x + line.w, finger ? finger.x + FINGER_CLEAR : -Infinity) + GAP);
  const left = Math.min(line.x, finger ? finger.x - FINGER_CLEAR : Infinity) - GAP - (bounds.x + MARGIN);
  return Math.max(right, left);
}

/** Answers a control's tip when it is about to be shown — asked then, so it says what the control would do now. */
export type TipSource = () => Tip | null;

export interface AttachOptions {
  /** Which way the control's line runs, asked at each showing (a tray turns). */
  along?: () => Along;
  /** The element holding the control's whole line — the tray — whose box the tip keeps off. */
  line?: () => Element | null;
  /** Other elements the tip keeps off — a flyout item's tray (docs/plans/toolbar-groups.md). */
  clear?: () => Element[];
  /**
   * False where a finger's hold already means something on this control — an
   * organiser row's long-press is its menu — so only a mouse shows the tip.
   */
  hold?: boolean;
}

/** How a host hands a control to the tooltip: what panels.ts, the organiser and the app menu are given. */
export type AttachTip = (control: HTMLElement, tip: TipSource, options?: AttachOptions) => void;

/**
 * A control's tip, by the host's `attach` where there is one — or, where
 * there is none (a host that has no tooltip, a test's), its `title`, as every
 * control had before.
 */
export function giveTip(control: HTMLElement, tip: TipSource, attach: AttachTip | undefined, options?: AttachOptions): void {
  if (attach) {
    attach(control, tip, options);
    return;
  }
  const t = tip();
  if (t) control.title = tipText(t);
}

interface Entry { tip: TipSource; along?: () => Along; line?: () => Element | null; clear?: () => Element[]; hold: boolean }

/**
 * The one tooltip element, and every control attached to it. Listening is
 * done once, on the window and the document, rather than per control: a
 * control is found from an event's target by walking up to the nearest one
 * attached (so the organiser's ＋, inside its pane's strip, is the ＋ and not
 * the strip), and a toolbar rebuilt by a newly defined tool needs nothing
 * re-wired.
 */
export class Tooltips {
  private el: HTMLElement;
  private bounds: () => Box;
  private controls = new WeakMap<Element, Entry>();
  /** The control whose tip is on screen. */
  private shown: HTMLElement | null = null;
  /** The control a mouse is over — whose tip shows when the hover timer runs out. */
  private hovered: HTMLElement | null = null;
  /** When a tip last went, for `WARM_MS`. */
  private gone = -Infinity;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private linger: ReturnType<typeof setTimeout> | undefined;
  /** A finger holding a control, until it lifts, wanders, or the hold shows the tip. */
  private held: { id: number; x: number; y: number; control: HTMLElement; timer: ReturnType<typeof setTimeout>; showed: boolean } | null = null;
  /** The control whose next click is the lift of a hold that showed its tip — swallowed, not a press. */
  private swallow: HTMLElement | null = null;

  constructor(el: HTMLElement, options: { bounds: () => Box }) {
    this.el = el;
    this.bounds = options.bounds;
    el.hidden = true;
    el.setAttribute("role", "tooltip");
    if (!el.id) el.id = "tooltip";
    document.addEventListener("pointerover", (e) => { if (e.pointerType !== "touch") this.hover(this.controlOf(e.target)); });
    document.addEventListener("pointerout", (e) => { if (e.pointerType !== "touch") this.hover(this.controlOf(e.relatedTarget)); });
    // Capture, on the window: ahead of whatever the press does — a panel's
    // strip captures the pointer, a button arms a tool — and seen whatever it
    // lands on.
    window.addEventListener("pointerdown", (e) => this.down(e), true);
    window.addEventListener("pointermove", (e) => this.move(e), true);
    window.addEventListener("pointerup", (e) => this.up(e), true);
    window.addEventListener("pointercancel", (e) => this.up(e), true);
    window.addEventListener("click", (e) => this.click(e), true);
    window.addEventListener("keydown", (e) => { if (e.key === "Escape") this.hide(); }, true);
    window.addEventListener("blur", () => this.hide());
    window.addEventListener("wheel", () => this.hide(), { capture: true, passive: true });
    // A keyboard's focus shows the tip as a hover does (a press never focuses
    // these controls: each keeps the command line's focus on mousedown).
    document.addEventListener("focusin", (e) => {
      const c = this.controlOf(e.target);
      if (c && c === e.target && c.matches(":focus-visible")) this.show(c, null);
    });
    document.addEventListener("focusout", (e) => { if (this.shown && this.shown === e.target && !this.hovered) this.hide(); });
  }

  /** Gives `control` its tooltip — the `AttachTip` every host is handed. */
  readonly attach: AttachTip = (control, tip, options = {}) => {
    this.controls.set(control, { tip, along: options.along, line: options.line, clear: options.clear, hold: options.hold ?? true });
    // One tooltip at a time: the native one goes.
    control.removeAttribute("title");
    control.dataset.tip = "";
  };

  /** The tooltip's own element — for a test, and for nothing else. */
  get element(): HTMLElement {
    return this.el;
  }

  private controlOf(target: EventTarget | null): HTMLElement | null {
    for (let n = target instanceof Node ? target : null; n; n = n.parentNode) {
      if (n instanceof HTMLElement && this.controls.has(n)) return n;
    }
    return null;
  }

  /** The mouse is now over `c` (or no control): show, wait, or hide. */
  private hover(c: HTMLElement | null): void {
    if (c === this.hovered) return;
    this.hovered = c;
    clearTimeout(this.timer);
    if (this.held?.showed) return; // a finger's tip is the finger's
    if (!c) {
      this.hide();
      return;
    }
    if (this.shown || performance.now() - this.gone < WARM_MS) this.show(c, null);
    else this.timer = setTimeout(() => { if (this.hovered === c) this.show(c, null); }, HOVER_MS);
  }

  private down(e: PointerEvent): void {
    // Any press puts a tip away — over the control pressed too: what it does
    // is happening, and its tip would only sit over the result. The mouse
    // stays "over" it, so the tip does not come back until it leaves; and the
    // next control waits its hover, as after a press in a native toolbar.
    clearTimeout(this.timer);
    this.hide();
    this.gone = -Infinity;
    this.swallow = null;
    if (this.held) this.drop();
    if (e.pointerType !== "touch") return;
    const c = this.controlOf(e.target);
    if (!c || !this.controls.get(c)!.hold) return;
    const finger = { x: e.clientX, y: e.clientY };
    const held = {
      id: e.pointerId, ...finger, control: c, showed: false,
      timer: setTimeout(() => {
        held.showed = true;
        this.swallow = c;
        this.show(c, finger);
      }, HOLD_MS),
    };
    this.held = held;
  }

  private move(e: PointerEvent): void {
    const h = this.held;
    if (!h || e.pointerId !== h.id || Math.hypot(e.clientX - h.x, e.clientY - h.y) <= HOLD_SLOP) return;
    // A drag — a panel's strip being moved — and not a hold: the tip, if it
    // came, is left behind where the finger was, so it goes.
    this.drop();
    if (h.showed) this.hide();
  }

  private up(e: PointerEvent): void {
    const h = this.held;
    if (!h || e.pointerId !== h.id) return;
    this.drop();
    if (h.showed && this.shown) this.linger = setTimeout(() => this.hide(), LINGER_MS);
  }

  private drop(): void {
    if (this.held) clearTimeout(this.held.timer);
    this.held = null;
  }

  /**
   * The click a lift makes after a hold that showed the tip: not a press. A
   * phone may or may not make one after so long a touch (Chromium does not,
   * iOS may), so it is swallowed if it comes, and forgotten at the next press.
   */
  private click(e: MouseEvent): void {
    const s = this.swallow;
    if (!s) return;
    this.swallow = null;
    if (e.target instanceof Node && s.contains(e.target)) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  private show(c: HTMLElement, finger: At | null): void {
    const entry = this.controls.get(c);
    const tip = entry && c.isConnected ? entry.tip() : null;
    if (!tip) {
      this.hide();
      return;
    }
    clearTimeout(this.linger);
    if (this.shown && this.shown !== c) this.shown.removeAttribute("aria-describedby");
    this.fill(tip);
    this.el.hidden = false;
    this.shown = c;
    c.setAttribute("aria-describedby", this.el.id);
    const r = c.getBoundingClientRect();
    const l = entry!.line?.()?.getBoundingClientRect() ?? null;
    // A column's tip goes beside it; where the wider side is narrower than the
    // tip, the tip is narrowed to it, to wrap, rather than clamped back over
    // the column. Seen on an iPhone SE once the tray was eleven buttons, one
    // column the screen's height: no room above or below it either.
    this.el.style.maxWidth = "";
    if (l && entry!.along?.() === "column") {
      const room = roomBeside({ x: l.x, y: l.y, w: l.width, h: l.height }, this.bounds(), finger);
      if (room < this.el.offsetWidth && room >= MIN_TIP_W) this.el.style.maxWidth = `${Math.floor(room)}px`;
    }
    const size = { w: this.el.offsetWidth, h: this.el.offsetHeight };
    const p = tipPlacement({ x: r.x, y: r.y, w: r.width, h: r.height }, size, this.bounds(),
      { finger, along: entry!.along?.() ?? null, line: l ? { x: l.x, y: l.y, w: l.width, h: l.height } : null,
        clear: (entry!.clear?.() ?? []).map((e) => { const q = e.getBoundingClientRect(); return { x: q.x, y: q.y, w: q.width, h: q.height }; }) });
    this.el.style.left = `${Math.round(p.x)}px`;
    this.el.style.top = `${Math.round(p.y)}px`;
    this.el.dataset.side = p.side;
  }

  /** Puts the tip away, if one is up. */
  hide(): void {
    clearTimeout(this.timer);
    clearTimeout(this.linger);
    if (!this.shown) return;
    if (this.shown.getAttribute("aria-describedby") === this.el.id) this.shown.removeAttribute("aria-describedby");
    this.shown = null;
    this.gone = performance.now();
    this.el.hidden = true;
  }

  /** The name (and key) on one line, then what it does, then the command it types or why it would do nothing. */
  private fill(t: Tip): void {
    this.el.textContent = "";
    const head = document.createElement("div");
    head.className = "tname";
    head.textContent = t.name;
    if (t.key) {
      const key = document.createElement("span");
      key.className = "tkey";
      key.textContent = t.key;
      head.appendChild(key);
    }
    this.el.appendChild(head);
    const line = (cls: string, text: string) => {
      const d = document.createElement("div");
      d.className = cls;
      d.textContent = text;
      this.el.appendChild(d);
    };
    if (t.summary) line("tsum", t.summary);
    if (t.off) line("toff", t.off);
    else if (t.command) line("tcmd", t.command);
  }
}
