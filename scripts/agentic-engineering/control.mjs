#!/usr/bin/env node
/**
 * Phase C supervised GitHub control CLI entry.
 *
 * Loads TypeScript via Vite SSR resolved from Vitest's dependency tree.
 * No new package dependencies.
 *
 * Usage:
 *   pnpm ae:control -- help
 *   pnpm ae:control -- control-bootstrap --dry-run
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
    "Unable to resolve vite from vitest installation (required for ae:control)",
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
  "/src/lib/agentic-engineering/control-cli.ts",
);
const result = await mod.runAeControlCli(process.argv.slice(2));
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
await server.close();
process.exit(result.exitCode);
