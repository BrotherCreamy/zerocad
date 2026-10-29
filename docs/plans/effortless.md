# Direction: effortless to pick up, then insanely powerful

**Status: the owner's standing direction** (2026-10-29), verbatim:

> *make the whole thing more intuitive. i should be able to very simply
> extrude etc, not get a bunch of errors. and same with every other tool.
> things should be as easy as every other cad tool makes them, by using
> defaults etc, but then I should be able to customise everything also if I
> want. if the tool has options, there should also be some kind of e.g.
> pop-up menu that allows me to set them visually, or it happens in the
> terminal or whatever. don't be throwing errors at the user for no reason.
> keep the user on track. it should be effortless to pick up but then
> insanely powerful*

This joins "tools work like Onshape" as a rule every package is judged by.
Read as rules:

1. **A tool does the obvious thing with defaults.** Whatever a tool needs
   that the user has not said — a plane, a depth, a radius, an angle — it
   takes from a default or derives from what is on screen, says what it
   chose (the log line it typed), and lets the user change it after.
   Refusing and asking the user to supply it by hand is the last resort,
   for a case where no default is honest.
2. **A refusal is guidance, not an error.** When a click cannot do the
   thing, the tool stays armed, says in one short sentence what *would*
   work ("click inside a closed outline"), and where it can, shows it
   (the regions it can see, the faces it can sketch on). Red is for a
   contradiction in the model, not for a click that missed.
3. **Every option is visible and editable** where the tool is used — a
   small options panel when a tool with options is armed — *and* typeable
   (`arm("extrude", {depth: 25})`), and both are the same thing: the panel
   types the command. A tool declares its options; the panel is built from
   the declaration, so a tool defined at the command line gets one too.
4. **Nothing is hidden behind the terminal.** The terminal is the power
   layer: anything the pointer does is a typed line in the log, and anything
   typed can be done. The pointer layer must never need it.

Two packages carry it first; later packages are held to it.
- [`no-refusals.md`](no-refusals.md): the curve tools make their plane as
  extrude now does, every tool refusal becomes guidance, and the regions a
  click could take are shown.
- [`tool-options.md`](tool-options.md): declared options and the options
  panel, with remembered values.
