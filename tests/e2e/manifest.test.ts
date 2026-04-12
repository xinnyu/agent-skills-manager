import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile, readlink } from "fs/promises";
import { join } from "path";

import { syncSkills } from "../../src/core/sync-engine";
import { createTestEnv, cleanupTestEnv, gitInit, seedCoreSkill } from "./helpers";
import type { TestEnv } from "./helpers";

let env: TestEnv;
let projectDir: string;
let originalHome: string | undefined;

beforeEach(async () => {
  env = await createTestEnv();
  originalHome = process.env.HOME;
  process.env.HOME = env.testDir;
  await gitInit(env.registryDir);
  projectDir = join(env.testDir, "project");
  await mkdir(projectDir, { recursive: true });
});

afterEach(async () => {
  process.env.HOME = originalHome;
  await cleanupTestEnv(env.testDir);
});

async function writeManifest(dir: string, content: string): Promise<void> {
  const asmDir = join(dir, ".asm");
  await mkdir(asmDir, { recursive: true });
  await writeFile(join(asmDir, "skills.toml"), content, "utf-8");
}

function syncOpts(e: TestEnv, cwd?: string) {
  return {
    registryDir: e.registryDir,
    targets: { test: e.skillsDir },
    overrideSyncHashPath: e.syncHashPath,
    cwd,
  };
}

describe("project manifest semantics", () => {
  test("required skill that is installed: sync creates symlinks in both project target dirs", async () => {
    await seedCoreSkill("required-skill", env.registryDir);
    await seedCoreSkill("global-skill", env.registryDir);
    await writeFile(join(env.testDir, ".asm", "skills.toml"), 'required = ["global-skill"]\n', "utf-8");
    await writeManifest(projectDir, 'required = ["required-skill"]\n');

    const result = await syncSkills(syncOpts(env, projectDir));
    expect(result.ok).toBe(true);

    const claudeTarget = await readlink(join(projectDir, ".claude", "skills", "required-skill"));
    expect(claudeTarget).toBe(join(env.registryDir, "core", "required-skill"));

    const codexTarget = await readlink(join(projectDir, ".agents", "skills", "required-skill"));
    expect(codexTarget).toBe(join(env.registryDir, "core", "required-skill"));
  });

  test("required skill that is NOT installed: sync returns error", async () => {
    await writeManifest(projectDir, 'required = ["missing-skill"]\n');

    const result = await syncSkills(syncOpts(env, projectDir));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("missing-skill");
      expect(result.error).toContain("not installed");
    }
  });

  test("multiple required skills: all get symlinks in both project target dirs", async () => {
    await seedCoreSkill("req-a", env.registryDir);
    await seedCoreSkill("req-b", env.registryDir);
    await seedCoreSkill("global-skill", env.registryDir);
    await writeFile(join(env.testDir, ".asm", "skills.toml"), 'required = ["global-skill"]\n', "utf-8");
    await writeManifest(projectDir, 'required = ["req-a", "req-b"]\n');

    const result = await syncSkills(syncOpts(env, projectDir));
    expect(result.ok).toBe(true);

    const claudeTargetA = await readlink(join(projectDir, ".claude", "skills", "req-a"));
    expect(claudeTargetA).toBe(join(env.registryDir, "core", "req-a"));

    const codexTargetA = await readlink(join(projectDir, ".agents", "skills", "req-a"));
    expect(codexTargetA).toBe(join(env.registryDir, "core", "req-a"));

    const claudeTargetB = await readlink(join(projectDir, ".claude", "skills", "req-b"));
    expect(claudeTargetB).toBe(join(env.registryDir, "core", "req-b"));

    const codexTargetB = await readlink(join(projectDir, ".agents", "skills", "req-b"));
    expect(codexTargetB).toBe(join(env.registryDir, "core", "req-b"));
  });
});
