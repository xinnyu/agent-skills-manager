import { readdir, stat as fsStat, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Result, RegistryMeta, RegistrySkill } from "../types";
import { ok, err } from "../utils/result";
import { ensureDir } from "../utils/fs";
import { readToml, writeToml } from "../utils/toml";
import { gitExec } from "../utils/git";
import { readRegistryPath, writeRegistryPath } from "../utils/paths";
import { writeDefaultAsmToml } from "./config";

const EXCLUDED_DIRS = new Set(["examples", "test", "tests", "node_modules"]);

const GITIGNORE_TEMPLATE = `.cache/
.sync-hash
`;

function isHiddenDir(name: string): boolean {
  return name.startsWith(".");
}

/** Initialize a new registry directory or associate an existing one. */
export async function initRegistry(registryDir: string): Promise<Result<void>> {
  const dir = await ensureDir(registryDir);
  if (!dir.ok) return dir;

  const coreDir = await ensureDir(join(registryDir, "core"));
  if (!coreDir.ok) return coreDir;

  const vendorDir = await ensureDir(join(registryDir, "vendor"));
  if (!vendorDir.ok) return vendorDir;

  // Initialize git repo if not already one
  const checkGit = await gitExec(["rev-parse", "--is-inside-work-tree"], registryDir);
  if (!checkGit.ok) {
    const initGit = await gitExec(["init"], registryDir);
    if (!initGit.ok) return initGit;
  }

  // Write .gitignore with cache and sync-hash exclusions
  const gitignorePath = join(registryDir, ".gitignore");
  try {
    await writeFile(gitignorePath, GITIGNORE_TEMPLATE, "utf-8");
  } catch (e: unknown) {
    return err(`Failed to write .gitignore: ${String(e)}`);
  }

  // Write ~/.asmrc with registry absolute path
  const rcWrite = await writeRegistryPath(registryDir);
  if (!rcWrite.ok) return rcWrite;

  // Ensure asm.toml has default [config] and [targets]
  const asmTomlWrite = await writeDefaultAsmToml(registryDir);
  if (!asmTomlWrite.ok) return asmTomlWrite;

  return ok(undefined);
}

/**
 * Detect the path to SKILL.md within a skill directory.
 * Scans root and one-level subdirectories, excluding certain dirs.
 * Returns relative path from skill root ("." if at root).
 */
export async function detectSkillPath(skillDir: string): Promise<Result<string>> {
  // Check root directory first
  const rootSkillMd = Bun.file(join(skillDir, "SKILL.md"));
  if (await rootSkillMd.exists()) {
    return ok(".");
  }

  // Scan one-level subdirectories
  let entries: string[];
  try {
    entries = await readdir(skillDir);
  } catch (e: unknown) {
    return err(`Failed to read directory ${skillDir}: ${String(e)}`);
  }

  for (const name of entries) {
    if (EXCLUDED_DIRS.has(name)) continue;
    if (isHiddenDir(name)) continue;

    const subPath = join(skillDir, name);
    try {
      const s = await fsStat(subPath);
      if (!s.isDirectory()) continue;
    } catch {
      continue;
    }

    const subSkillMd = Bun.file(join(subPath, "SKILL.md"));
    if (await subSkillMd.exists()) {
      return ok(name);
    }
  }

  return err(`No SKILL.md found in ${skillDir}`);
}

/** Read registry metadata (asm.toml) for a skill. */
export async function readRegistryMeta(
  skillDir: string,
): Promise<Result<RegistryMeta>> {
  const metaPath = join(skillDir, "asm.toml");
  const raw = await readToml(metaPath);

  if (!raw.ok) {
    if (raw.error.includes("File not found")) {
      return ok({});
    }
    return raw;
  }

  const meta: RegistryMeta = {};
  if ("skill_path" in raw.value) {
    if (typeof raw.value.skill_path !== "string") {
      return err(`Invalid skill_path in ${metaPath}: expected string`);
    }
    meta.skillPath = raw.value.skill_path;
  }

  return ok(meta);
}

/** Update registry metadata (asm.toml) for a skill. */
export async function updateRegistryMeta(
  skillDir: string,
  updates: Partial<RegistryMeta>,
): Promise<Result<void>> {
  const metaPath = join(skillDir, "asm.toml");
  const existing = await readRegistryMeta(skillDir);
  if (!existing.ok) return existing;

  const merged = { ...existing.value, ...updates };
  const tomlData: Record<string, unknown> = {};
  if (merged.skillPath) {
    tomlData.skill_path = merged.skillPath;
  }

  return writeToml(metaPath, tomlData);
}

/** Resolve the registry path from ~/.asmrc. */
export async function getRegistryPath(): Promise<Result<string>> {
  return readRegistryPath();
}

/** Read SKILL.md frontmatter to extract description. */
async function readSkillDescription(skillDir: string): Promise<string | undefined> {
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

/** Scan a single type directory (core/ or vendor/) for skills. */
async function scanTypeDir(
  dir: string,
  type: "core" | "vendor",
): Promise<Result<RegistrySkill[]>> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return ok([]);
    }
    return err(`Failed to read directory ${dir}: ${String(e)}`);
  }

  const skills: RegistrySkill[] = [];
  for (const name of entries) {
    if (name.startsWith(".")) continue;

    const entryPath = join(dir, name);
    try {
      const s = await fsStat(entryPath);
      if (!s.isDirectory()) continue;
    } catch {
      continue;
    }

    if (type === "core") {
      // Core: each directory is one skill
      const description = await readSkillDescription(entryPath);
      skills.push({ name, type, sourcePath: entryPath, description });
    } else {
      // Vendor: a repo may contain multiple skills — find all SKILL.md files
      const found = await findSkillsInVendorRepo(entryPath);
      for (const skill of found) {
        skills.push({ ...skill, type: "vendor", vendorRepo: name });
      }
    }
  }

  return ok(skills);
}

const VENDOR_SCAN_EXCLUDED = new Set(["node_modules", "test", "tests", "examples", ".git", ".github"]);
const VENDOR_SCAN_MAX_DEPTH = 4;

/** Well-known skill directories inside dotfiles — these are scanned even though they start with "." */
const DOTDIR_SKILL_PATHS = [
  [".claude", "skills"],
  [".agents", "skills"],
];

/**
 * Read a vendor repo's own curated skill allowlist, if it ships one via the
 * Claude Code plugin marketplace convention (.claude-plugin/plugin.json,
 * "skills": [relative paths]). Returns null when the file is absent or
 * doesn't declare a skills array, so callers fall back to a full scan.
 */
async function readVendorPluginAllowlist(repoDir: string): Promise<string[] | null> {
  const manifestPath = join(repoDir, ".claude-plugin", "plugin.json");
  let content: string;
  try {
    content = await readFile(manifestPath, "utf-8");
  } catch {
    return null;
  }

  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    return null;
  }

  if (typeof data !== "object" || data === null || !("skills" in data)) return null;
  const skillsRaw = (data as Record<string, unknown>).skills;
  if (!Array.isArray(skillsRaw)) return null;

  return skillsRaw.filter((s): s is string => typeof s === "string");
}

/**
 * Find all skills within a vendor repo. If the repo declares its own
 * allowlist (see readVendorPluginAllowlist), only those paths are used —
 * this lets a repo exclude deprecated/in-progress skills from its own
 * subtree without per-vendor config on the ASM side. Otherwise, recursively
 * find all directories containing SKILL.md; each SKILL.md's parent
 * directory name becomes the skill name.
 */
async function findSkillsInVendorRepo(
  repoDir: string,
): Promise<Array<{ name: string; sourcePath: string; description?: string }>> {
  const allowlist = await readVendorPluginAllowlist(repoDir);
  if (allowlist) {
    const allowlisted: Array<{ name: string; sourcePath: string; description?: string }> = [];
    for (const relPath of allowlist) {
      const skillDir = join(repoDir, relPath);
      const skillMdFile = Bun.file(join(skillDir, "SKILL.md"));
      if (!(await skillMdFile.exists())) continue;

      const name = skillDir.split("/").pop()!;
      const description = await readSkillDescription(skillDir);
      allowlisted.push({ name, sourcePath: skillDir, description });
    }
    return allowlisted;
  }

  const results: Array<{ name: string; sourcePath: string; description?: string }> = [];
  const seenNames = new Set<string>();

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > VENDOR_SCAN_MAX_DEPTH) return;

    // Check if this directory has a SKILL.md
    const skillMdFile = Bun.file(join(dir, "SKILL.md"));
    if (await skillMdFile.exists()) {
      const dirName = dir.split("/").pop()!;
      if (!seenNames.has(dirName)) {
        seenNames.add(dirName);
        const description = await readSkillDescription(dir);
        results.push({ name: dirName, sourcePath: dir, description });
      }
      return; // Don't recurse deeper once we find a SKILL.md
    }

    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (VENDOR_SCAN_EXCLUDED.has(entry)) continue;

      if (entry.startsWith(".")) {
        // Check well-known dotdir skill paths (e.g. .claude/skills, .agents/skills)
        for (const [dotdir, skillsDir] of DOTDIR_SKILL_PATHS) {
          if (entry === dotdir) {
            const wellKnownPath = join(dir, dotdir, skillsDir);
            try {
              const s = await fsStat(wellKnownPath);
              if (s.isDirectory()) {
                await walk(wellKnownPath, depth + 2);
              }
            } catch {
              // doesn't exist, skip
            }
          }
        }
        continue;
      }

      const entryPath = join(dir, entry);
      try {
        const s = await fsStat(entryPath);
        if (!s.isDirectory()) continue;
      } catch {
        continue;
      }

      await walk(entryPath, depth + 1);
    }
  }

  await walk(repoDir, 0);
  return results;
}

export interface SkillLocation {
  type: "core" | "vendor";
  /** For vendor skills, the repo directory name in vendor/ */
  vendorRepo?: string;
}

/** Determine skill type and location by checking registry directories. */
export async function detectSkillType(
  registryDir: string,
  name: string,
): Promise<Result<SkillLocation | null>> {
  const corePath = join(registryDir, "core", name);
  try {
    const s = await fsStat(corePath);
    if (s.isDirectory()) return ok({ type: "core" });
  } catch {
    // not in core
  }

  // Vendor: skill may be nested inside a repo, scan all vendor repos
  const vendorDir = join(registryDir, "vendor");
  let repos: string[];
  try {
    repos = await readdir(vendorDir);
  } catch {
    return ok(null);
  }

  for (const repo of repos) {
    if (repo.startsWith(".")) continue;
    const repoPath = join(vendorDir, repo);
    const found = await findSkillsInVendorRepo(repoPath);
    if (found.some((s) => s.name === name)) {
      return ok({ type: "vendor", vendorRepo: repo });
    }
  }

  return ok(null);
}

/** Scan registry core/ and vendor/ directories to produce a list of available skills. */
export async function scanRegistry(registryDir: string): Promise<Result<RegistrySkill[]>> {
  const coreSkills = await scanTypeDir(join(registryDir, "core"), "core");
  if (!coreSkills.ok) return coreSkills;

  const vendorSkills = await scanTypeDir(join(registryDir, "vendor"), "vendor");
  if (!vendorSkills.ok) return vendorSkills;

  // Deduplicate by name — core takes priority over vendor, first vendor wins among vendors
  const seen = new Set<string>();
  const skills: RegistrySkill[] = [];
  for (const skill of [...coreSkills.value, ...vendorSkills.value]) {
    if (seen.has(skill.name)) continue;
    seen.add(skill.name);
    skills.push(skill);
  }

  return ok(skills);
}
