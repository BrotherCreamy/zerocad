// The **files** module (docs/plans/workbenches.md): the document's commands —
// New, Open…, Save, Share… in the logo menu, and their typed forms — and the
// text a file is. The pickers, the share sheet and the autosave are the host's
// (filehost.ts, main.ts); none of this is in a file, so it replays nothing.

import { defineModule } from "../modules.ts";

defineModule("files", {
  label: "Files: the document's name, open, save, share and the autosave",
  // In the order the menu shows them — the seam with the files package, by
  // exactly these names (appmenu.ts).
  files: [
    { label: "New", command: "newFile()" },
    { label: "Open…", command: "openFile()" },
    { label: "Save", command: "saveFile()" },
    { label: "Share…", command: "shareFile()" },
  ],
  help: [
    "files      newFile()  openFile()  saveFile()  shareFile()",
    "           The document has a name (Untitled until opened or saved), and",
    "           the app menu shows it and whether it is unsaved. saveFile()",
    "           writes back to the file it came from where the browser can",
    "           (Chrome, Edge), else asks where; on an iPhone it is the share",
    "           sheet — Save to Files — and elsewhere a download. shareFile()",
    "           hands a copy to the share sheet (AirDrop, Messages, Mail), or",
    "           downloads it. ctrl+s and ctrl+o type saveFile() and openFile();",
    "           a file dropped on the window opens. New and Open ask first when",
    "           there are unsaved changes, and each is one undo step. The",
    "           drawing is autosaved on this device and is there when the app",
    "           starts again. Files are <name>.zerocad.json.",
    "           save()  open(text)  download(name)  journal() — the text itself.",
    "           a file carries the source of tools you defined here, as text:",
    "           open() never runs it, toolSource(name) prints it, and pasting",
    "           it back is an ordinary entry — the paste is the consent.",
  ],
});
