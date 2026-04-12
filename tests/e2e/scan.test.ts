import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { readlink, lstat, mkdir, writeFile, stat } from "fs/promises";
import { join } from "path";

import { createTestEnv, cleanupTestEnv, gitInit } from "./helpers";
import type { TestEnv } from "./helpers";
import { scanSkills, adoptAsCore, adoptAsVendor } from "../../src/core/scan";
import { readManaged } from "../../src/core/managed";
import { gitExec } from "../../src/utils/git";

// Allow file:// protocol for local git submodule tests
Bun.env.GIT_CONFIG_COUNT = "1";
Bun.env.GIT_CONFIG_KEY_0 = "protocol.file.allow";
Bun.env.GIT_CONFIG_VALUE_0 = "always";

let env: TestEnv;

beforeEach(async () => {
  env = await createTestEnv();
  await gitInit(env.registryDir);
  // Need initial commit for submodule operations
  await writeFile(join(env.registryDir, ".gitkeep"), "");
  await gitExec(["add", "."], env.registryDir);
  await gitExec(["commit", "-m", "init"], env.registryDir);
});

afterEach(async () => {
  await cleanupTestEnv(env.testDir);
});

describe("E2E: scan → adopt as core", () => {
  test("full flow: manual skill → scan → adopt core → verify", async () => {
    // Step 1: Create a manual skill in skills dir
    const skillDir = join(env.skillsDir, "manual-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      "---\nname: manual-skill\ndescription: Manually placed skill\n---\n\nSkill content\n",
    );

    // Step 2: Scan — should discover the manual skill
    const scanResult = await scanSkills({
      skillsDir: env.skillsDir,
      managedPath: join(env.skillsDir, ".asm-managed.toml"),
      skipPluginExclusion: true,
    });
    expect(scanResult.ok).toBe(true);
    if (!scanResult.ok) return;
    expect(scanResult.value.skills).toHaveLength(1);
    expect(scanResult.value.skills[0].name).toBe("manual-skill");
    expect(scanResult.value.skills[0].type).toBe("directory");
    expect(scanResult.value.skills[0].description).toBe("Manually placed skill");

    // Step 3: Adopt as core
    const adoptResult = await adoptAsCore("manual-skill", {
      registryDir: env.registryDir,
      skillsDir: env.skillsDir,
      managedPath: join(env.skillsDir, ".asm-managed.toml"),
    });
    expect(adoptResult.ok).toBe(true);

    // Step 4: Verify — symlink exists and points to registry
    const linkStat = await lstat(join(env.skillsDir, "manual-skill"));
    expect(linkStat.isSymbolicLink()).toBe(true);

    const target = await readlink(join(env.skillsDir, "manual-skill"));
    expect(target).toBe(join(env.registryDir, "core", "manual-skill"));

    // Step 5: Verify skill directory exists in registry
    const regStat = await stat(join(env.registryDir, "core", "manual-skill"));
    expect(regStat.isDirectory()).toBe(true);

    // Step 6: Verify .asm-managed.toml
    const managed = await readManaged(join(env.skillsDir, ".asm-managed.toml"));
    expect(managed.ok).toBe(true);
    if (managed.ok) {
      expect(managed.value.links["manual-skill"]).toBeDefined();
      expect(managed.value.links["manual-skill"].target).toBe(
        join(env.registryDir, "core", "manual-skill"),
      );
    }

    // Step 7: Rescan — should no longer find the skill
    const rescanResult = await scanSkills({
      skillsDir: env.skillsDir,
      managedPath: join(env.skillsDir, ".asm-managed.toml"),
    });
    expect(rescanResult.ok).toBe(true);
    if (rescanResult.ok) {
      expect(rescanResult.value.skills).toHaveLength(0);
    }
  });
});

describe("E2E: scan → adopt as vendor", () => {
  test("full flow: git repo with remote → scan → adopt vendor → verify", async () => {
    // Step 1: Create a fake remote repo
    const fakeRemote = join(env.testDir, "fake-remote");
    await mkdir(fakeRemote, { recursive: true });
    await gitInit(fakeRemote);
    await writeFile(
      join(fakeRemote, "SKILL.md"),
      "---\nname: vendor-skill\ndescription: A vendor skill\n---\n\nVendor content\n",
    );
    await gitExec(["add", "."], fakeRemote);
    await gitExec(["commit", "-m", "init"], fakeRemote);

    // Step 2: Create a git repo in skills dir pointing to the remote
    const skillDir = join(env.skillsDir, "vendor-skill");
    await mkdir(skillDir, { recursive: true });
    await gitInit(skillDir);
    await writeFile(join(skillDir, "SKILL.md"), "---\nname: vendor-skill\n---\n");
    await gitExec(["add", "."], skillDir);
    await gitExec(["commit", "-m", "init"], skillDir);
    await gitExec(["remote", "add", "origin", `file://${fakeRemote}`], skillDir);

    // Step 3: Scan
    const scanResult = await scanSkills({
      skillsDir: env.skillsDir,
      managedPath: join(env.skillsDir, ".asm-managed.toml"),
      skipPluginExclusion: true,
    });
    expect(scanResult.ok).toBe(true);
    if (!scanResult.ok) return;
    expect(scanResult.value.skills).toHaveLength(1);
    expect(scanResult.value.skills[0].name).toBe("vendor-skill");
    expect(scanResult.value.skills[0].type).toBe("git-repo");
    expect(scanResult.value.skills[0].remoteUrl).toBe(`file://${fakeRemote}`);

    // Step 4: Adopt as vendor
    const adoptResult = await adoptAsVendor("vendor-skill", {
      registryDir: env.registryDir,
      skillsDir: env.skillsDir,
      managedPath: join(env.skillsDir, ".asm-managed.toml"),
    });
    expect(adoptResult.ok).toBe(true);

    // Step 5: Verify symlink exists
    const linkStat = await lstat(join(env.skillsDir, "vendor-skill"));
    expect(linkStat.isSymbolicLink()).toBe(true);

    // Step 6: Verify .asm-managed.toml
    const managed = await readManaged(join(env.skillsDir, ".asm-managed.toml"));
    expect(managed.ok).toBe(true);
    if (managed.ok) {
      expect(managed.value.links["vendor-skill"]).toBeDefined();
    }

    // Step 7: Rescan — should not find the skill
    const rescanResult = await scanSkills({
      skillsDir: env.skillsDir,
      managedPath: join(env.skillsDir, ".asm-managed.toml"),
    });
    expect(rescanResult.ok).toBe(true);
    if (rescanResult.ok) {
      expect(rescanResult.value.skills).toHaveLength(0);
    }
  });
});

describe("E2E: scan symlink → adopt core", () => {
  test("symlink skill → scan → adopt core → verify symlink replaced", async () => {
    // Create a target directory outside skills dir
    const externalDir = join(env.testDir, "external-skill");
    await mkdir(externalDir, { recursive: true });
    await writeFile(
      join(externalDir, "SKILL.md"),
      "---\nname: ext-skill\ndescription: External\n---\n",
    );

    // Create symlink in skills dir
    const { symlink } = await import("node:fs/promises");
    await symlink(externalDir, join(env.skillsDir, "ext-skill"));

    // Scan
    const scanResult = await scanSkills({
      skillsDir: env.skillsDir,
      managedPath: join(env.skillsDir, ".asm-managed.toml"),
      skipPluginExclusion: true,
    });
    expect(scanResult.ok).toBe(true);
    if (!scanResult.ok) return;
    expect(scanResult.value.skills).toHaveLength(1);
    expect(scanResult.value.skills[0].type).toBe("symlink");

    // Adopt as core
    const adoptResult = await adoptAsCore("ext-skill", {
      registryDir: env.registryDir,
      skillsDir: env.skillsDir,
      managedPath: join(env.skillsDir, ".asm-managed.toml"),
    });
    expect(adoptResult.ok).toBe(true);

    // Verify symlink now points to registry
    const target = await readlink(join(env.skillsDir, "ext-skill"));
    expect(target).toBe(join(env.registryDir, "core", "ext-skill"));

    // Verify SKILL.md exists in registry
    const skillMd = Bun.file(join(env.registryDir, "core", "ext-skill", "SKILL.md"));
    expect(await skillMd.exists()).toBe(true);
  });
});
