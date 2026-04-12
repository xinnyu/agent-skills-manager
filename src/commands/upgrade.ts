import type { Command } from "commander";

import { upgradeSkills } from "../core/upgrade";
import { formatTable } from "../utils/format";

export function registerUpgradeCommand(program: Command): void {
  program
    .command("upgrade")
    .description("Upgrade vendor skills to latest versions")
    .option("--dry-run", "Check for updates without applying them")
    .action(async (options: { dryRun?: boolean }) => {
      const result = await upgradeSkills({ dryRun: options.dryRun });
      if (!result.ok) {
        process.stderr.write(`Error: ${result.error}\n`);
        process.exit(1);
      }

      if (result.value.length === 0) {
        process.stdout.write("All vendor skills are up to date.\n");
        return;
      }

      if (options.dryRun) {
        process.stdout.write("Updates available:\n");
      } else {
        process.stdout.write("Upgraded:\n");
      }

      const rows = result.value.map((u) => [
        u.name,
        u.currentRef,
        u.remoteRef,
        u.summary.split("\n")[0],
      ]);

      process.stdout.write(formatTable(["NAME", "CURRENT", "LATEST", "SUMMARY"], rows) + "\n");
    });
}
