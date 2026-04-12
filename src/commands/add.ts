import type { Command } from "commander";

import { getRegistryPath } from "../core/registry";
import { addVendorSkill, addLocalVendor } from "../core/vendor";

export function registerAddCommand(program: Command): void {
  program
    .command("add")
    .description("Add a vendor skill package")
    .argument("<name>", "Vendor name (e.g., awesome-skills)")
    .option("--url <url>", "Git URL for remote vendor (git submodule)")
    .option("--path <path>", "Local path for vendor (symlink, changes take effect immediately)")
    .action(async (name: string, options: { url?: string; path?: string }) => {
      const trimmedName = name.trim();
      if (!trimmedName) {
        process.stderr.write("Error: Vendor name cannot be empty\n");
        process.exit(1);
      }

      const regPath = await getRegistryPath();
      if (!regPath.ok) {
        process.stderr.write(`Error: ${regPath.error}\n`);
        process.exit(1);
      }

      if (options.url && options.path) {
        process.stderr.write("Error: Cannot specify both --url and --path\n");
        process.exit(1);
      }

      if (options.path) {
        const { resolve } = await import("node:path");
        const absPath = resolve(options.path);
        const result = await addLocalVendor(trimmedName, absPath, regPath.value);
        if (!result.ok) {
          process.stderr.write(`Error: ${result.error}\n`);
          process.exit(1);
        }
        process.stdout.write(`✓ Added local vendor "${trimmedName}" → ${absPath}\n`);
      } else if (options.url) {
        const result = await addVendorSkill(trimmedName, options.url, regPath.value);
        if (!result.ok) {
          process.stderr.write(`Error: ${result.error}\n`);
          process.exit(1);
        }
        process.stdout.write(`✓ Added vendor "${trimmedName}"\n`);
      } else {
        process.stderr.write("Error: Vendor requires --url or --path\n");
        process.exit(1);
      }
    });
}
