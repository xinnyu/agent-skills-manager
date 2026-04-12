import { dirname, join } from "node:path";
import { stat } from "node:fs/promises";

import type { Result, ProjectManifest } from "../types";
import { ok, err } from "../utils/result";
import { readToml } from "../utils/toml";

const MANIFEST_DIR = ".asm";
const MANIFEST_FILENAME = "skills.toml";
const MAX_WALK_DEPTH = 50;

function parseManifest(raw: Record<string, unknown>): Result<ProjectManifest> {
  const manifest: ProjectManifest = { skills: [], vendors: [] };

  const requiredRaw = raw.required;
  if (requiredRaw !== undefined) {
    if (!Array.isArray(requiredRaw)) {
      return err("Invalid manifest: \"required\" must be an array");
    }
    for (const item of requiredRaw) {
      if (typeof item !== "string") {
        return err("Invalid manifest: each entry in \"required\" must be a string");
      }
      manifest.skills.push(item);
    }
  }

  const vendorsRaw = raw.vendors;
  if (vendorsRaw !== undefined) {
    if (!Array.isArray(vendorsRaw)) {
      return err("Invalid manifest: \"vendors\" must be an array");
    }
    for (const item of vendorsRaw) {
      if (typeof item !== "string") {
        return err("Invalid manifest: each entry in \"vendors\" must be a string");
      }
      manifest.vendors.push(item);
    }
  }

  return ok(manifest);
}

/** Walk up from startDir looking for .asm/skills.toml. Returns the file path or null. */
export async function findManifest(startDir: string): Promise<Result<string | null>> {
  let current = startDir;

  for (let i = 0; i < MAX_WALK_DEPTH; i++) {
    const candidate = join(current, MANIFEST_DIR, MANIFEST_FILENAME);
    try {
      const s = await stat(candidate);
      if (s.isFile()) {
        return ok(candidate);
      }
    } catch {
      // file doesn't exist, continue walking up
    }

    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return ok(null);
}

/** Read and parse a .asm/skills.toml manifest. Returns empty manifest if file doesn't exist. */
export async function readManifest(path: string): Promise<Result<ProjectManifest>> {
  const raw = await readToml(path);

  if (!raw.ok) {
    if (raw.error.includes("File not found")) {
      return ok({ skills: [], vendors: [] });
    }
    return raw;
  }

  return parseManifest(raw.value);
}

import type { RegistrySkill } from "../types";

/** Check which required manifest skills/vendors are missing from installed skills. */
export function checkManifestRequirements(
  manifest: ProjectManifest,
  registrySkills: RegistrySkill[],
): { missing: string[]; missingVendors: string[] } {
  const installedNames = new Set(registrySkills.map((s) => s.name));
  const missing: string[] = [];

  for (const name of manifest.skills) {
    if (!installedNames.has(name)) {
      missing.push(name);
    }
  }

  // Check vendor repos: all listed vendors must exist in the registry
  const installedVendorRepos = new Set(
    registrySkills.filter((s) => s.vendorRepo).map((s) => s.vendorRepo!),
  );
  const missingVendors: string[] = [];
  for (const vendor of manifest.vendors) {
    if (!installedVendorRepos.has(vendor)) {
      missingVendors.push(vendor);
    }
  }

  return { missing, missingVendors };
}
