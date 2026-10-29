// Which keystrokes are undo and redo — a pure function of the key event's
// fields, so "is this chord Ctrl+Z?" is answerable in the unit suite without a
// browser. The listener that acts on the answer is main.ts's.
//
// Imports nothing: the shape it reads is the part of a KeyboardEvent that
// matters, and a test builds that shape out of a literal.

/** The fields of a `KeyboardEvent` the chord is read from. */
export interface ChordKeys {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/**
 * `"undo"` for Ctrl+Z / Cmd+Z, `"redo"` for Ctrl+Y / Cmd+Y and for
 * Ctrl+Shift+Z / Cmd+⇧Z, and null for anything else.
 *
 * **`key` first, `code` only when `key` is not a Latin letter.** `key` is the
 * letter the layout prints on the key, which is what a person means by "Z";
 * `code` is the physical position on a US keyboard. On a Cyrillic or Greek
 * layout the key under the finger reports `я` or `ζ`, and there `code`
 * (`KeyZ`) is the only way to recognise the chord at all. But on QWERTZ the
 * key labelled Z sits where a US Y does — `key: "z"`, `code: "KeyY"` — so a
 * matcher that accepted either field outright would read one keystroke as
 * undo *and* redo. Falling back to `code` only when the layout produced no
 * Latin letter keeps both kinds of layout right.
 *
 * Case-insensitive, because Shift (and Caps Lock) turn `z` into `Z`. Alt is
 * excluded: AltGr arrives as Ctrl+Alt on Windows, and AltGr+Z is a character
 * on some layouts, not an undo.
 */
export function historyChord(e: ChordKeys): "undo" | "redo" | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  const letter = /^[a-z]$/i.test(e.key) ? e.key.toLowerCase()
    : e.code === "KeyZ" ? "z"
    : e.code === "KeyY" ? "y"
    : null;
  if (letter === "z") return e.shiftKey ? "redo" : "undo";
  if (letter === "y") return "redo";
  return null;
}
