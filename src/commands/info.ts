import type { Command } from "commander";

import { getRegistryPath, scanRegistry } from "../core/registry";

export function registerInfoCommand(program: Command): void {
  program
    .command("info")
    .description("Show detailed information about an installed skill")
    .argument("<name>", "Skill name")
    .action(async (name: string) => {
      const regPath = await getRegistryPath();
      if (!regPath.ok) {
        process.stderr.write(`Error: ${regPath.error}\n`);
        process.exit(1);
      }

      const skills = await scanRegistry(regPath.value);
      if (!skills.ok) {
        process.stderr.write(`Error: ${skills.error}\n`);
        process.exit(1);
      }

      const skill = skills.value.find((s) => s.name === name);
      if (!skill) {
        process.stderr.write(`Error: Skill "${name}" not found\n`);
        process.exit(1);
      }

      const lines = [
        `Name:        ${skill.name}`,
        `Type:        ${skill.type}`,
        `Source:      ${skill.sourcePath}`,
      ];

      if (skill.description) {
        lines.push(`Description: ${skill.description}`);
      }

      process.stdout.write(lines.join("\n") + "\n");
    });
}
