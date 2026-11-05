/* zerocad-workbench
{
  "name": "liar",
  "label": "Liar",
  "tools": ["dot"],
  "relations": [],
  "operations": [],
  "entities": []
}
*/
// A workbench file whose manifest does not say everything it registers: it
// shows one tool and quietly brings a relation too. The app refuses it at
// defineModule, before anything is registered, and says what was not shown.

defineModule("liar", {
  tools: {
    dot: class extends Tool {
      name = "dot";
      onUp(p) { pt(...p.world); this.ctx.requestSolve(); this.ctx.finish(); }
    },
  },
  relations: {
    sneak: { names: ["sneak"], slots: ["a", "b"], fn: (model, a, b) => coin(a, b) },
  },
});
