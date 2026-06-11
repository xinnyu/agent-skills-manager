import { join } from "node:path";
import { lstat, rm, symlink, unlink } from "node:fs/promises";

import type { Result, TargetsConfig } from "../types";
import { ok, err } from "../utils/result";
import { gitSubmoduleAdd, gitExec } from "../utils/git";
import { ensureDir } from "../utils/fs";
import { upsertVendorConfig } from "./config";
import { syncSkills } from "./sync-engine";

export interface VendorOptions {
  configPath?: string;
  targets?: TargetsConfig;
}

/** Add a remote vendor via git submodule, then sync. */
export async function addVendorSkill(
  name: string,
  url: string,
  registryDir: string,
  options?: VendorOptions,
): Promise<Result<void>> {
  const vendorDir = join(registryDir, "vendor");
  const dir = await ensureDir(vendorDir);
  if (!dir.ok) return dir;

  const submodulePath = join("vendor", name);
  const sub = await gitSubmoduleAdd(url, submodulePath, registryDir);
  if (!sub.ok) return sub;

  const config = await upsertVendorConfig(registryDir, name, { url });
  if (!config.ok) return config;

  // Sync to all targets (scanRegistry will find all SKILL.md files in the repo)
  const sync = await syncSkills({
    registryDir,
    targets: options?.targets,
    configPath: options?.configPath,
  });
  if (!sync.ok) return sync;

  return ok(undefined);
}

/** Add a local vendor via symlink, then sync. */
export async function addLocalVendor(
  name: string,
  localPath: string,
  registryDir: string,
  options?: VendorOptions,
): Promise<Result<void>> {
  const vendorDir = join(registryDir, "vendor");
  const dir = await ensureDir(vendorDir);
  if (!dir.ok) return dir;

  const linkPath = join(vendorDir, name);

  // Check if target already exists
  try {
    await lstat(linkPath);
    return err(`Vendor "${name}" already exists in registry`);
  } catch {
    // Good — doesn't exist yet
  }

  // Create symlink to local repo
  try {
    await symlink(localPath, linkPath);
  } catch (e: unknown) {
    return err(`Failed to create symlink for vendor "${name}": ${String(e)}`);
  }

  const config = await upsertVendorConfig(registryDir, name, { path: localPath });
  if (!config.ok) return config;

  const sync = await syncSkills({
    registryDir,
    targets: options?.targets,
    configPath: options?.configPath,
  });
  if (!sync.ok) return sync;

  return ok(undefined);
}

/** Check if a vendor entry is a symlink (local) or a real directory (remote submodule). */
async function isLocalVendor(vendorPath: string): Promise<boolean> {
  try {
    const s = await lstat(vendorPath);
    return s.isSymbolicLink();
  } catch {
    return false;
  }
}

/** Remove a vendor: symlink for local, submodule cleanup for remote. */
export async function removeVendorSkill(
  name: string,
  registryDir: string,
  options?: VendorOptions,
): Promise<Result<void>> {
  const fullPath = join(registryDir, "vendor", name);

  if (await isLocalVendor(fullPath)) {
    // Local vendor: just remove the symlink
    try {
      await unlink(fullPath);
    } catch (e: unknown) {
      return err(`Failed to remove local vendor symlink: ${String(e)}`);
    }
  } else {
    // Remote vendor: full submodule cleanup
    const submodulePath = join("vendor", name);

    const deinit = await gitExec(
      ["submodule", "deinit", "-f", submodulePath],
      registryDir,
    );
    if (!deinit.ok) return deinit;

    const gitRm = await gitExec(["rm", "-f", submodulePath], registryDir);
    if (!gitRm.ok) return gitRm;

    const gitDir = join(registryDir, ".git", "modules", submodulePath);
    try {
      await rm(gitDir, { recursive: true, force: true });
    } catch {
      // Best effort
    }

    try {
      await rm(fullPath, { recursive: true, force: true });
    } catch {
      // Best effort
    }
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
