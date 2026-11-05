/* zerocad-workbench
{
  "name": "pins",
  "label": "Pins",
  "workbench": "pins",
  "tools": ["pin"],
  "relations": ["level"],
  "operations": [],
  "entities": ["pin"]
}
*/
// A small workbench file, as someone else might write one: one tool that drops
// a pin where it is clicked, one relation that levels two points, and the pin
// itself — an entity kind of its own, a cross drawn about its point. The
// manifest above is what the app shows before any of this runs.

defineModule("pins", {
  label: "Pins: a marker and a levelling relation",
  tools: {
    pin: class extends Tool {
      static summary = "Drops a pin: click where it goes";
      name = "pin";
      onUp(p) {
        addPin(pt(...p.world));
        this.ctx.requestSolve();
        this.ctx.finish();
      }
    },
  },
  relations: {
    level: {
      names: ["level"],
      slots: ["a", "b"],
      fn: (model, a, b) => model.relation("level", [a, b], () => {
        const A = model.point(a), B = model.point(b);
        model.addResidual([A.varIndices[1], B.varIndices[1]], (l) => [l[0].sub(l[1])]);
      }),
    },
  },
  entities: [{
    kind: "pin",
    noun: "a pin",
    refs: (e) => [e.at],
    add: {
      op: "addPin",
      fn: (model, at, name) => {
        const [nm] = model.claimFirst("pin", name, () => null);
        const e = { kind: "pin", name: nm, at };
        model.place(e);
        model.record("addPin", [at, nm]);
        return e;
      },
    },
    samples: (model, name) => {
      const c = model.coords(model.entities.get(name).at);
      const r = 6;
      const at = (dx, dy) => c.map((v, i) => v + (i === 0 ? dx : i === 1 ? dy : 0));
      return [at(-r, 0), at(r, 0), at(0, 0), at(0, -r), at(0, r)];
    },
  }],
  menu: [{ label: "Pin", tool: "pin" }],
  help: ["pins       pin tool, level(a, b), addPin(point) — the pins workbench file's"],
});

defineWorkbench("pins", { label: "Pins", modules: ["core", "sketch", "pins"] });
