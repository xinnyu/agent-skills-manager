import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

import type { Result } from "../types";
import { ok, err } from "./result";

const INSTALLED_PLUGINS_PATH = join(homedir(), ".claude", "plugins", "installed_plugins.json");
const SKILL_LOCK_PATH = join(homedir(), ".agents", ".skill-lock.json");

/** Read and parse a JSON file, returning ok([]) on ENOENT. */
async function readJsonFile(filePath: string): Promise<Result<unknown>> {
  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch (e: unknown) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return ok(null);
    }
    return err(`Failed to read ${filePath}: ${String(e)}`);
  }

  try {
    return ok(JSON.parse(content));
  } catch {
    return err(`Invalid JSON in ${filePath}`);
  }
}

/**
 * Extract skill names from installed_plugins.json.
 * Format: { version: N, plugins: { "name@marketplace": [...] } }
 * Also supports legacy format: string[]
 */
function extractInstalledPlugins(data: unknown): Result<string[]> {
  if (data === null) return ok([]);

  // Legacy: simple string array
  if (Array.isArray(data)) {
    const names: string[] = [];
    for (const item of data) {
      if (typeof item === "string") {
        const trimmed = item.trim();
        if (trimmed) names.push(trimmed);
      } else if (typeof item === "object" && item !== null && "name" in item) {
        const name = (item as Record<string, unknown>).name;
        if (typeof name === "string" && name.trim()) {
          names.push(name.trim());
        }
      }
    }
    return ok(names);
  }

  // Current format: { version, plugins: { "name@marketplace": [...] } }
  if (typeof data === "object" && data !== null && "plugins" in data) {
    const plugins = (data as Record<string, unknown>).plugins;
    if (typeof plugins !== "object" || plugins === null || Array.isArray(plugins)) {
      return err("installed_plugins.json: plugins must be an object");
    }

    const names: string[] = [];
    for (const key of Object.keys(plugins as Record<string, unknown>)) {
      // Key format: "skill-name@marketplace" — extract the skill name part
      const atIndex = key.indexOf("@");
      const name = atIndex >= 0 ? key.substring(0, atIndex) : key;
      const trimmed = name.trim();
      if (trimmed) names.push(trimmed);
    }
    return ok(names);
  }

  return err("installed_plugins.json: expected an array or object with plugins field");
}

/**
 * Extract skill names from .skill-lock.json.
 * Format: { version: N, skills: { "skill-name": { ... } } }
 * Also supports legacy format: string[]
 */
function extractSkillLock(data: unknown): Result<string[]> {
  if (data === null) return ok([]);

  // Legacy: simple string array
  if (Array.isArray(data)) {
    const names: string[] = [];
    for (const item of data) {
      if (typeof item === "string") {
        const trimmed = item.trim();
        if (trimmed) names.push(trimmed);
      } else if (typeof item === "object" && item !== null && "name" in item) {
        const name = (item as Record<string, unknown>).name;
        if (typeof name === "string" && name.trim()) {
          names.push(name.trim());
        }
      }
    }
    return ok(names);
  }

  // Current format: { version, skills: { "name": { ... } } }
  if (typeof data === "object" && data !== null && "skills" in data) {
    const skills = (data as Record<string, unknown>).skills;
    if (typeof skills !== "object" || skills === null || Array.isArray(skills)) {
      return err(".skill-lock.json: skills must be an object");
    }

    const names: string[] = [];
    for (const key of Object.keys(skills as Record<string, unknown>)) {
      const trimmed = key.trim();
      if (trimmed) names.push(trimmed);
    }
    return ok(names);
  }

  return err(".skill-lock.json: expected an array or object with skills field");
}

export interface PluginSkillsOptions {
  installedPluginsPath?: string;
  skillLockPath?: string;
}

/**
 * Get deduplicated list of skill names managed by external plugins.
 * Reads from installed_plugins.json and .skill-lock.json.
 * Returns empty array (not error) when files don't exist.
 */
export async function getPluginManagedSkills(
  options?: PluginSkillsOptions,
): Promise<Result<string[]>> {
  const pluginsPath = options?.installedPluginsPath ?? INSTALLED_PLUGINS_PATH;
  const lockPath = options?.skillLockPath ?? SKILL_LOCK_PATH;

  const pluginsData = await readJsonFile(pluginsPath);
  if (!pluginsData.ok) return pluginsData;

  const pluginsResult = extractInstalledPlugins(pluginsData.value);
  if (!pluginsResult.ok) return pluginsResult;

  const lockData = await readJsonFile(lockPath);
  if (!lockData.ok) return lockData;

  const lockResult = extractSkillLock(lockData.value);
  if (!lockResult.ok) return lockResult;

  const unique = [...new Set([...pluginsResult.value, ...lockResult.value])];
  return ok(unique);
}
