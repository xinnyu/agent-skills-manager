import type { Command } from "commander";

import { getRegistryPath, detectSkillType } from "../core/registry";
import { removeCoreSkill } from "../core/add";
import { removeVendorSkill } from "../core/vendor";

export function registerRemoveCommand(program: Command): void {
  program
    .command("remove")
    .description("Remove a skill")
    .argument("<name>", "Skill name to remove")
    .action(async (name: string) => {
      const trimmedName = name.trim();
      if (!trimmedName) {
        process.stderr.write("Error: Skill name cannot be empty\n");
        process.exit(1);
      }

      const regPath = await getRegistryPath();
      if (!regPath.ok) {
        process.stderr.write(`Error: ${regPath.error}\n`);
        process.exit(1);
      }

      // Support "vendor/<repo>" format for direct vendor repo removal
      if (trimmedName.startsWith("vendor/")) {
        const repoName = trimmedName.slice("vendor/".length);
        const result = await removeVendorSkill(repoName, regPath.value);
        if (!result.ok) {
          process.stderr.write(`Error: ${result.error}\n`);
          process.exit(1);
        }
        process.stdout.write(`✓ Removed vendor "${repoName}"\n`);
        return;
      }

      const typeResult = await detectSkillType(regPath.value, trimmedName);
      if (!typeResult.ok) {
        process.stderr.write(`Error: ${typeResult.error}\n`);
        process.exit(1);
      }

      const location = typeResult.value;
      if (!location) {
        process.stderr.write(`Error: Skill "${trimmedName}" not found in registry\n`);
        process.exit(1);
      }

      if (location.type === "vendor") {
        const repoName = location.vendorRepo!;
        if (repoName !== trimmedName) {
          process.stderr.write(
            `Error: Skill "${trimmedName}" belongs to vendor repo "${repoName}". ` +
            `Use "asm remove vendor/${repoName}" to remove the entire vendor package.\n`,
          );
          process.exit(1);
        }
        const result = await removeVendorSkill(repoName, regPath.value);
        if (!result.ok) {
          process.stderr.write(`Error: ${result.error}\n`);
          process.exit(1);
        }
        process.stdout.write(`✓ Removed vendor "${repoName}"\n`);
      } else {
        const result = await removeCoreSkill(trimmedName, regPath.value);
        if (!result.ok) {
          process.stderr.write(`Error: ${result.error}\n`);
          process.exit(1);
        }
        process.stdout.write(`✓ Removed skill "${trimmedName}"\n`);
      }
    });
}
