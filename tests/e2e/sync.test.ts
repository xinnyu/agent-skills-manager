import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { readlink, symlink, unlink, mkdir } from "fs/promises";
import { join } from "path";

import { syncSkills } from "../../src/core/sync-engine";
import { readManaged } from "../../src/core/managed";
import { createTestEnv, cleanupTestEnv, gitInit, seedCoreSkill } from "./helpers";
import type { TestEnv } from "./helpers";

let env: TestEnv;
let originalHome: string | undefined;

function syncOpts(e: TestEnv) {
  return {
    registryDir: e.registryDir,
    targets: { test: e.skillsDir },
    overrideSyncHashPath: e.syncHashPath,
  };
}

beforeEach(async () => {
  env = await createTestEnv();
  originalHome = process.env.HOME;
  process.env.HOME = env.testDir;
  await gitInit(env.registryDir);
});

afterEach(async () => {
  process.env.HOME = originalHome;
  await cleanupTestEnv(env.testDir);
});

describe("sync behavior", () => {
  test("idempotent sync: second run returns skipped=true when nothing changed", async () => {
    await seedCoreSkill("alpha", env.registryDir);

    const opts = syncOpts(env);

    const first = await syncSkills(opts);
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.value.skipped).toBe(false);
    }

    const second = await syncSkills(opts);
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.value.skipped).toBe(true);
    }
  });

  test("ownership protection: manually created symlink at same path is not managed", async () => {
    // Create a manual symlink (not via ASM)
    const manualTarget = join(env.testDir, "manual-source");
    await mkdir(manualTarget, { recursive: true });
    const linkPath = join(env.skillsDir, "manual-link");
    await symlink(manualTarget, linkPath);

    // Add and sync a different skill
    await seedCoreSkill("real-skill", env.registryDir);

    const result = await syncSkills(syncOpts(env));
    expect(result.ok).toBe(true);

    // The manual symlink should remain untouched (still points to manual-source)
    const target = await readlink(linkPath);
    expect(target).toBe(manualTarget);

    // The managed list should only contain the real skill
    const managed = await readManaged(join(env.skillsDir, ".asm-managed.toml"));
    expect(managed.ok).toBe(true);
    if (managed.ok) {
      expect(managed.value.links["manual-link"]).toBeUndefined();
      expect(managed.value.links["real-skill"]).toBeDefined();
    }
  });

  test("self-healing: sync restores a deleted managed symlink", async () => {
    await seedCoreSkill("healme", env.registryDir);

    const opts = syncOpts(env);

    // First sync — creates the symlink
    const first = await syncSkills(opts);
    expect(first.ok).toBe(true);

    const linkPath = join(env.skillsDir, "healme");
    const originalTarget = await readlink(linkPath);
    expect(originalTarget).toBe(join(env.registryDir, "core", "healme"));

    // Delete the symlink manually
    await unlink(linkPath);

    // Second sync should detect the missing link and recreate it (not skip)
    const second = await syncSkills(opts);
    expect(second.ok).toBe(true);
    if (second.ok) {
      // Even though hash matches, verification fails → full reconcile → skipped=false
      expect(second.value.skipped).toBe(false);
    }

    // Symlink should be restored
    const restored = await readlink(linkPath);
    expect(restored).toBe(join(env.registryDir, "core", "healme"));
  });

  test("fast path: sync skips reconciliation when hash matches and links are valid", async () => {
    await seedCoreSkill("fast-skill", env.registryDir);

    const opts = syncOpts(env);

    // Initial sync
    const first = await syncSkills(opts);
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.value.skipped).toBe(false);
    }

    // Second sync — nothing changed, hash matches, links valid
    const second = await syncSkills(opts);
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.value.skipped).toBe(true);
    }

    // Verify the symlink is still correct
    const target = await readlink(join(env.skillsDir, "fast-skill"));
    expect(target).toBe(join(env.registryDir, "core", "fast-skill"));
  });
});
