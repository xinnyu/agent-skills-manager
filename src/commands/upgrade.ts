import type { Command } from "commander";

import { upgradeSkills } from "../core/upgrade";
import {
  RUNTIME_TABLE_HEADERS,
  checkRuntimes,
  installRuntimes,
  runtimeCheckRows,
  runtimeNeedsFix,
} from "../core/runtime";
import { formatTable } from "../utils/format";

export function registerUpgradeCommand(program: Command): void {
  program
    .command("upgrade")
    .description(
      "Upgrade vendor skills to latest versions (optionally sync companion CLIs)",
    )
    .option("--dry-run", "Check for skill updates and runtime drift without applying them")
    .option(
      "--runtime",
      "Also install/upgrade companion CLIs that are missing or behind (declared strategies only)",
    )
    .action(async (options: { dryRun?: boolean; runtime?: boolean }) => {
      const result = await upgradeSkills({ dryRun: options.dryRun });
      if (!result.ok) {
        process.stderr.write(`Error: ${result.error}\n`);
        process.exit(1);
      }

      if (result.value.length === 0) {
        process.stdout.write("All vendor skills are up to date.\n");
      } else {
        if (options.dryRun) {
          process.stdout.write("Skill updates available:\n");
        } else {
          process.stdout.write("Upgraded skills:\n");
        }

        const rows = result.value.map((u) => [
          u.name,
          u.currentRef,
          u.remoteRef,
          u.summary.split("\n")[0],
        ]);

        process.stdout.write(
          formatTable(["NAME", "CURRENT", "LATEST", "SUMMARY"], rows) + "\n",
        );
      }

      // Always surface companion CLI drift after skill upgrade (or dry-run).
      const runtimes = await checkRuntimes();
      if (!runtimes.ok) {
        process.stderr.write(`\nWarning: runtime check failed: ${runtimes.error}\n`);
        return;
      }

      if (runtimes.value.length === 0) {
        return;
      }

      const drifted = runtimes.value.filter((c) => runtimeNeedsFix(c.status));

      process.stdout.write("\nCompanion runtimes:\n");
      process.stdout.write(
        formatTable([...RUNTIME_TABLE_HEADERS], runtimeCheckRows(runtimes.value)) + "\n",
      );

      if (drifted.length === 0) {
        return;
      }

      if (!options.runtime) {
        process.stdout.write(
          `\n${drifted.length} runtime(s) out of sync with skill checkout. ` +
            `Re-run with \`--runtime\` (or \`asm doctor --fix\`) to update CLIs.\n`,
        );
        return;
      }

      if (options.dryRun) {
        process.stdout.write(
          `\n--runtime --dry-run: would fix ${drifted.length} runtime(s): ` +
            `${drifted.map((d) => d.vendor).join(", ")}\n`,
        );
        return;
      }

      process.stdout.write("\nUpdating companion CLIs…\n");
      const installed = await installRuntimes({
        vendors: drifted.map((d) => d.vendor),
      });
      if (!installed.ok) {
        process.stderr.write(`Error: ${installed.error}\n`);
        process.exit(1);
      }

      for (const r of installed.value) {
        const mark = r.ok ? "✓" : "✗";
        process.stdout.write(
          `${mark} ${r.vendor} (${r.strategy}): ${r.message.split("\n")[0]}\n`,
        );
      }

      const after = await checkRuntimes({
        vendors: drifted.map((d) => d.vendor),
      });
      if (after.ok && after.value.length > 0) {
        process.stdout.write("\nRuntimes after fix:\n");
        process.stdout.write(
          formatTable([...RUNTIME_TABLE_HEADERS], runtimeCheckRows(after.value)) + "\n",
        );
      }

      if (installed.value.some((r) => !r.ok)) {
        process.exit(1);
      }
    });
}
