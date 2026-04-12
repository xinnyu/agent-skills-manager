import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, stat, readlink, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { addCoreSkill, removeCoreSkill } from "../src/core/add";
import { addVendorSkill, removeVendorSkill } from "../src/core/vendor";
import { scanRegistry } from "../src/core/registry";
import { gitExec } from "../src/utils/git";

// Allow file:// protocol for local git submodule tests
Bun.env.GIT_CONFIG_COUNT = "1";
Bun.env.GIT_CONFIG_KEY_0 = "protocol.file.allow";
Bun.env.GIT_CONFIG_VALUE_0 = "always";

let tempDir: string;
let registryDir: string;
let targetDir: string;
let originalHome: string | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "asm-remove-test-"));
  originalHome = process.env.HOME;
  process.env.HOME = tempDir;
  registryDir = join(tempDir, "registry");
  targetDir = join(tempDir, "skills");

  await mkdir(join(registryDir, "core"), { recursive: true });
  await mkdir(join(registryDir, "vendor"), { recursive: true });
  await mkdir(targetDir, { recursive: true });
  await gitExec(["init"], registryDir);
  await gitExec(["config", "user.email", "test@test.com"], registryDir);
  await gitExec(["config", "user.name", "Test"], registryDir);
});

afterEach(async () => {
  process.env.HOME = originalHome;
  await rm(tempDir, { recursive: true, force: true });
});

const opts = () => ({ targets: { test: targetDir } });

describe("removeCoreSkill()", () => {
  test("removes core skill directory and cleans up symlinks", async () => {
    await addCoreSkill("my-skill", registryDir, opts());
    const result = await removeCoreSkill("my-skill", registryDir, opts());
    expect(result.ok).toBe(true);

    // Directory should be gone
    try {
      await stat(join(registryDir, "core", "my-skill"));
      expect(true).toBe(false); // Should not reach here
    } catch (e: unknown) {
      expect((e as NodeJS.ErrnoException).code).toBe("ENOENT");
    }

    // Symlink should be removed from target
    let symlinkExists = true;
    try {
      await lstat(join(targetDir, "my-skill"));
    } catch {
      symlinkExists = false;
    }
    expect(symlinkExists).toBe(false);

    // Skill should not appear in registry scan
    const skills = await scanRegistry(registryDir);
    expect(skills.ok).toBe(true);
    if (skills.ok) {
      expect(skills.value.find((s) => s.name === "my-skill")).toBeUndefined();
    }
  });

  test("removes from all targets", async () => {
    const target2 = join(tempDir, "skills2");
    await mkdir(target2, { recursive: true });

    const multiOpts = { targets: { t1: targetDir, t2: target2 } };
    await addCoreSkill("multi-skill", registryDir, multiOpts);

    // Verify both targets have symlinks
    await readlink(join(targetDir, "multi-skill"));
    await readlink(join(target2, "multi-skill"));

    const result = await removeCoreSkill("multi-skill", registryDir, multiOpts);
    expect(result.ok).toBe(true);

    // Both targets should have symlinks removed
    for (const dir of [targetDir, target2]) {
      let exists = true;
      try {
        await lstat(join(dir, "multi-skill"));
      } catch {
        exists = false;
      }
      expect(exists).toBe(false);
    }
  });
});

describe("removeVendorSkill()", () => {
  test("removes vendor skill with submodule cleanup", async () => {
    // Create fake remote
    const fakeRemote = join(tempDir, "fake-remote");
    await mkdir(fakeRemote, { recursive: true });
    await gitExec(["init"], fakeRemote);
    await gitExec(["config", "user.email", "test@test.com"], fakeRemote);
    await gitExec(["config", "user.name", "Test"], fakeRemote);
    await Bun.write(join(fakeRemote, "SKILL.md"), "# Test");
    await gitExec(["add", "."], fakeRemote);
    await gitExec(["commit", "-m", "init"], fakeRemote);

    // Initialize registry with a commit
    await Bun.write(join(registryDir, ".gitkeep"), "");
    await gitExec(["add", "."], registryDir);
    await gitExec(["commit", "-m", "init"], registryDir);

    // Add then remove
    await addVendorSkill("test-vendor", `file://${fakeRemote}`, registryDir, opts());
    await gitExec(["add", "."], registryDir);
    await gitExec(["commit", "-m", "add submodule"], registryDir);

    const result = await removeVendorSkill("test-vendor", registryDir, opts());
    expect(result.ok).toBe(true);

    // Vendor should not appear in registry scan
    const skills = await scanRegistry(registryDir);
    expect(skills.ok).toBe(true);
    if (skills.ok) {
      expect(skills.value.find((s) => s.name === "test-vendor")).toBeUndefined();
    }
  });

  test("returns error when removing nonexistent vendor submodule", async () => {
    await Bun.write(join(registryDir, ".gitkeep"), "");
    await gitExec(["add", "."], registryDir);
    await gitExec(["commit", "-m", "init"], registryDir);

    // removeVendorSkill will fail at git submodule deinit since there's no such submodule
    const result = await removeVendorSkill("nonexistent", registryDir, opts());
    expect(result.ok).toBe(false);
  });
});
