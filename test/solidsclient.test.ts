// The kernel behind a Worker's messages (src/solids/client.ts, serve.ts): one
// request at a time, a Worker replaced when it aborts, stops answering or grows
// past its threshold — a crash or a refusal is a message, never a hung app —
// and memory bounded over many rebuilds (the spec: "200 rebuilds stay under
// the cap with recycling"). The Worker here is in-process (test/solids/load.ts):
// each spawn a fresh module with memory of its own, which is what a recycled
// Worker is; the real one is the e2e suite's.

import { test } from "node:test";
import assert from "node:assert/strict";
import { SolidsClient, type Port } from "../src/solids/client.ts";
import type { Program, SweepNode } from "../src/solids/evaluate.ts";
import type { Reply, Request } from "../src/solids/serve.ts";
import { circle, profile, rect } from "./solids/profiles.ts";
import { inProcessPort, noKernel as skip, smlibFactory } from "./solids/load.ts";

const XY = { origin: [0, 0, 0] as [number, number, number], x: [1, 0, 0] as [number, number, number], y: [0, 1, 0] as [number, number, number] };
const top = { ...XY, origin: [0, 0, 10] as [number, number, number] };

/** A plate with a hole whose radius is `r` and a boss whose height is `h` — what a drag of a dimension sends. */
function program(r: number, h: number): Program {
  const nodes: SweepNode[] = [
    { id: 1, op: "new", sweep: { kind: "extrude", depth: 10 }, profile: profile(rect(0, 0, 100, 60)), at: XY },
    { id: 2, op: "subtract", sweep: { kind: "extrude", depth: -12 }, profile: profile(circle(30, 30, r)), at: top },
    { id: 3, op: "union", sweep: { kind: "extrude", depth: h }, profile: profile(circle(70, 30, 8)), at: top },
  ];
  return { bodies: [{ name: "e1", nodes }], prefix: "e", chord: 5e-4, angle: 10 };
}

const MB = 2 ** 20;
/** The module's own ceiling (scripts/solids/build.sh, -sMAXIMUM_MEMORY). */
const CAP = 512 * MB;

test("200 rebuilds, each a dimension dragged one step: memory stays under the cap, every answer is right", { skip }, async () => {
  const factory = await smlibFactory();
  const client = new SolidsClient(() => inProcessPort(factory));
  let most = 0;
  const first = await client.run(program(4, 5));
  const inUse0 = first.heap.inUse;
  for (let i = 0; i < 200; i++) {
    const r = 4 + (i % 10) * 0.2, h = 5 + (i % 7);
    const out = await client.run(program(r, h));
    most = Math.max(most, out.heap.reserved);
    const want = 100 * 60 * 10 - Math.PI * r * r * 10 + Math.PI * 64 * h;
    // Nothing changed since the last ask is said, not sent: the 10 × 7 steps repeat after 70.
    const b = out.bodies[0];
    if (b.cached) continue;
    assert.ok(Math.abs(b.solid!.volume - want) < 1e-6 * want, `rebuild ${i}`);
  }
  const last = await client.run(program(4, 5));
  assert.ok(most < CAP, `${(most / MB).toFixed(1)} MB`);
  // No fillet here, the one leak the spike found: what the kernel holds comes
  // back to where it started, give or take its own caches.
  assert.ok(last.heap.inUse - inUse0 < 2 * MB, `in use grew by ${((last.heap.inUse - inUse0) / MB).toFixed(2)} MB`);
  assert.equal(client.history.spawned, 1, "never needed recycling");
  client.close();
});

test("recycling: past its threshold a Worker is let go after its answer, and the next request rebuilds in a fresh one", { skip }, async () => {
  const factory = await smlibFactory();
  const ports: (Port & { dead: boolean })[] = [];
  // Every Worker is past a threshold of one byte: each answer recycles it.
  const client = new SolidsClient(() => { const p = inProcessPort(factory); ports.push(p); return p; }, { recycleBytes: 1 });
  for (let i = 0; i < 20; i++) {
    const out = await client.run(program(5, 5 + i));
    assert.ok(out.bodies[0].solid, "a fresh Worker has no cache, and answers in full");
    assert.equal(out.bodies[0].cached, undefined);
  }
  assert.equal(client.history.spawned, 20);
  assert.equal(client.history.recycled, 20);
  assert.ok(ports.slice(0, -1).every((p) => p.dead), "each one before the last was terminated");
});

/** A port that answers `init` and then does what `then` says with every other request. */
function fakePort(then: (req: Request, reply: (r: Reply) => void) => void): Port {
  const port: Port = {
    onmessage: null,
    onerror: null,
    postMessage: (req: Request) => {
      const reply = (r: Reply) => setTimeout(() => port.onmessage?.({ data: r }), 0);
      if (req.kind === "init") reply({ id: req.id, ok: true, value: null, ms: 0 });
      else then(req, reply);
    },
    terminate: () => { port.onmessage = null; },
  };
  return port;
}

test("a kernel that aborts is a refusal in words, and the next request gets a fresh Worker", async () => {
  let spawned = 0;
  const client = new SolidsClient(() => {
    spawned++;
    return fakePort((req, reply) => reply(spawned === 1
      ? { id: req.id, ok: false, error: "Aborted(OOM)", dead: true }
      : { id: req.id, ok: true, value: { bodies: [], heap: { inUse: 0, reserved: 0 } }, ms: 0 }));
  });
  await assert.rejects(client.run(program(5, 5)), /Aborted\(OOM\)/);
  assert.equal(client.history.crashed, 1);
  const ok = await client.run(program(5, 5));
  assert.deepEqual(ok.bodies, []);
  assert.equal(spawned, 2);
});

test("a kernel that stops answering is let go on a clock, never waited on", async () => {
  let spawned = 0;
  const client = new SolidsClient(() => {
    spawned++;
    return fakePort((req, reply) => { if (spawned > 1) reply({ id: req.id, ok: true, value: { bodies: [], heap: { inUse: 0, reserved: 0 } }, ms: 0 }); });
  }, { timeoutMs: 50 });
  await assert.rejects(client.run(program(5, 5)), /did not answer in 0 s — it has been restarted/);
  assert.equal(client.history.crashed, 1);
  await client.run(program(5, 5));
  assert.equal(spawned, 2);
});

test("a Worker that fails outright (its script would not load) rejects what was asked, and is replaced", async () => {
  let spawned = 0;
  const client = new SolidsClient(() => {
    spawned++;
    const port = fakePort((req, reply) => reply({ id: req.id, ok: true, value: { bodies: [], heap: { inUse: 0, reserved: 0 } }, ms: 0 }));
    if (spawned === 1) {
      port.postMessage = () => setTimeout(() => port.onerror?.({ message: "404 smlib.mjs" }), 0);
    }
    return port;
  });
  await assert.rejects(client.run(program(5, 5)), /404 smlib\.mjs/);
  await client.run(program(5, 5));
  assert.equal(spawned, 2);
});
