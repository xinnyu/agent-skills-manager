import type { Command } from "commander";

import {
  RUNTIME_TABLE_HEADERS,
  checkRuntimes,
  installRuntimes,
  runtimeCheckRows,
  runtimeNeedsFix,
} from "../core/runtime";
import { formatTable } from "../utils/format";

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description(
      "Check companion CLI drift for vendors that declare a runtime (skill vs binary)",
    )
    .option("--fix", "Install/upgrade missing or behind CLIs via declared strategies")
    .action(async (options: { fix?: boolean }) => {
      const checks = await checkRuntimes();
      if (!checks.ok) {
        process.stderr.write(`Error: ${checks.error}\n`);
        process.exit(1);
      }

      if (checks.value.length === 0) {
        process.stdout.write(
          "No companion runtimes declared.\n" +
            "Add [vendor.<name>.runtime] in asm.toml, or ship asm.runtime.toml in the vendor repo.\n",
        );
        return;
      }

      process.stdout.write("Companion runtimes:\n");
      process.stdout.write(
        formatTable([...RUNTIME_TABLE_HEADERS], runtimeCheckRows(checks.value)) + "\n",
      );

      const drifted = checks.value.filter((c) => runtimeNeedsFix(c.status));
      const unreadable = checks.value.filter((c) => c.status === "unreadable");

      if (!options.fix) {
        if (drifted.length === 0 && unreadable.length === 0) {
          process.stdout.write("\n✓ All declared companion CLIs look healthy.\n");
          return;
        }

        if (drifted.length > 0) {
          process.stdout.write(
            `\n${drifted.length} runtime(s) need attention. Run \`asm doctor --fix\` or \`asm upgrade --runtime\` to update them.\n`,
          );
        }
        if (unreadable.length > 0) {
          process.stdout.write(
            `${unreadable.length} runtime(s) could not be version-checked (see DETAIL).\n`,
          );
        }
        process.exit(drifted.length > 0 ? 1 : 0);
        return;
      }

      if (drifted.length === 0) {
        process.stdout.write("\nNothing to fix (no missing/behind runtimes).\n");
        return;
      }

      process.stdout.write("\nFixing missing/behind runtimes…\n");
      const results = await installRuntimes({
        vendors: drifted.map((d) => d.vendor),
      });
      if (!results.ok) {
        process.stderr.write(`Error: ${results.error}\n`);
        process.exit(1);
      }

      for (const r of results.value) {
        const mark = r.ok ? "✓" : "✗";
        process.stdout.write(
          `${mark} ${r.vendor} (${r.strategy}): ${r.message.split("\n")[0]}\n`,
        );
      }

      // Re-check after install.
      const after = await checkRuntimes({
        vendors: drifted.map((d) => d.vendor),
      });
      if (after.ok && after.value.length > 0) {
        process.stdout.write("\nAfter fix:\n");
        process.stdout.write(
          formatTable([...RUNTIME_TABLE_HEADERS], runtimeCheckRows(after.value)) + "\n",
        );
      }

      const stillBad = results.value.some((r) => !r.ok);
      if (stillBad) {
        process.exit(1);
      }
    });
}
