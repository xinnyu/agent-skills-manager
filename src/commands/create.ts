import type { Command } from "commander";

import { getRegistryPath } from "../core/registry";
import { addCoreSkill } from "../core/add";

export function registerCreateCommand(program: Command): void {
  program
    .command("create")
    .description("Create a new core skill")
    .argument("<name>", "Skill name (kebab-case, e.g., my-skill)")
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

      const result = await addCoreSkill(trimmedName, regPath.value);
      if (!result.ok) {
        process.stderr.write(`Error: ${result.error}\n`);
        process.exit(1);
      }
      process.stdout.write(`✓ Created core skill "${trimmedName}"\n`);
    });
}
