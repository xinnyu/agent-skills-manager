import { resolve } from "node:path";

import type { Command } from "commander";

import { initRegistry } from "../core/registry";

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Initialize a skill registry directory")
    .argument("[path]", "Registry directory path", ".")
    .action(async (path: string) => {
      const resolved = resolve(path);
      const result = await initRegistry(resolved);
      if (!result.ok) {
        process.stderr.write(`Error: ${result.error}\n`);
        process.exit(1);
      }
      process.stdout.write(`✓ Registry initialized at ${resolved}\n`);
    });
}
