import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { Result, RegistrySkill, SyncPlan, TargetsConfig, ProjectManifest } from "../types";
import { ok, err } from "../utils/result";
import { readManaged, writeManaged } from "./managed";
import { findManifest, readManifest, checkManifestRequirements } from "./manifest";
import { scanRegistry } from "./registry";
import { readConfig } from "./config";
import { createSymlink, removeSymlink, readSymlinkTarget, ensureDir } from "../utils/fs";
import {
  managedTomlPath,
  syncHashPathInRegistry,
  expandHome,
  userManifestPath,
  projectSkillsTargets,
} from "../utils/paths";

function computeHash(skills: RegistrySkill[], targets: TargetsConfig): string {
  const hash = createHash("sha256");
  const sortedSkills = [...skills].sort((a, b) => a.name.localeCompare(b.name));
  for (const skill of sortedSkills) {
    hash.update(`skill:${skill.name}\0${skill.sourcePath}\n`);
  }
  const sortedTargets = Object.entries(targets).sort(([a], [b]) => a.localeCompare(b));
  for (const [name, dir] of sortedTargets) {
    hash.update(`target:${name}\0${dir}\n`);
  }
  return hash.digest("hex");
}

async function readSavedHash(path: string): Promise<string | null> {
  try {
    const content = await readFile(path, "utf-8");
    return content.trim();
  } catch {
    return null;
  }
}

async function writeSavedHash(path: string, hash: string): Promise<Result<void>> {
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, hash, "utf-8");
  } catch (e: unknown) {
    return err(`Failed to write sync hash: ${String(e)}`);
  }
  return ok(undefined);
}

/** Build a sync plan for a single target directory. */
function buildTargetPlan(skills: RegistrySkill[], targetDir: string): SyncPlan {
  const plan: SyncPlan = { links: {} };
  for (const skill of skills) {
    plan.links[skill.name] = {
      source: skill.sourcePath,
      target: join(targetDir, skill.name),
    };
  }
  return plan;
}

/** Verify managed symlinks exist and point correctly. Returns false if any mismatch found. */
async function verifyManagedLinks(
  plan: SyncPlan,
  mPath: string,
): Promise<boolean> {
  const managed = await readManaged(mPath);
  if (!managed.ok) return false;

  for (const [name, expected] of Object.entries(plan.links)) {
    const managedEntry = managed.value.links[name];
    if (!managedEntry || managedEntry.target !== expected.source) {
      return false;
    }

    const actual = await readSymlinkTarget(expected.target);
    if (!actual.ok || actual.value !== expected.source) {
      return false;
    }
  }

  // Check no stale managed entries
  for (const name of Object.keys(managed.value.links)) {
    if (!(name in plan.links)) {
      return false;
    }
  }

  return true;
}

/** Full reconciliation: create/update/remove symlinks to match plan. */
async function reconcile(
  plan: SyncPlan,
  mPath: string,
  targetDir: string,
): Promise<Result<void>> {
  const managed = await readManaged(mPath);
  if (!managed.ok) return managed;

  // Remove stale managed symlinks
  for (const name of Object.keys(managed.value.links)) {
    if (name in plan.links) continue;

    const symlinkPath = join(targetDir, name);
    const rm = await removeSymlink(symlinkPath);
    if (!rm.ok) return rm;
  }

  // Ensure target directory exists
  const mkd = await ensureDir(targetDir);
  if (!mkd.ok) return mkd;

  // Create or fix symlinks
  const newManaged = { links: {} as Record<string, { target: string }> };
  for (const [name, expected] of Object.entries(plan.links)) {
    const existing = await readSymlinkTarget(expected.target);

    if (existing.ok && existing.value === expected.source) {
      // Already correct
      newManaged.links[name] = { target: expected.source };
      continue;
    }

    // Create/fix symlink
    const link = await createSymlink(expected.source, expected.target);
    if (!link.ok) return link;

    newManaged.links[name] = { target: expected.source };
  }

  return writeManaged(mPath, newManaged);
}

/** Filter registry skills by manifest declarations (skills + vendors). */
function filterByManifest(allSkills: RegistrySkill[], manifest: ProjectManifest): RegistrySkill[] {
  const declaredNames = new Set(manifest.skills);
  const declaredVendors = new Set(manifest.vendors);
  return allSkills.filter(
    (s) => declaredNames.has(s.name) || (s.vendorRepo && declaredVendors.has(s.vendorRepo)),
  );
}

async function isGlobalTargetPath(
  candidateDir: string,
  globalTargetDirs: string[],
): Promise<boolean> {
  try {
    const realCandidate = await realpath(candidateDir);
    for (const targetDir of globalTargetDirs) {
      try {
        const realTarget = await realpath(targetDir);
        if (realCandidate === realTarget) {
          return true;
        }
      } catch { /* target doesn't exist yet */ }
    }
  } catch { /* candidateDir doesn't exist */ }

  return false;
}

async function findNearestManagedProjectRoot(startDir: string): Promise<string | null> {
  let current = startDir;

  while (true) {
    for (const target of projectSkillsTargets(current)) {
      const managed = await readManaged(managedTomlPath(target.targetDir));
      if (managed.ok && Object.keys(managed.value.links).length > 0) {
        return current;
      }
    }

    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function buildProjectTargetPlans(
  projectDir: string,
  projectSkills: RegistrySkill[],
  userSkillNames: Set<string>,
  globalTargets: Record<string, string>,
): Array<{ targetDir: string; plan: SyncPlan }> {
  const resolvedGlobalTargets = new Set(Object.values(globalTargets));

  return projectSkillsTargets(projectDir).map((target) => {
    const skillsForTarget = resolvedGlobalTargets.has(target.globalDir)
      ? projectSkills.filter((skill) => !userSkillNames.has(skill.name))
      : projectSkills;

    return {
      targetDir: target.targetDir,
      plan: buildTargetPlan(skillsForTarget, target.targetDir),
    };
  });
}

export interface SyncOptions {
  registryDir: string;
  targets?: TargetsConfig;
  configPath?: string;
  cwd?: string;
  overrideSyncHashPath?: string;
}

/** Run the sync engine: scan registry, compute plan per target, reconcile if needed. */
export async function syncSkills(options: SyncOptions): Promise<Result<{ skipped: boolean }>> {
  // 1. Resolve targets
  let targets = options.targets;
  if (!targets) {
    const config = await readConfig(options.configPath);
    if (!config.ok) return config;
    targets = config.value.targets;
  }

  if (Object.keys(targets).length === 0) {
    return ok({ skipped: true });
  }

  // Resolve ~ in target paths
  const resolvedTargets: Record<string, string> = {};
  for (const [name, dir] of Object.entries(targets)) {
    resolvedTargets[name] = expandHome(dir);
  }

  // 2. Scan registry for all skills
  const skills = await scanRegistry(options.registryDir);
  if (!skills.ok) return skills;

  // 3. Read user-level manifest (~/.asm/skills.toml) to filter global targets
  const userManifest = await readManifest(userManifestPath());
  let userSkills: RegistrySkill[];
  if (userManifest.ok && (userManifest.value.skills.length > 0 || userManifest.value.vendors.length > 0)) {
    // Validate user manifest requirements
    const { missing, missingVendors } = checkManifestRequirements(userManifest.value, skills.value);
    const errors: string[] = [];
    if (missing.length > 0) {
      errors.push(`User manifest: required skills not installed: ${missing.join(", ")}`);
    }
    if (missingVendors.length > 0) {
      errors.push(`User manifest: required vendor packages not installed: ${missingVendors.join(", ")}`);
    }
    if (errors.length > 0) {
      return err(`${errors.join(". ")}. Run "asm add" to install them.`);
    }
    userSkills = filterByManifest(skills.value, userManifest.value);
  } else {
    // No user manifest → sync all skills to global targets (backward compat)
    userSkills = skills.value;
  }

  // 4. Read project-level manifest if cwd provided
  let projectSkills: RegistrySkill[] | null = null;
  let projectDir: string | null = null;
  const userSkillNames = new Set(userSkills.map((s) => s.name));

  if (options.cwd) {
    const manifestPath = await findManifest(options.cwd);
    if (!manifestPath.ok) return manifestPath;

    if (manifestPath.value) {
      // Check it's not the user manifest itself
      const resolvedUserManifest = userManifestPath();
      if (manifestPath.value !== resolvedUserManifest) {
        const manifest = await readManifest(manifestPath.value);
        if (!manifest.ok) return manifest;

        const { missing, missingVendors } = checkManifestRequirements(manifest.value, skills.value);
        const errors: string[] = [];
        if (missing.length > 0) {
          errors.push(`Required skills not installed: ${missing.join(", ")}`);
        }
        if (missingVendors.length > 0) {
          errors.push(`Required vendor packages not installed: ${missingVendors.join(", ")}`);
        }
        if (errors.length > 0) {
          return err(`${errors.join(". ")}. Run "asm add" to install them.`);
        }

        projectDir = dirname(dirname(manifestPath.value));
        projectSkills = filterByManifest(skills.value, manifest.value);
      }
    } else {
      // No manifest found — check if there are stale project-level managed symlinks to clean up
      const managedProjectRoot = await findNearestManagedProjectRoot(options.cwd);
      if (managedProjectRoot) {
        for (const target of projectSkillsTargets(managedProjectRoot)) {
          const isGlobalTarget = await isGlobalTargetPath(target.targetDir, Object.values(resolvedTargets));
          if (isGlobalTarget) {
            continue;
          }

          const projMPath = managedTomlPath(target.targetDir);
          const existingManaged = await readManaged(projMPath);
          if (existingManaged.ok && Object.keys(existingManaged.value.links).length > 0) {
            projectDir = managedProjectRoot;
            projectSkills = [];
            break;
          }
        }
      }
    }
  }

  // 5. Hash check for fast path
  const hashPath = options.overrideSyncHashPath ?? syncHashPathInRegistry(options.registryDir);
  const currentHash = computeHash(skills.value, resolvedTargets);
  const savedHash = await readSavedHash(hashPath);

  if (currentHash === savedHash) {
    let allValid = true;
    for (const targetDir of Object.values(resolvedTargets)) {
      const plan = buildTargetPlan(userSkills, targetDir);
      const mPath = managedTomlPath(targetDir);
      const valid = await verifyManagedLinks(plan, mPath);
      if (!valid) {
        allValid = false;
        break;
      }
    }
    if (allValid && projectSkills && projectDir) {
      for (const projectTarget of buildProjectTargetPlans(
        projectDir,
        projectSkills,
        userSkillNames,
        resolvedTargets,
      )) {
        const projMPath = managedTomlPath(projectTarget.targetDir);
        allValid = await verifyManagedLinks(projectTarget.plan, projMPath);
        if (!allValid) {
          break;
        }
      }
    }
    if (allValid) {
      return ok({ skipped: true });
    }
  }

  // 6. Reconcile global targets with user-level skills
  for (const targetDir of Object.values(resolvedTargets)) {
    const plan = buildTargetPlan(userSkills, targetDir);
    const mPath = managedTomlPath(targetDir);
    const result = await reconcile(plan, mPath, targetDir);
    if (!result.ok) return result;
  }

  // 7. Reconcile project-level (only skills not already in global)
  if (projectSkills && projectDir) {
    for (const projectTarget of buildProjectTargetPlans(
      projectDir,
      projectSkills,
      userSkillNames,
      resolvedTargets,
    )) {
      const projMPath = managedTomlPath(projectTarget.targetDir);
      const projResult = await reconcile(projectTarget.plan, projMPath, projectTarget.targetDir);
      if (!projResult.ok) return projResult;
    }
  }

  // 8. Write hash
  const hashWrite = await writeSavedHash(hashPath, currentHash);
  if (!hashWrite.ok) return hashWrite;

  return ok({ skipped: false });
}
