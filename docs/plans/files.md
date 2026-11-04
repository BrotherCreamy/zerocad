# Plan: files — open, save, share and keep, on an iPhone and on a desktop

**Status: queued** (2026-11-04). The owner: *"think about file system access
etc. I want to be able to open files on my phone, share files etc. Should
also work for desktop."*

Read `CLAUDE.md`, `docs/plans/effortless.md`, `pwa-pages.md` (as built —
the manifest and the service worker), `src/persist.ts` (`save`/`open`, the
format, `toolsource`), `src/replenv.ts` (`save`, `open`, `download`,
`openFile` and the host handles behind them), `src/main.ts` (where the host
implements `download` and `openFile`, the undo stack's snapshots, the keydown
listeners), `src/undo.ts`, `scripts/pwa-shell.ts`, and the persist and e2e
tests.

A parallel package (`docs/plans/chrome-logo-scale.md`) builds the app menu.
**That package owns the menu; this one owns the commands.** The menu's File
items type `newFile()`, `openFile()`, `saveFile()`, `shareFile()` through
`submit`, and read a host function `document(): { name: string; dirty:
boolean }` for its name line — implement those here, under exactly those
names, and supply `document()` in `main.ts`.

## What the platforms allow (check each claim against current docs; correct this spec where it is wrong)

- **iOS Safari, in the browser or installed to the home screen**: no File
  System Access API. `<input type="file">` opens the Files picker (iCloud
  Drive, On My iPhone, any provider app). The Web Share API with files
  (`navigator.share({ files })`, iOS 15+) opens the share sheet: Save to
  Files, AirDrop, Messages, Mail. A download (`<a download>`) works but in
  standalone mode lands in a preview, not a save. **A web app on iOS cannot
  register to open files** (no `file_handlers`) **or receive shares** (no
  `share_target`) — say so in the README rather than pretend.
- **Desktop Chromium (Chrome, Edge)**: the File System Access API —
  `showOpenFilePicker`/`showSaveFilePicker` and a handle that writes back in
  place; an installed PWA can declare `file_handlers` and receive files via
  `launchQueue`. **Firefox and desktop Safari**: the input and a download.

## Design

- **The document has a name and a dirty flag.** The name is the file's (or
  "Untitled"); dirty is "the model differs from what was last opened or
  saved", read off the journal and values rather than a guessed flag — the
  undo stack's snapshot text is the same format, so compare against the
  snapshot taken at the last open or save. `document()` returns both.
- **`openFile()`** — Chromium: `showOpenFilePicker` (keep the handle).
  Elsewhere: the file input. The picker accepts the app's files: `.json`
  (and `application/json`) — check that iOS does not grey out a
  `.zerocad.json` file with whatever `accept` you choose, in the docs if not
  on a device. Opening replaces the document through the existing `open`
  (one undo step, as now), sets the name, and asks first when the current
  document is dirty (`confirm` is acceptable; say if you choose otherwise).
- **`saveFile()`** — with a writable handle: write in place, no dialog.
  Chromium without one: `showSaveFilePicker`, then keep that handle. Elsewhere:
  `shareFile()` where files can be shared (on a phone, saving *is* the share
  sheet's Save to Files), else a download. Clears dirty. **Ctrl/⌘+S** types
  `saveFile()`, **Ctrl/⌘+O** `openFile()`, with the browser's own defaults
  prevented, and never while the command line is mid-edit of something the
  key belongs to.
- **`shareFile()`** — `navigator.share({ files: [file], title })` when
  `navigator.canShare({ files })` says yes; else a download. The file is
  `<name>.zerocad.json`, `application/json`. A share the user cancels is not
  an error.
- **`newFile()`** — a fresh document (asking first when dirty), named
  "Untitled". One undo step, so a slip is recoverable.
- **Drag and drop** a file onto the window (desktop): the same as Open, with a
  visible drop hint while a file is over the window.
- **Installed desktop PWA**: `file_handlers` for `.zerocad.json` (and
  `launchQueue` consumer), added to the manifest `scripts/pwa-shell.ts`
  writes. iOS ignores it, harmlessly.
- **Autosave and restore — the important one on a phone.** iOS evicts a
  backgrounded web app without warning; a drawing that only lived in memory
  is gone. So the current document — the same text `save()` makes, plus its
  name and whether it is dirty — is written to device storage (IndexedDB, or
  local storage if you can show the size is safe; say which and why) after
  every change, debounced, and on `visibilitychange` to hidden; on start, it
  is restored, before the first render. `newFile()` replaces it. If restoring
  fails (a file from a newer format), start empty and say why in the log,
  keeping the stored copy rather than overwriting it. Storage that throws
  (private mode) degrades to no autosave, said once.
- **Every one of these is a command first** (`newFile`, `openFile`,
  `saveFile`, `shareFile`), registered in `replenv.ts` and in `help()`.
  None journals anything — they act on the document, not in it — so none
  belongs in `persist.ts`'s replay table; say so in the code.

## Tests

Unit: dirty tracking (open → clean, an edit → dirty, undo back to the opened
state → clean, save → clean); the file's name and type; the share/download
fallback choice from capabilities; autosave's debounce, restore, the
newer-format refusal and the throwing-storage path.

E2E (Chromium, desktop and iPhone 13 emulation): `saveFile()` with a stubbed
`showSaveFilePicker` writes the text and a second save writes in place;
without the API it downloads `Untitled.zerocad.json` (Playwright's download
event); `openFile()` through the file input opens a fixture and names the
document; `shareFile()` with a stubbed `navigator.share` receives one
`application/json` file; drag and drop of a fixture opens it; Ctrl+S and
Ctrl+O; a drawing survives a reload with autosave (and does not after
`newFile()`); the dirty prompt on open and new. Every existing e2e test
passes.

## Docs

CHANGELOG at the top, quoting the owner, and saying plainly what an iPhone
cannot do; README's phone section (how to open and share on an iPhone,
where files go); the register (autosave on by default, saving on a phone is
the share sheet, the shortcuts) as vetoable; STATUS; `help()`; the spec
marked built.
