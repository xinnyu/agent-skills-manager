import { join } from "node:path";
import { rm, stat } from "node:fs/promises";

import type { Result, TargetsConfig } from "../types";
import { ok, err } from "../utils/result";
import { ensureDir } from "../utils/fs";
import { syncSkills } from "./sync-engine";

const SKILL_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

function validateSkillName(name: string): Result<void> {
  if (!SKILL_NAME_PATTERN.test(name)) {
    return err(
      `Invalid skill name "${name}": must start with a lowercase letter and contain only lowercase letters, digits, and hyphens`,
    );
  }
  return ok(undefined);
}

/** Check if a skill directory already exists in the registry. */
async function skillExistsInRegistry(registryDir: string, name: string): Promise<boolean> {
  const corePath = join(registryDir, "core", name);
  const vendorPath = join(registryDir, "vendor", name);

  for (const p of [corePath, vendorPath]) {
    try {
      const s = await stat(p);
      if (s.isDirectory()) return true;
    } catch {
      // doesn't exist
    }
  }
  return false;
}

export interface AddRemoveOptions {
  configPath?: string;
  targets?: TargetsConfig;
}

/** Create a new core skill with a SKILL.md scaffold, then sync to all targets. */
export async function addCoreSkill(
  name: string,
  registryDir: string,
  options?: AddRemoveOptions,
): Promise<Result<void>> {
  const nameValid = validateSkillName(name);
  if (!nameValid.ok) return nameValid;

  // Check if already exists in registry
  const exists = await skillExistsInRegistry(registryDir, name);
  if (exists) {
    return err(`Skill "${name}" already exists`);
  }

  const skillDir = join(registryDir, "core", name);
  const dir = await ensureDir(skillDir);
  if (!dir.ok) return dir;

  const skillMdPath = join(skillDir, "SKILL.md");
  const skillMdContent = `---
name: ${name}
description: TODO - add description
---

TODO - add skill content
`;

  try {
    await Bun.write(skillMdPath, skillMdContent);
  } catch (e: unknown) {
    return err(`Failed to write SKILL.md: ${String(e)}`);
  }

  // Sync to all targets
  const sync = await syncSkills({
    registryDir,
    targets: options?.targets,
    configPath: options?.configPath,
  });
  if (!sync.ok) return sync;

  return ok(undefined);
}

/** Remove a core skill directory and sync to clean up symlinks. */
export async function removeCoreSkill(
  name: string,
  registryDir: string,
  options?: AddRemoveOptions,
): Promise<Result<void>> {
  const skillDir = join(registryDir, "core", name);

  try {
    await rm(skillDir, { recursive: true, force: true });
  } catch (e: unknown) {
    return err(`Failed to remove skill directory: ${String(e)}`);
  }

  // Sync to clean up symlinks from all targets
  const sync = await syncSkills({
    registryDir,
    targets: options?.targets,
    configPath: options?.configPath,
  });
  if (!sync.ok) return sync;

  return ok(undefined);
}
