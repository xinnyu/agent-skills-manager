import { lstat, readdir } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

import type { DiscoverOptions, DiscoveredSkill, Result } from "../types";
import { readManaged } from "./managed";
import { scanRegistry } from "./registry";
import { classifyEntry, readSkillDescription } from "./scan";
import { expandHome, managedTomlPath, readRegistryPath } from "../utils/paths";
import { err, ok } from "../utils/result";

// Command-layer output stays in registerDiscoverCommand via process.stdout.write.
const EXCLUDED_DIRS = new Set(["node_modules", ".git", "Library"]);
const SKILL_DOTDIRS = new Map<string, DiscoveredSkill["kind"]>([
  [".claude", "claude"],
  [".agents", "codex"],
]);

function normalizeRoots(roots?: string[]): string[] {
  if (roots === undefined) {
    return [resolve(expandHome("~/"))];
  }

  return roots.map((root) => resolve(expandHome(root)));
}

function detectSkillDirKind(dir: string): DiscoveredSkill["kind"] | undefined {
  const parts = dir.split(sep).filter(Boolean);
  if (parts.length < 2) return undefined;

  const maybeSkills = parts[parts.length - 1];
  const maybeDotdir = parts[parts.length - 2];

  if (maybeSkills !== "skills") return undefined;
  return SKILL_DOTDIRS.get(maybeDotdir);
}

async function walkForSkillsDirs(
  root: string,
  excluded: Set<string>,
): Promise<Result<string[]>> {
  let rootStat: Awaited<ReturnType<typeof lstat>>;
  try {
    rootStat = await lstat(root);
  } catch (e: unknown) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return ok([]);
    }
    return err(`Failed to read path ${root}: ${String(e)}`);
  }

  if (!rootStat.isDirectory()) {
    return ok([]);
  }

  if (detectSkillDirKind(root)) {
    return ok([root]);
  }

  let entries: string[];
  try {
    entries = await readdir(root);
  } catch (e: unknown) {
    return err(`Failed to read directory ${root}: ${String(e)}`);
  }

  const discovered: string[] = [];

  for (const entry of entries) {
    if (excluded.has(entry)) continue;

    const entryPath = join(root, entry);
    if (excluded.has(entryPath)) continue;

    let entryStat: Awaited<ReturnType<typeof lstat>>;
    try {
      entryStat = await lstat(entryPath);
    } catch {
      continue;
    }

    if (!entryStat.isDirectory()) continue;

    if (SKILL_DOTDIRS.has(entry)) {
      const skillsPath = join(entryPath, "skills");
      try {
        const skillsStat = await lstat(skillsPath);
        if (skillsStat.isDirectory()) {
          discovered.push(skillsPath);
        }
      } catch {
        // Keep walking siblings.
      }
      continue;
    }

    const nested = await walkForSkillsDirs(entryPath, excluded);
    if (!nested.ok) return nested;
    discovered.push(...nested.value);
  }

  return ok(discovered);
}

async function readManagedNames(skillsDir: string): Promise<Result<Set<string>>> {
  const managed = await readManaged(managedTomlPath(skillsDir));
  if (!managed.ok) return managed;

  return ok(new Set(Object.keys(managed.value.links)));
}

async function extractSkillInfo(
  skillsDir: string,
  entryName: string,
  kind: DiscoveredSkill["kind"],
): Promise<Result<DiscoveredSkill | undefined>> {
  const skillPath = join(skillsDir, entryName);

  let stat: Awaited<ReturnType<typeof lstat>>;
  try {
    stat = await lstat(skillPath);
  } catch {
    return ok(undefined);
  }

  if (!stat.isDirectory() && !stat.isSymbolicLink()) {
    return ok(undefined);
  }

  const classification = await classifyEntry(skillPath, stat);
  const description = await readSkillDescription(skillPath);

  return ok({
    name: entryName,
    path: skillPath,
    kind,
    type: classification.type,
    description,
  });
}

async function discoverInSkillsDir(skillsDir: string): Promise<Result<DiscoveredSkill[]>> {
  const kind = detectSkillDirKind(skillsDir);
  if (!kind) {
    return ok([]);
  }

  const managedNames = await readManagedNames(skillsDir);
  if (!managedNames.ok) return managedNames;

  let entries: string[];
  try {
    entries = await readdir(skillsDir);
  } catch (e: unknown) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return ok([]);
    }
    return err(`Failed to read directory ${skillsDir}: ${String(e)}`);
  }

  const discovered: DiscoveredSkill[] = [];

  for (const entryName of entries) {
    if (entryName === ".asm-managed.toml") continue;
    if (managedNames.value.has(entryName)) continue;

    const skill = await extractSkillInfo(skillsDir, entryName, kind);
    if (!skill.ok) return skill;
    if (skill.value) {
      discovered.push(skill.value);
    }
  }

  return ok(discovered);
}

function sortDiscoveredSkills(skills: DiscoveredSkill[]): DiscoveredSkill[] {
  return [...skills].sort((left, right) => {
    const nameOrder = left.name.localeCompare(right.name);
    if (nameOrder !== 0) return nameOrder;

    const kindOrder = left.kind.localeCompare(right.kind);
    if (kindOrder !== 0) return kindOrder;

    return left.path.localeCompare(right.path);
  });
}

export async function discoverSkills(
  options?: DiscoverOptions,
): Promise<Result<DiscoveredSkill[]>> {
  const roots = normalizeRoots(options?.roots);

  // Exclude the ASM registry directory from scanning
  const excluded = new Set(EXCLUDED_DIRS);
  const registryPath = await readRegistryPath();
  if (registryPath.ok) {
    const resolved = resolve(registryPath.value);
    excluded.add(resolved);
  }

  // Get registry skill names to exclude managed skills
  const registryNames = new Set<string>();
  if (registryPath.ok) {
    const regSkills = await scanRegistry(registryPath.value);
    if (regSkills.ok) {
      for (const s of regSkills.value) registryNames.add(s.name);
    }
  }

  const skillsDirs: string[] = [];

  for (const root of roots) {
    const walked = await walkForSkillsDirs(root, excluded);
    if (!walked.ok) return walked;
    skillsDirs.push(...walked.value);
  }

  const uniqueSkillsDirs = [...new Set(skillsDirs)];
  const discovered: DiscoveredSkill[] = [];

  for (const skillsDir of uniqueSkillsDirs) {
    const found = await discoverInSkillsDir(skillsDir);
    if (!found.ok) return found;
    discovered.push(...found.value);
  }

  // Filter out skills that exist in the registry
  const filtered = discovered.filter((s) => !registryNames.has(s.name));

  return ok(sortDiscoveredSkills(filtered));
}
