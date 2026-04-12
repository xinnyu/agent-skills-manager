import { readdir, lstat, readFile, cp, rename, rm, unlink, readlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Result, ScannedSkill, ScannedSkillType, AdoptAs, TargetsConfig } from "../types";
import { ok, err } from "../utils/result";
import { managedTomlPath, expandHome, userSkillsDir } from "../utils/paths";
import { readManaged, addManagedEntry } from "./managed";
import { createSymlink, ensureDir } from "../utils/fs";
import { gitSubmoduleAdd, gitExec } from "../utils/git";
import { detectSkillPath, updateRegistryMeta } from "./registry";
import { syncSkills } from "./sync-engine";
import { getPluginManagedSkills } from "../utils/plugins";
import type { PluginSkillsOptions } from "../utils/plugins";

/** Parse SKILL.md frontmatter to extract description. */
export async function readSkillDescription(skillDir: string): Promise<string | undefined> {
  const skillMdPath = join(skillDir, "SKILL.md");
  let content: string;
  try {
    content = await readFile(skillMdPath, "utf-8");
  } catch {
    return undefined;
  }

  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return undefined;

  const frontmatter = match[1];
  const descLine = frontmatter.split("\n").find((l) => l.startsWith("description:"));
  if (!descLine) return undefined;

  return descLine.slice("description:".length).trim();
}

/** Read remote origin URL from a git repo directory. */
async function readGitRemoteUrl(dir: string): Promise<string | undefined> {
  const gitConfigPath = join(dir, ".git", "config");
  let content: string;
  try {
    content = await readFile(gitConfigPath, "utf-8");
  } catch {
    return undefined;
  }

  const match = content.match(/\[remote\s+"origin"\]\s*\n\s*url\s*=\s*(.+)/);
  if (!match) return undefined;

  return match[1].trim();
}

/** Check if a directory is a git repository. */
async function isGitRepo(dir: string): Promise<boolean> {
  try {
    const gitDir = await lstat(join(dir, ".git"));
    return gitDir.isDirectory();
  } catch {
    return false;
  }
}

/** Determine the type of a scanned entry. */
export async function classifyEntry(
  entryPath: string,
  stat: Awaited<ReturnType<typeof lstat>>,
): Promise<{ type: ScannedSkillType; symlinkTarget?: string; remoteUrl?: string }> {
  if (stat.isSymbolicLink()) {
    let symlinkTarget: string | undefined;
    try {
      symlinkTarget = await readlink(entryPath);
    } catch {
      // ignore
    }
    // Check if the resolved target is a git repo
    const realPath = resolve(entryPath);
    const hasGit = await isGitRepo(realPath);
    const remoteUrl = hasGit ? await readGitRemoteUrl(realPath) : undefined;

    return { type: "symlink", symlinkTarget, remoteUrl };
  }

  if (stat.isDirectory()) {
    const hasGit = await isGitRepo(entryPath);
    if (hasGit) {
      const remoteUrl = await readGitRemoteUrl(entryPath);
      return { type: "git-repo", remoteUrl };
    }
    return { type: "directory" };
  }

  return { type: "directory" };
}

/** Internal scan result before merging: skill data + which target found it. */
interface RawScanEntry {
  name: string;
  path: string;
  type: ScannedSkillType;
  symlinkTarget?: string;
  remoteUrl?: string;
  description?: string;
  targetName: string;
}

/** Scan a single target directory for unmanaged skills. */
async function scanSingleTarget(
  targetName: string,
  dir: string,
  managedFile: string,
): Promise<Result<RawScanEntry[]>> {
  // Read managed state to know which skills are already managed
  const managed = await readManaged(managedFile);
  if (!managed.ok) return managed;

  const managedNames = new Set(Object.keys(managed.value.links));

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (e: unknown) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return ok([]);
    }
    return err(`Failed to read directory ${dir}: ${String(e)}`);
  }

  const results: RawScanEntry[] = [];

  for (const name of entries) {
    if (name.startsWith(".")) continue;
    if (managedNames.has(name)) continue;

    const entryPath = join(dir, name);

    let stat: Awaited<ReturnType<typeof lstat>>;
    try {
      stat = await lstat(entryPath);
    } catch {
      continue;
    }

    if (!stat.isDirectory() && !stat.isSymbolicLink()) continue;

    const classification = await classifyEntry(entryPath, stat);
    const resolvedPath = stat.isSymbolicLink() ? resolve(entryPath) : entryPath;
    const description = await readSkillDescription(resolvedPath);

    const entry: RawScanEntry = {
      name,
      path: entryPath,
      type: classification.type,
      targetName,
    };

    if (classification.symlinkTarget !== undefined) {
      entry.symlinkTarget = classification.symlinkTarget;
    }
    if (classification.remoteUrl !== undefined) {
      entry.remoteUrl = classification.remoteUrl;
    }
    if (description !== undefined) {
      entry.description = description;
    }

    results.push(entry);
  }

  return ok(results);
}

/** Merge raw scan entries from multiple targets, deduplicating by name. */
function mergeScannedEntries(entries: RawScanEntry[]): ScannedSkill[] {
  const byName = new Map<string, ScannedSkill>();

  for (const entry of entries) {
    const existing = byName.get(entry.name);
    if (existing) {
      existing.foundIn.push(entry.targetName);
    } else {
      const scanned: ScannedSkill = {
        name: entry.name,
        path: entry.path,
        type: entry.type,
        foundIn: [entry.targetName],
      };
      if (entry.symlinkTarget !== undefined) scanned.symlinkTarget = entry.symlinkTarget;
      if (entry.remoteUrl !== undefined) scanned.remoteUrl = entry.remoteUrl;
      if (entry.description !== undefined) scanned.description = entry.description;
      byName.set(entry.name, scanned);
    }
  }

  return [...byName.values()];
}

export interface ScanOptions {
  /** Single target scan (legacy) */
  skillsDir?: string;
  managedPath?: string;
  /** Multi-target scan */
  targets?: TargetsConfig;
  /** Plugin exclusion options */
  pluginOptions?: PluginSkillsOptions;
  /** Skip plugin exclusion (e.g., for testing) */
  skipPluginExclusion?: boolean;
}

export interface ScanResult {
  skills: ScannedSkill[];
  excludedPluginCount: number;
}

/** Scan target directories for unmanaged skills, excluding plugin-managed skills. */
export async function scanSkills(options?: ScanOptions): Promise<Result<ScanResult>> {
  const allEntries: RawScanEntry[] = [];

  if (options?.targets && Object.keys(options.targets).length > 0) {
    // Multi-target scan
    for (const [targetName, targetPath] of Object.entries(options.targets)) {
      const dir = expandHome(targetPath);
      const mPath = managedTomlPath(dir);
      const result = await scanSingleTarget(targetName, dir, mPath);
      if (!result.ok) return result;
      allEntries.push(...result.value);
    }
  } else {
    // Legacy single target scan
    const dir = options?.skillsDir ?? userSkillsDir();
    const mPath = options?.managedPath ?? managedTomlPath(dir);
    const result = await scanSingleTarget("default", dir, mPath);
    if (!result.ok) return result;
    allEntries.push(...result.value);
  }

  const merged = mergeScannedEntries(allEntries);

  // Plugin exclusion
  if (options?.skipPluginExclusion) {
    return ok({ skills: merged, excludedPluginCount: 0 });
  }

  const pluginSkills = await getPluginManagedSkills(options?.pluginOptions);
  if (!pluginSkills.ok) return pluginSkills;

  const pluginSet = new Set(pluginSkills.value);
  const filtered: ScannedSkill[] = [];
  let excludedCount = 0;

  for (const skill of merged) {
    if (pluginSet.has(skill.name)) {
      excludedCount++;
    } else {
      filtered.push(skill);
    }
  }

  return ok({ skills: filtered, excludedPluginCount: excludedCount });
}

export interface AdoptOptions {
  registryDir: string;
  skillsDir?: string;
  managedPath?: string;
  /** Targets for post-adopt sync */
  targets?: TargetsConfig;
  /** Override sync hash path for testing */
  overrideSyncHashPath?: string;
}

/** Adopt a scanned skill as core: copy/move to registry, then sync all targets. */
export async function adoptAsCore(
  name: string,
  options: AdoptOptions,
): Promise<Result<void>> {
  const dir = options.skillsDir ?? userSkillsDir();
  const managedFile = options.managedPath ?? managedTomlPath(dir);

  // Verify the skill exists and is not already managed
  const managed = await readManaged(managedFile);
  if (!managed.ok) return managed;

  if (name in managed.value.links) {
    return err(`Skill "${name}" is already managed by ASM`);
  }

  const entryPath = join(dir, name);

  let stat: Awaited<ReturnType<typeof lstat>>;
  try {
    stat = await lstat(entryPath);
  } catch {
    return err(`Skill "${name}" not found at ${entryPath}`);
  }

  const coreDir = join(options.registryDir, "core", name);
  const mkDir = await ensureDir(join(options.registryDir, "core"));
  if (!mkDir.ok) return mkDir;

  if (stat.isSymbolicLink()) {
    const resolvedPath = resolve(entryPath);

    try {
      await cp(resolvedPath, coreDir, { recursive: true });
    } catch (e: unknown) {
      return err(`Failed to copy skill contents: ${String(e)}`);
    }

    try {
      await unlink(entryPath);
    } catch (e: unknown) {
      return err(`Failed to remove original symlink: ${String(e)}`);
    }
  } else {
    try {
      await rename(entryPath, coreDir);
    } catch {
      try {
        await cp(entryPath, coreDir, { recursive: true });
        await rm(entryPath, { recursive: true, force: true });
      } catch (copyErr: unknown) {
        return err(`Failed to move skill directory: ${String(copyErr)}`);
      }
    }
  }

  // Create symlink from skills dir to registry
  const link = await createSymlink(coreDir, entryPath);
  if (!link.ok) return link;

  // Update .asm-managed.toml
  const managedResult = await addManagedEntry(managedFile, name, { target: coreDir });
  if (!managedResult.ok) return managedResult;

  // Git commit in registry
  const gitAdd = await gitExec(["add", "."], options.registryDir);
  if (!gitAdd.ok) return gitAdd;

  const gitCommit = await gitExec(
    ["commit", "-m", `feat: adopt ${name} as core skill`],
    options.registryDir,
  );
  if (!gitCommit.ok) return gitCommit;

  // Sync all targets via sync engine
  return runPostAdoptSync(options);
}

/** Adopt a scanned skill as vendor: git submodule add, then sync all targets. */
export async function adoptAsVendor(
  name: string,
  options: AdoptOptions,
): Promise<Result<void>> {
  const dir = options.skillsDir ?? userSkillsDir();
  const managedFile = options.managedPath ?? managedTomlPath(dir);

  // Verify the skill exists and is not already managed
  const managed = await readManaged(managedFile);
  if (!managed.ok) return managed;

  if (name in managed.value.links) {
    return err(`Skill "${name}" is already managed by ASM`);
  }

  const entryPath = join(dir, name);

  let stat: Awaited<ReturnType<typeof lstat>>;
  try {
    stat = await lstat(entryPath);
  } catch {
    return err(`Skill "${name}" not found at ${entryPath}`);
  }

  const classification = await classifyEntry(entryPath, stat);

  if (!classification.remoteUrl) {
    return err(`Skill "${name}" has no remote URL — cannot adopt as vendor`);
  }

  const remoteUrl = classification.remoteUrl;

  // Remove original entry (symlink or directory)
  try {
    if (stat.isSymbolicLink()) {
      await unlink(entryPath);
    } else {
      await rm(entryPath, { recursive: true, force: true });
    }
  } catch (e: unknown) {
    return err(`Failed to remove original skill: ${String(e)}`);
  }

  // git submodule add
  const vendorDir = await ensureDir(join(options.registryDir, "vendor"));
  if (!vendorDir.ok) return vendorDir;

  const submodulePath = join("vendor", name);
  const sub = await gitSubmoduleAdd(remoteUrl, submodulePath, options.registryDir);
  if (!sub.ok) return sub;

  // Detect skill path
  const skillDir = join(options.registryDir, submodulePath);
  const skillPath = await detectSkillPath(skillDir);
  if (!skillPath.ok) return skillPath;

  if (skillPath.value !== ".") {
    const meta = await updateRegistryMeta(skillDir, { skillPath: skillPath.value });
    if (!meta.ok) return meta;
  }

  // Create symlink
  const symlinkSource = skillPath.value !== "."
    ? join(skillDir, skillPath.value)
    : skillDir;

  const link = await createSymlink(symlinkSource, entryPath);
  if (!link.ok) return link;

  // Update .asm-managed.toml
  const managedResult = await addManagedEntry(managedFile, name, { target: symlinkSource });
  if (!managedResult.ok) return managedResult;

  // Git commit in registry
  const gitAdd = await gitExec(["add", "."], options.registryDir);
  if (!gitAdd.ok) return gitAdd;

  const gitCommit = await gitExec(
    ["commit", "-m", `feat: adopt ${name} as vendor skill`],
    options.registryDir,
  );
  if (!gitCommit.ok) return gitCommit;

  // Sync all targets via sync engine
  return runPostAdoptSync(options);
}

/** Run sync engine after adopt to create symlinks in all targets. */
async function runPostAdoptSync(options: AdoptOptions): Promise<Result<void>> {
  if (!options.targets || Object.keys(options.targets).length === 0) {
    return ok(undefined);
  }

  const syncResult = await syncSkills({
    registryDir: options.registryDir,
    targets: options.targets,
    overrideSyncHashPath: options.overrideSyncHashPath,
  });
  if (!syncResult.ok) return syncResult;

  return ok(undefined);
}

/** Adopt a scanned skill, dispatching to the appropriate handler. */
export async function adoptSkill(
  name: string,
  as: AdoptAs,
  options: AdoptOptions,
): Promise<Result<void>> {
  if (as === "core") {
    return adoptAsCore(name, options);
  }
  return adoptAsVendor(name, options);
}
