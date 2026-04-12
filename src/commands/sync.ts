import type { Command } from "commander";

import { syncSkills } from "../core/sync-engine";
import { getRegistryPath } from "../core/registry";

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

      const result = await syncSkills({
        registryDir: regPath.value,
        cwd: process.cwd(),
      });
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
