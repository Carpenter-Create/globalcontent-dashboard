#!/usr/bin/env node
/**
 * Phase B supervised dry-run CLI entry.
 *
 * Loads TypeScript via Vite SSR resolved from Vitest's dependency tree.
 * No new package dependencies. No GitHub network writes.
 *
 * Usage:
 *   pnpm ae:dry-run -- help
 *   pnpm ae:dry-run -- validate-contract --file path.yaml
 */

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function resolveViteEntry() {
  const vitestPkg = require.resolve("vitest/package.json");
  const candidates = [
    // pnpm: .../node_modules/vitest → .../node_modules/vite
    path.join(path.dirname(vitestPkg), "..", "vite", "package.json"),
    path.join(path.dirname(vitestPkg), "node_modules", "vite", "package.json"),
  ];
  for (const vitePkg of candidates) {
    if (existsSync(vitePkg)) {
      return pathToFileURL(
        path.join(path.dirname(vitePkg), "dist/node/index.js"),
      ).href;
    }
  }
  throw new Error(
    "Unable to resolve vite from vitest installation (required for ae:dry-run)",
  );
}

const { createServer } = await import(resolveViteEntry());

const server = await createServer({
  configFile: false,
  root,
  server: { middlewareMode: true },
  appType: "custom",
  resolve: {
    alias: { "@": path.join(root, "src") },
  },
});

await server.pluginContainer.buildStart({});
const mod = await server.ssrLoadModule(
  "/src/lib/agentic-engineering/dry-run-cli.ts",
);
const result = await mod.runAeDryRunCli(process.argv.slice(2));
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
await server.close();
process.exit(result.exitCode);
