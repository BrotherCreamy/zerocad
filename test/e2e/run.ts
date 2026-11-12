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

/**
 * **The dev server, watched.** On a loaded box (four workers' suites on four
 * cores) vite died partway through a full run once, and what the run said
 * was twenty-one failures from modefeedback onward, each `no dev server at
 * http://localhost:35973/` — a verdict on twenty-one files for what was one
 * event. So the server is spawned by this, which keeps its last lines of
 * stderr, hears it exit, and if that happens while the tests are still
 * running says so in a banner — when it dies, and again at the end, where
 * the person reading the run's tail looks — with its exit code or signal and
 * what it last wrote. It is started again on the same port, at most twice,
 * so that only the files in flight pay for the death: a run is a verdict on
 * the app, and a file that failed for want of a server is no verdict. Dead a
 * third time, the tests are stopped — every failure after it would be the
 * server's — and the run fails saying so.
 */
class DevServer {
  readonly url: string;
  private port: number;
  private child: ReturnType<typeof spawn> | null = null;
  private stderr: string[] = [];
  private stopping = false;
  private restarts = 0;
  /** What happened to it, for the banner at the end: one line per death. */
  readonly deaths: string[] = [];
  /** Called when the server has died for the last time this run will stand. */
  onGivenUp: (() => void) | null = null;

  constructor(port: number) {
    this.port = port;
    this.url = `http://localhost:${port}/`;
  }

  start(): void {
    // Vite's binary directly, not `npm run dev`: npm spawns a shell which
    // spawns vite, so killing what we spawned would leave the real server
    // orphaned and the port held for the next run. --strictPort so a race for
    // the port fails loudly instead of vite drifting to a neighbouring one.
    const viteBin = new URL("../../node_modules/vite/bin/vite.js", import.meta.url).pathname;
    this.stderr = [];
    const child = spawn(process.execPath, [viteBin, "--port", String(this.port), "--strictPort"], { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
    child.stderr?.on("data", (d: Buffer) => {
      this.stderr.push(...d.toString().split("\n").filter((l) => l.trim()));
      if (this.stderr.length > 30) this.stderr.splice(0, this.stderr.length - 30);
    });
    child.on("exit", (code, signal) => this.died(child, code, signal));
    this.child = child;
  }

  private died(child: ReturnType<typeof spawn>, code: number | null, signal: NodeJS.Signals | null): void {
    if (this.stopping || child !== this.child) return;
    const how = signal ? `killed by ${signal}` : `exited with code ${code}`;
    const when = new Date().toISOString().slice(11, 19);
    const tail = this.stderr.length ? `\n#   it last wrote:\n#     ${this.stderr.slice(-8).join("\n#     ")}` : "\n#   it wrote nothing to stderr";
    const death = `${when}: the dev server at ${this.url} ${how}`;
    this.deaths.push(death);
    const again = this.restarts < 2;
    // What the files in flight say (measured, the server SIGKILLed under a
    // run): "no dev server at", and, once it is back, "Execution context was
    // destroyed" or "Cannot find context" — vite's client reconnects and
    // reloads the page under the test.
    console.error(`\n#\n# THE DEV SERVER DIED — ${death}.${tail}\n#   every "no dev server at ${this.url}", "Execution context was destroyed" or "Cannot find context" from the tests around this moment is this one event, not the app;`
      + (again ? `\n#   it is being started again on the same port (restart ${this.restarts + 1} of 2).\n#\n` : "\n#   it has died three times in this run; the tests are being stopped, since every failure after this would be its.\n#\n"));
    if (!again) {
      this.onGivenUp?.();
      return;
    }
    this.restarts++;
    this.start();
  }

  /** Waits for the server to answer, or throws saying it did not. */
  async ready(): Promise<void> {
    const deadline = Date.now() + 30_000;
    while (!(await isUp(this.url))) {
      if (Date.now() > deadline) throw new Error("the dev server did not come up within 30s — try `npm run dev` by hand to see why");
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  stop(): void {
    this.stopping = true;
    this.child?.kill();
  }
}

async function main(): Promise<number> {
  const explicit = process.env.NEOCAD_E2E_URL;
  let url: string;
  let server: DevServer | null = null;

  if (explicit) {
    url = explicit;
    if (!(await isUp(url))) throw new Error(`NEOCAD_E2E_URL is set to ${url}, but nothing answers there`);
    console.log(`testing against ${url} (NEOCAD_E2E_URL)`);
  } else {
    server = new DevServer(await freePort());
    server.start();
    url = server.url;
  }

  try {
    await server?.ready();

    const tests = spawn(
      process.execPath,
      // Files named on the command line instead of the suite: how the depth
      // measurement (depth.measure.ts, `npm run measure:depth`) gets the same
      // private server without being part of every run.
      ["--experimental-strip-types", "--test", "--test-concurrency=2", ...(process.argv.length > 2 ? process.argv.slice(2) : ["test/e2e/*.e2e.ts"])],
      { cwd: root, stdio: "inherit", env: { ...process.env, NEOCAD_E2E_URL: url } },
    );
    let givenUp = false;
    if (server) server.onGivenUp = () => { givenUp = true; tests.kill(); };
    const code = await new Promise<number>((resolve) => tests.on("exit", (code) => resolve(code ?? 1)));
    if (server?.deaths.length) {
      console.error(`\n#\n# THE DEV SERVER DIED DURING THIS RUN${givenUp ? ", AND THE TESTS WERE STOPPED" : ""}:\n#   ${server.deaths.join("\n#   ")}`
        + `\n#   Failures around those moments reading "no dev server at ${url}", "Execution context was destroyed" or "Cannot find context" are that, not the app.`
        + "\n#   Run the files that failed again alone before believing them.\n#\n");
    }
    // A death the tests outlived is said, above, and is not a failure of
    // theirs: a file that ran against the restarted server had its server.
    return givenUp ? 1 : code;
  } finally {
    server?.stop();
  }
}

process.exitCode = await main();
