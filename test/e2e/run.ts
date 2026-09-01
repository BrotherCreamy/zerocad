// Runner for the end-to-end suite.
//
// The dev server is started here, once, rather than by the test files: node's
// test runner executes files in parallel, so leaving each one to start its own
// server means five processes racing for the same port. Starting it here also
// means it is reliably torn down — a spawned child keeps its parent alive, so
// a test process that starts a server never exits on its own.
//
// If a dev server is already running (`npm run dev` in another terminal) this
// reuses it and leaves it alone.

import { spawn } from "node:child_process";
import { APP_URL } from "./harness.ts";

const root = new URL("../..", import.meta.url).pathname;

async function serverIsUp(): Promise<boolean> {
  try {
    return (await fetch(APP_URL, { signal: AbortSignal.timeout(1500) })).ok;
  } catch {
    return false;
  }
}

async function main(): Promise<number> {
  const reused = await serverIsUp();
  // Vite's binary directly, not `npm run dev`: npm spawns a shell which
  // spawns vite, so killing what we spawned would leave the real server
  // orphaned and the port held for the next run.
  const viteBin = new URL("../../node_modules/vite/bin/vite.js", import.meta.url).pathname;
  const server = reused ? null : spawn(process.execPath, [viteBin], { cwd: root, stdio: "ignore" });
  if (reused) console.log("using the dev server already running on 5173");

  try {
    if (server) {
      const deadline = Date.now() + 30_000;
      while (!(await serverIsUp())) {
        if (Date.now() > deadline) throw new Error("the dev server did not come up within 30s — try `npm run dev` by hand to see why");
        await new Promise((r) => setTimeout(r, 300));
      }
    }

    const tests = spawn(
      process.execPath,
      ["--experimental-strip-types", "--test", "--test-concurrency=2", "test/e2e/*.e2e.ts"],
      { cwd: root, stdio: "inherit" },
    );
    return await new Promise<number>((resolve) => tests.on("exit", (code) => resolve(code ?? 1)));
  } finally {
    server?.kill();
  }
}

process.exitCode = await main();
