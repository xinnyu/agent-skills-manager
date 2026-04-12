import type { Command } from "commander";
import * as readline from "node:readline/promises";

import { scanSkills, adoptSkill } from "../core/scan";
import { getRegistryPath } from "../core/registry";
import { readConfig } from "../core/config";
import { expandHome } from "../utils/paths";
import type { AdoptAs, ScannedSkill } from "../types";

function formatTable(skills: ScannedSkill[]): string {
  if (skills.length === 0) return "No unmanaged skills found.";

  const header = `${"NAME".padEnd(24)} ${"TYPE".padEnd(12)} ${"FOUND IN".padEnd(20)} ${"REMOTE URL".padEnd(40)} DESCRIPTION`;
  const separator = "-".repeat(110);
  const rows = skills.map((s) => {
    const name = s.name.padEnd(24);
    const type = s.type.padEnd(12);
    const foundIn = s.foundIn.join(", ").padEnd(20);
    const url = (s.remoteUrl ?? "-").padEnd(40);
    const desc = s.description ?? "-";
    return `${name} ${type} ${foundIn} ${url} ${desc}`;
  });

  return [header, separator, ...rows].join("\n");
}

async function promptAdopt(
  skill: ScannedSkill,
  rl: readline.Interface,
): Promise<AdoptAs | "skip"> {
  const answer = await rl.question(
    `Adopt "${skill.name}" (${skill.type})? [c]ore / [v]endor / [s]kip: `,
  );
  const trimmed = answer.trim().toLowerCase();
  if (trimmed === "c" || trimmed === "core") return "core";
  if (trimmed === "v" || trimmed === "vendor") return "vendor";
  return "skip";
}

function autoAdoptType(skill: ScannedSkill): AdoptAs {
  if (skill.remoteUrl) return "vendor";
  return "core";
}

export function registerScanCommand(program: Command): void {
  program
    .command("scan")
    .description("Scan for unmanaged skills in target directories")
    .option("--adopt", "Interactively adopt each discovered skill")
    .option("--auto", "Auto-determine adoption type (use with --adopt)")
    .option("--dry-run", "Show what would be found without making changes")
    .action(async (options: { adopt?: boolean; auto?: boolean; dryRun?: boolean }) => {
      const config = await readConfig();
      if (!config.ok) {
        process.stderr.write(`Error: ${config.error}\n`);
        process.exit(1);
      }

      const targets = config.value.targets;
      const resolvedTargets: Record<string, string> = {};
      for (const [name, dir] of Object.entries(targets)) {
        resolvedTargets[name] = expandHome(dir);
      }

      const result = await scanSkills({
        targets: resolvedTargets,
      });
      if (!result.ok) {
        process.stderr.write(`Error: ${result.error}\n`);
        process.exit(1);
      }

      const { skills, excludedPluginCount } = result.value;

      if (options.dryRun || !options.adopt) {
        process.stdout.write(formatTable(skills) + "\n");
        if (excludedPluginCount > 0) {
          process.stdout.write(`\nExcluded ${excludedPluginCount} plugin-managed skill(s).\n`);
        }
        if (skills.length > 0 && !options.adopt) {
          process.stdout.write(`\n${skills.length} unmanaged skill(s) found. Use --adopt to adopt them.\n`);
        }
        return;
      }

      if (skills.length === 0) {
        process.stdout.write("No unmanaged skills found.\n");
        if (excludedPluginCount > 0) {
          process.stdout.write(`Excluded ${excludedPluginCount} plugin-managed skill(s).\n`);
        }
        return;
      }

      const regPath = await getRegistryPath();
      if (!regPath.ok) {
        process.stderr.write(`Error: ${regPath.error}\n`);
        process.exit(1);
      }

      const adoptOptions = {
        registryDir: regPath.value,
        targets: resolvedTargets,
      };

      if (options.auto) {
        for (const skill of skills) {
          const as = autoAdoptType(skill);
          const adoptResult = await adoptSkill(skill.name, as, adoptOptions);
          if (!adoptResult.ok) {
            process.stderr.write(`Error adopting "${skill.name}": ${adoptResult.error}\n`);
          } else {
            process.stdout.write(`✓ Adopted "${skill.name}" as ${as}\n`);
          }
        }
      } else {
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        for (const skill of skills) {
          const as = await promptAdopt(skill, rl);
          if (as === "skip") {
            process.stdout.write(`  Skipped "${skill.name}"\n`);
            continue;
          }

          const adoptResult = await adoptSkill(skill.name, as, adoptOptions);
          if (!adoptResult.ok) {
            process.stderr.write(`Error adopting "${skill.name}": ${adoptResult.error}\n`);
          } else {
            process.stdout.write(`✓ Adopted "${skill.name}" as ${as}\n`);
          }
        }

        rl.close();
      }

      if (excludedPluginCount > 0) {
        process.stdout.write(`\nExcluded ${excludedPluginCount} plugin-managed skill(s).\n`);
      }
    });
}
