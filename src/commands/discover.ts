import type { Command } from "commander";

import { discoverSkills } from "../core/discover";
import { expandHome } from "../utils/paths";
import { formatTable } from "../utils/format";
import type { DiscoveredSkill } from "../types";

function parseRoots(rawRoots?: string): string[] | undefined {
  if (rawRoots === undefined) return undefined;
  return rawRoots
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => expandHome(segment));
}

function formatDiscoverTable(skills: DiscoveredSkill[]): string {
  if (skills.length === 0) {
    return "No skills found.";
  }

  const rows = skills.map((skill) => [
    skill.name,
    skill.kind,
    skill.type,
    skill.path,
    skill.description ?? "",
  ]);

  return formatTable(["NAME", "KIND", "TYPE", "PATH", "DESCRIPTION"], rows);
}

export function registerDiscoverCommand(program: Command): void {
  program
    .command("discover")
    .description("Recursively discover unmanaged skills from workspace roots")
    .option("--roots <roots>", "Comma-separated roots to scan recursively")
    .option("--json", "Output discovered skills as JSON")
    .action(async (options: { roots?: string; json?: boolean }) => {
      const result = await discoverSkills({
        roots: parseRoots(options.roots),
      });

      if (!result.ok) {
        process.stderr.write(`Error: ${result.error}\n`);
        process.exit(1);
      }

      if (options.json) {
        process.stdout.write(JSON.stringify(result.value, null, 2) + "\n");
        return;
      }

      process.stdout.write(formatDiscoverTable(result.value) + "\n");
    });
}
