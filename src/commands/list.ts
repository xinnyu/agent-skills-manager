import type { Command } from "commander";

import { getRegistryPath, scanRegistry } from "../core/registry";
import { formatTable } from "../utils/format";

export function registerListCommand(program: Command): void {
  program
    .command("list")
    .description("List all installed skills")
    .action(async () => {
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

      if (skills.value.length === 0) {
        process.stdout.write("No skills installed. Use `asm add` to add a skill.\n");
        return;
      }

      const rows = skills.value.map((skill) => [
        skill.name,
        skill.type,
        skill.description ?? "",
      ]);

      process.stdout.write(formatTable(["NAME", "TYPE", "DESCRIPTION"], rows) + "\n");
    });
}
