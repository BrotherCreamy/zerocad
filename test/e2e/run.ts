// Runner for the end-to-end suite.
//
// The dev server is started here, once, rather than by the test files: node's
// test runner executes files in parallel, so leaving each one to start its own
// server means five processes racing for the same port. Starting it here also
// means it is reliably torn down — a spawned child keeps its parent alive, so
// a test process that starts a server never exits on its own.
//
// **Every run claims its own free port.** The runner used to reuse anything it
// found on 5173, which was convenient right up until more than one checkout of
// this repo existed on a machine: with implementation work running in isolated
// worktrees, a suite that reuses "the" dev server can silently test another
// worktree's code — and pass, for the wrong tree. A test that can pass for the
// wrong code is worse than no test. To point the suite at a server you manage
// yourself, set NEOCAD_E2E_URL explicitly; nothing is ever reused by accident.

import { spawn } from "node:child_process";
import { createServer } from "node:net";

const root = new URL("../..", import.meta.url).pathname;

async function isUp(url: string): Promise<boolean> {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(1500) })).ok;
  } catch {
    return false;
  }
}

/** A port the OS says is free right now. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

async function main(): Promise<number> {
  const explicit = process.env.NEOCAD_E2E_URL;
  let url: string;
  let server: ReturnType<typeof spawn> | null = null;

  if (explicit) {
    url = explicit;
    if (!(await isUp(url))) throw new Error(`NEOCAD_E2E_URL is set to ${url}, but nothing answers there`);
    console.log(`testing against ${url} (NEOCAD_E2E_URL)`);
  } else {
    const port = await freePort();
    url = `http://localhost:${port}/`;
    // Vite's binary directly, not `npm run dev`: npm spawns a shell which
    // spawns vite, so killing what we spawned would leave the real server
    // orphaned and the port held for the next run. --strictPort so a race for
    // the port fails loudly instead of vite drifting to a neighbouring one.
    const viteBin = new URL("../../node_modules/vite/bin/vite.js", import.meta.url).pathname;
    server = spawn(process.execPath, [viteBin, "--port", String(port), "--strictPort"], { cwd: root, stdio: "ignore" });
  }

  try {
    if (server) {
      const deadline = Date.now() + 30_000;
      while (!(await isUp(url))) {
        if (Date.now() > deadline) throw new Error("the dev server did not come up within 30s — try `npm run dev` by hand to see why");
        await new Promise((r) => setTimeout(r, 300));
      }
    }

    const tests = spawn(
      process.execPath,
      // Files named on the command line instead of the suite: how the depth
      // measurement (depth.measure.ts, `npm run measure:depth`) gets the same
      // private server without being part of every run.
      ["--experimental-strip-types", "--test", "--test-concurrency=2", ...(process.argv.length > 2 ? process.argv.slice(2) : ["test/e2e/*.e2e.ts"])],
      { cwd: root, stdio: "inherit", env: { ...process.env, NEOCAD_E2E_URL: url } },
    );
    return await new Promise<number>((resolve) => tests.on("exit", (code) => resolve(code ?? 1)));
  } finally {
    server?.kill();
  }
}

process.exitCode = await main();
