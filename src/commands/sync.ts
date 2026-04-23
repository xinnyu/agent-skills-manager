import * as readline from "node:readline/promises";

import type { Command } from "commander";

import { syncSkills, type SyncConflict } from "../core/sync-engine";
import { getRegistryPath } from "../core/registry";

async function promptReplaceDir(conflict: SyncConflict, rl: readline.Interface): Promise<boolean> {
  process.stdout.write(
    `Conflict: "${conflict.skillName}" already exists at ${conflict.targetPath}\n`,
  );
  const answer = await rl.question("Delete it and replace it with the managed symlink? [y/N]: ");
  const trimmed = answer.trim().toLowerCase();
  return trimmed === "y" || trimmed === "yes";
}

export function registerSyncCommand(program: Command): void {
  program
    .command("sync")
    .description("Sync skill symlinks to all configured targets")
    .action(async () => {
      const regPath = await getRegistryPath();
      if (!regPath.ok) {
        process.stderr.write(`Error: ${regPath.error}\n`);
        process.exit(1);
      }

      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const result = await syncSkills({
        registryDir: regPath.value,
        cwd: process.cwd(),
        confirmReplaceDir: (conflict) => promptReplaceDir(conflict, rl),
      });
      rl.close();
      if (!result.ok) {
        process.stderr.write(`Error: ${result.error}\n`);
        process.exit(1);
      }

      if (result.value.skipped) {
        process.stdout.write("✓ Already in sync\n");
      } else {
        process.stdout.write("✓ Synced skill symlinks\n");
      }
    });
}
