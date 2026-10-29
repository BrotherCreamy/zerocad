// The undo/redo chord matcher (src/historykeys.ts), on literal key events. The
// browser half — that the chord reaches the model wherever the focus is — is
// test/e2e/undo.e2e.ts; this is the half a browser run cannot vary, because the
// keyboard layout of the machine running the suite is whatever it is.

import { test } from "node:test";
import assert from "node:assert/strict";
import { historyChord, type ChordKeys } from "../src/historykeys.ts";

const press = (over: Partial<ChordKeys>): ChordKeys => ({
  key: "", code: "", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...over,
});

test("Ctrl+Z and Cmd+Z undo; Ctrl+Y, Cmd+Y, Ctrl+Shift+Z and Cmd+Shift+Z redo", () => {
  assert.equal(historyChord(press({ key: "z", code: "KeyZ", ctrlKey: true })), "undo");
  assert.equal(historyChord(press({ key: "z", code: "KeyZ", metaKey: true })), "undo");
  assert.equal(historyChord(press({ key: "y", code: "KeyY", ctrlKey: true })), "redo");
  assert.equal(historyChord(press({ key: "y", code: "KeyY", metaKey: true })), "redo");
  // Shift capitalises the key; the match must not care.
  assert.equal(historyChord(press({ key: "Z", code: "KeyZ", ctrlKey: true, shiftKey: true })), "redo");
  assert.equal(historyChord(press({ key: "Z", code: "KeyZ", metaKey: true, shiftKey: true })), "redo");
  // Caps Lock, no Shift: still undo.
  assert.equal(historyChord(press({ key: "Z", code: "KeyZ", ctrlKey: true })), "undo");
});

test("code is accepted where the layout names the key something else", () => {
  // Russian: the key at Z's position types я, and Ctrl on it is still undo.
  assert.equal(historyChord(press({ key: "я", code: "KeyZ", ctrlKey: true })), "undo");
  assert.equal(historyChord(press({ key: "н", code: "KeyY", ctrlKey: true })), "redo");
  assert.equal(historyChord(press({ key: "Я", code: "KeyZ", ctrlKey: true, shiftKey: true })), "redo");
  // A key name the platform could not identify, with the position intact.
  assert.equal(historyChord(press({ key: "Unidentified", code: "KeyZ", metaKey: true })), "undo");
});

test("where key and code disagree on a Latin layout, the printed letter wins", () => {
  // German QWERTZ: the key labelled Z sits at US Y's position, and the reverse.
  // Accepting either field outright would make this one keystroke both chords.
  assert.equal(historyChord(press({ key: "z", code: "KeyY", ctrlKey: true })), "undo");
  assert.equal(historyChord(press({ key: "y", code: "KeyZ", ctrlKey: true })), "redo");
  // French AZERTY: W is where US Z is, and Ctrl+W must not undo.
  assert.equal(historyChord(press({ key: "w", code: "KeyZ", ctrlKey: true })), null);
});

test("anything else is not a history chord", () => {
  assert.equal(historyChord(press({ key: "z", code: "KeyZ" })), null, "a bare z is typing");
  assert.equal(historyChord(press({ key: "Z", code: "KeyZ", shiftKey: true })), null);
  assert.equal(historyChord(press({ key: "z", code: "KeyZ", ctrlKey: true, altKey: true })), null, "AltGr is Ctrl+Alt");
  assert.equal(historyChord(press({ key: "x", code: "KeyX", ctrlKey: true })), null);
  assert.equal(historyChord(press({ key: "Control", code: "ControlLeft", ctrlKey: true })), null);
  assert.equal(historyChord(press({ key: "я", code: "KeyQ", ctrlKey: true })), null);
});
