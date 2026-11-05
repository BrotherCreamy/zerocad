import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    strictPort: false,
    // Vite reloads every open page when any .html file under the root changes,
    // and agents' worktrees live under .claude/worktrees/ inside the root: a
    // worker checking out its tree reloaded the e2e suite's pages mid-test
    // ("Execution context was destroyed", measured across three gates, 2026-11-05).
    // Nothing under .claude/ is this app's; the watcher leaves it alone.
    watch: { ignored: ["**/.claude/**"] },
  },
  build: { target: "es2022" },
});
