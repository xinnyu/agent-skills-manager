import { stat } from "node:fs/promises";
import { join } from "node:path";

import type { RegistrySkill, Result, UpgradeInfo } from "../types";
import { ok, err } from "../utils/result";
import { gitExec } from "../utils/git";
import { registryPath } from "../utils/paths";
import { readConfig } from "./config";
import { scanRegistry } from "./registry";
import { syncSkills } from "./sync-engine";

/**
 * Whether `dir` is something git can operate in. Follows symlinks, so local
 * path vendors pointing at a real clone still count.
 */
async function isGitRepo(dir: string): Promise<boolean> {
  try {
    const s = await stat(join(dir, ".git"));
    return s.isDirectory() || s.isFile(); // .git is a file in submodules
  } catch {
    return false;
  }
}

/** Detect the default remote branch (e.g., main, master) for a submodule. */
async function detectDefaultBranch(cwd: string): Promise<Result<string>> {
  const result = await gitExec(["remote", "show", "origin"], cwd);
  if (!result.ok) return result;

  const match = result.value.match(/HEAD branch:\s*(\S+)/);
  if (!match) {
    return err("Could not detect default branch from remote");
  }

  return ok(match[1]);
}

/** Get the local HEAD ref for a submodule. */
async function getLocalRef(cwd: string): Promise<Result<string>> {
  return gitExec(["rev-parse", "HEAD"], cwd);
}

/** Get the remote HEAD ref for a submodule after fetching. */
async function getRemoteRef(cwd: string, branch: string): Promise<Result<string>> {
  return gitExec(["rev-parse", `origin/${branch}`], cwd);
}

/** Generate a short summary of changes between two refs. */
async function diffSummary(cwd: string, fromRef: string, toRef: string): Promise<Result<string>> {
  const result = await gitExec(["log", "--oneline", `${fromRef}..${toRef}`], cwd);
  if (!result.ok) return result;

  if (result.value === "") {
    return ok("No changes");
  }

  return ok(result.value);
}

/** Check a single vendor skill for available upgrades. */
async function checkSkillUpgrade(
  name: string,
  skillDir: string,
): Promise<Result<UpgradeInfo | null>> {
  const fetchResult = await gitExec(["fetch", "origin"], skillDir);
  if (!fetchResult.ok) return fetchResult;

  const branch = await detectDefaultBranch(skillDir);
  if (!branch.ok) return branch;

  const localRef = await getLocalRef(skillDir);
  if (!localRef.ok) return localRef;

  const remoteRef = await getRemoteRef(skillDir, branch.value);
  if (!remoteRef.ok) return remoteRef;

  if (localRef.value === remoteRef.value) {
    return ok(null);
  }

  const summary = await diffSummary(skillDir, localRef.value, remoteRef.value);
  if (!summary.ok) return summary;

  return ok({
    name,
    currentRef: localRef.value.substring(0, 7),
    remoteRef: remoteRef.value.substring(0, 7),
    summary: summary.value,
  });
}

/** Execute the actual upgrade for a vendor skill submodule. */
async function executeSkillUpgrade(
  skillDir: string,
  branch: string,
): Promise<Result<void>> {
  const checkout = await gitExec(["checkout", branch], skillDir);
  if (!checkout.ok) return checkout;

  const pull = await gitExec(["pull", "origin", branch], skillDir);
  if (!pull.ok) return pull;

  return ok(undefined);
}

/** Resolve a vendor repo's directory within the registry. */
function vendorSkillDir(regPath: string, vendorRepo: string): string {
  return `${regPath}/vendor/${vendorRepo}`;
}

/**
 * The git unit is the vendor *repo*, not the skill. A repo may ship many skills
 * (mattpocock-skills has 20+) and their directory names have nothing to do with
 * the repo name, so upgrading must key on `vendorRepo` — keying on `skill.name`
 * builds paths like vendor/ask-matt that don't exist, and bun reports the
 * missing cwd as `posix_spawn 'git'` ENOENT, which reads like git is missing.
 */
function uniqueVendorRepos(skills: RegistrySkill[]): string[] {
  const repos: string[] = [];
  const seen = new Set<string>();
  for (const skill of skills) {
    if (skill.type !== "vendor") continue;
    // Fall back to the skill name for flat repos (SKILL.md at the repo root).
    const repo = skill.vendorRepo ?? skill.name;
    if (seen.has(repo)) continue;
    seen.add(repo);
    repos.push(repo);
  }
  return repos;
}

/**
 * Check all vendor skills for available upgrades.
 * Returns a list of UpgradeInfo for skills that have updates.
 */
export async function checkUpgrades(
  overrideRegistryPath?: string,
): Promise<Result<UpgradeInfo[]>> {
  let regPath = overrideRegistryPath;
  if (!regPath) {
    const config = await readConfig();
    if (!config.ok) return config;
    regPath = registryPath(config.value);
  }

  const skills = await scanRegistry(regPath);
  if (!skills.ok) return skills;

  const upgrades: UpgradeInfo[] = [];

  for (const repo of uniqueVendorRepos(skills.value)) {
    const repoDir = vendorSkillDir(regPath, repo);

    // Local path vendors are symlinks the user maintains themselves, and a
    // vendor may be declared but never initialized. Neither is an error worth
    // aborting the whole sweep for — skip and keep checking the rest.
    if (!(await isGitRepo(repoDir))) continue;

    const result = await checkSkillUpgrade(repo, repoDir);
    if (!result.ok) return result;

    if (result.value !== null) {
      upgrades.push(result.value);
    }
  }

  return ok(upgrades);
}

/**
 * Execute upgrades for vendor skills that have updates.
 * If dryRun is true, only checks for updates without applying them.
 */
export async function upgradeSkills(
  options?: { dryRun?: boolean; overrideRegistryPath?: string },
): Promise<Result<UpgradeInfo[]>> {
  const dryRun = options?.dryRun ?? false;

  const check = await checkUpgrades(options?.overrideRegistryPath);
  if (!check.ok) return check;

  if (dryRun || check.value.length === 0) {
    return check;
  }

  let regPath = options?.overrideRegistryPath;
  if (!regPath) {
    const config = await readConfig();
    if (!config.ok) return config;
    regPath = registryPath(config.value);
  }

  // checkUpgrades only reports repos it could actually reach, so every name
  // here is a real git repo under vendor/.
  for (const upgrade of check.value) {
    const repoDir = vendorSkillDir(regPath, upgrade.name);

    const branch = await detectDefaultBranch(repoDir);
    if (!branch.ok) return branch;

    const exec = await executeSkillUpgrade(repoDir, branch.value);
    if (!exec.ok) return exec;
  }

  // Sync all targets after upgrades
  const config = await readConfig();
  if (!config.ok) return config;

  const sync = await syncSkills({
    registryDir: regPath,
    targets: config.value.targets,
  });
  if (!sync.ok) return sync;

  return check;
}
