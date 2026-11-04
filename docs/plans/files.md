# Plan: files — open, save, share and keep, on an iPhone and on a desktop

**Status: built** (2026-11-04), on `claude/files`; see *As built* at the
end for what the platforms really allow (several claims below are corrected
there) and every deviation. The owner: *"think about file system access
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

## As built

What was built, by file: `src/files.ts` (new; pure, imports nothing — the
name and dirty flag, the file's name and type, the save/share/open routes,
`fileChord`, and the `Autosave`); `src/filehost.ts` (new; the DOM half — the
four commands over the pickers, the input, the share sheet and a download,
drag and drop with its hint, the launch queue, the hidden-flush, and the
IndexedDB store); `src/replenv.ts` (`newFile`, `openFile`, `saveFile`,
`shareFile` and `help()`; `download()` is named for the document);
`src/main.ts` (the restore before the first model, `files`, the host's
`document()` as `files.document()`, Ctrl+S / Ctrl+O, the autosave told of
every change); `scripts/pwa-shell.ts` (`file_handlers`). Tests:
`test/files.test.ts` (14), one more in `test/pwa.test.ts`,
`test/e2e/files.e2e.ts` (12), the fixture `test/fixtures/bracket.zerocad.json`.

**The seam with the menu package.** The menu's File items type `newFile()`,
`openFile()`, `saveFile()`, `shareFile()` through `submit`, exactly as named.
Its name line reads the host's `document(): { name, dirty }` — in `main.ts`
that is `files!.document()` (pass `document: () => files!.document()` to the
menu); it is also the `document` host handle in `EnvHandles`.

### What the platforms allow — checked, and where this spec was wrong

Sources: MDN's browser-compat-data 8.1.8 (2026-11-02); Chromium's source
(`chrome/browser/webshare/share_service_impl.cc`,
`third_party/blink/renderer/modules/webshare/`, the manifest parser);
developer.chrome.com's File System Access and File Handling articles;
web.dev's Web Share article; Apple's Safari 15 release notes; WebKit's
storage-policy and ITP posts; WebKit bugs 34442 and 209407.

- **Confirmed: iOS has no File System Access pickers** (`showOpenFilePicker`
  and `showSaveFilePicker`: Safari and iOS "false"). WebKit's file system is
  only the origin-private one, which a person cannot see.
- **Confirmed: an iOS web app cannot register for files or receive shares**
  (`file_handlers` and `share_target`: Safari and iOS "false").
- **Web Share with files on iOS: 15, per Apple** — Safari 15's release notes
  list file sharing (Web Share Level 2) as new. MDN's data says 14; Apple's
  own notes win.
- **Corrected: desktop Safari can share files too** (Safari 14/15), and so
  can Chromium on Windows and ChromeOS (89) and on macOS (128). The spec said
  desktop Safari has only the input and a download. `shareFile()` uses the
  sheet wherever it takes the file. Firefox has Web Share only behind a flag.
- **Corrected: Chromium refuses a `.json` file in a share.** `canShare({ files
  })` says yes to any file (Blink checks no type), and `share()` then rejects
  with NotAllowedError, "Permission denied": `.json` and `application/json`
  are not on Chromium's permitted list (audio, images, PDF, video, and
  `.txt`/`.csv`/`.css`/`.html` text). So "share when `canShare` says yes,
  else download" is not enough: a share refused for any reason but the
  person's cancel downloads instead, and says so.
- **Corrected: the pickers are on Android Chrome too** (132), not desktop
  only; `file_handlers` and `launchQueue` are desktop only (102).
- **Qualified: "write in place, no dialog".** A handle from the save picker
  is writable at once. One from the open picker (or a drop, or the launch
  queue, or restored from storage) is read-only until the person allows
  writing: Chromium asks once, at the first save. Every save after is silent.
- **Not verifiable: a download in a home-screen app "lands in a preview".**
  WebKit bug 209407 says `<a download>` from a home-screen app silently did
  nothing until it was fixed in or before iOS 14.3; nothing documents what it
  does now. Under a finger Save never downloads where the sheet takes files,
  so this only matters as a fallback. On the owner's list.
- **`accept`: `.json,application/json`.** iOS turns `accept` into its own file
  types and greys out what does not match; WebKit bug 34442 reports (iOS 14.5)
  that `.json` in the list narrows the picker to `.json` files exactly, and
  that an extension iOS does not know is not matched. A `.zerocad.json` file
  is a `.json` file to it, so this should offer it; not tried on a device.
  `.zerocad.json` itself is deliberately not in the list.
- **Added: Safari's seven-day cap.** Outside the home-screen app, Safari
  deletes a site's script-written storage (IndexedDB included) after seven
  days of Safari use without visiting it; a home-screen app keeps its own
  count of days of *its* use. So the autosave is safest in the installed app,
  and a file saved to Files is the real keeping. Whether the home-screen app's
  storage is separate from Safari's is not documented; on the owner's list.

### The autosave's storage: IndexedDB

- **Local storage is a few megabytes an origin, and this origin is not
  ours alone**: `brothercreamy.github.io` is every site the account
  publishes, so the room left is unknowable. IndexedDB's quota is a share of
  the disk (WebKit: up to 60 % for a browser app, the same for a home-screen
  app).
- Local storage writes **synchronously on the main thread**, and the
  autosave writes the whole drawing after every change.
- IndexedDB **keeps a Chromium file handle** (they are structured-cloneable),
  so a Save after a restart still writes back to the file it came from.
- Restoring "before the first render" is still true: `main()` already awaits
  the kernel, and awaits the read after it; the first model the app makes is
  the restored one.
- One record under one key in database `neocad.autosave.v1` (the internal
  code name, like the other storage keys): `{ format: "zerocad-autosave",
  version: 1, name, dirty, text, at, handle? }`, `text` exactly what `save()`
  writes. Written 500 ms after the last change, at once on `visibilitychange`
  to hidden and on `pagehide`, and at once after an open, a save or a new.
- When installed (standalone), it asks `navigator.storage.persist()`: WebKit
  grants it by heuristics a home-screen app meets, Chromium for an installed
  app; in a tab Firefox would put up a prompt, so not there.

### Deviations

- **`document()` is a host function, not a command.** In the command scope
  `document` would read as the page's `document`, which the scope
  deliberately never offers (`test/repl.test.ts` checks it does not resolve,
  and caught this). The menu reads it from the host, as specified.
- **The unsaved-changes question comes after the file is chosen** for Open
  (and for a drop or a launch), not before the picker. A picker needs the
  press that asked for it — the browser's transient activation, about five
  seconds in Chromium and Firefox — and a `confirm` answered slowly would
  spend it, so the picker would silently never open. Nothing is lost before
  the question, which then names the file. `newFile()` asks first, as
  specified. `confirm` is used.
- **Save through the share sheet only under a finger.** Desktop Safari can
  share files, but its sheet has no "save" (Mail, Messages, AirDrop, Notes),
  so a mouse's Save there downloads to Downloads, a real file. Under a finger
  where the sheet will not take the file, Save downloads.
- **`file_handlers` claims `.json`, not `.zerocad.json`.** The OS keeps the
  association, by the extension after the last dot; whether a two-part one
  registers anywhere is undocumented and nothing here can install an app to
  try. ZeroCAD is offered under "Open with" for JSON files; a JSON file that
  is not a drawing is refused with the reason.
- **A completed share is a save.** iOS does not say which target the person
  chose, so when `saveFile()` went through the sheet, any completed share —
  Save to Files, AirDrop, Messages — clears dirty; a dismissed sheet does
  not. `shareFile()` (a copy) never clears it. A download is taken as saved
  too, the app having no way to know more.
- **Restored dirty stays dirty** until the next open, save or new: the record
  holds one drawing, not also the one it was dirty against.
- **A refused restore pauses autosave** for the session — nothing is written
  over the kept copy until `newFile()` or an open replaces it — so work drawn
  meanwhile is not autosaved. The log says both.

Additions: a dropped file's Chromium handle is kept, so Save writes back to
it; the handle survives a restart in the autosave; the drop hint is drawn on a
ground of its own (the empty-canvas hint sits in the same middle); Ctrl+S /
Ctrl+O are ignored mid-composition and on key repeat; a refused handle write
(permission denied, file gone) falls back to the save picker; `download()`
names its file for the document. The e2e suites that reload expecting a first
start (panels, tool options, tool source, touch, opaque) now empty the
autosave first (`forgetAutosave` in the harness).

### Limitations left in place, deliberately

- **One autosave slot per device.** Two windows of the app both write it;
  the last one changed is what the next start restores.
- **Undo across an open or a new restores the drawing, not the name** (or
  the handle): the document is then dirty against the file it names.
- **Whether a write started on `visibilitychange` finishes before iOS
  suspends the app** cannot be known from here; the 500 ms debounce after
  every change is the main protection, the hidden-flush a second one.
- **Everything is Chromium's emulation.** What only an iPhone can show is
  in the CHANGELOG entry, for the owner to try.
