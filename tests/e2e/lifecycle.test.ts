import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { readdir, readFile, readlink, lstat, mkdir, writeFile } from "fs/promises";
import { join } from "path";

import { runCli, gitInit, createTestEnv, cleanupTestEnv } from "./helpers";
import type { TestEnv } from "./helpers";

let env: TestEnv;

beforeEach(async () => {
  env = await createTestEnv();
  await gitInit(env.registryDir);
});

afterEach(async () => {
  await cleanupTestEnv(env.testDir);
});

/**
 * Create a local git repo that contains a SKILL.md at root,
 * suitable as a vendor skill source URL for `git submodule add`.
 */
async function createVendorSource(testDir: string, name: string): Promise<string> {
  const srcDir = join(testDir, `vendor-source-${name}`);
  await mkdir(srcDir, { recursive: true });
  await writeFile(
    join(srcDir, "SKILL.md"),
    `---\nname: ${name}\ndescription: Vendor skill ${name}\n---\n\nVendor content for ${name}\n`,
    "utf-8",
  );
  await gitInit(srcDir);
  await Bun.spawn(["git", "-C", srcDir, "add", "."], { stdout: "ignore", stderr: "ignore" }).exited;
  await Bun.spawn(["git", "-C", srcDir, "commit", "-m", "init"], { stdout: "ignore", stderr: "ignore" }).exited;
  return srcDir;
}

/** Env vars to allow local file:// git submodule clones. */
const GIT_FILE_PROTO_ENV = {
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: "protocol.file.allow",
  GIT_CONFIG_VALUE_0: "always",
};

describe("CLI lifecycle: init → create → add vendor → sync → list → info → remove", () => {
  test("init creates registry with core/ and vendor/ directories", async () => {
    const result = await runCli(["init", env.registryDir], env.testDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("initialized");

    const entries = await readdir(env.registryDir);
    expect(entries).toContain("core");
    expect(entries).toContain("vendor");

    // ~/.asmrc should have been written with registry path
    const asmrcContent = await readFile(join(env.testDir, ".asmrc"), "utf-8");
    expect(asmrcContent).toContain(env.registryDir);

    // asm.toml should have been created with default sections
    const asmTomlContent = await readFile(env.asmTomlPath, "utf-8");
    expect(asmTomlContent).toContain("[config]");
    expect(asmTomlContent).toContain("[targets]");
  });

  test("create skill creates SKILL.md", async () => {
    await runCli(["init", env.registryDir], env.testDir);

    const result = await runCli(["create", "my-skill"], env.testDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("my-skill");

    // SKILL.md should exist
    const skillMd = await readFile(
      join(env.registryDir, "core", "my-skill", "SKILL.md"),
      "utf-8",
    );
    expect(skillMd).toContain("name: my-skill");
  });

  test("add vendor skill via local git URL", async () => {
    await runCli(["init", env.registryDir], env.testDir);

    const vendorSrc = await createVendorSource(env.testDir, "my-vendor");

    const result = await runCli(["add", "my-vendor", "--url", vendorSrc], env.testDir, GIT_FILE_PROTO_ENV);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("my-vendor");

    // vendor/my-vendor/SKILL.md should exist in registry
    const skillMd = await readFile(
      join(env.registryDir, "vendor", "my-vendor", "SKILL.md"),
      "utf-8",
    );
    expect(skillMd).toContain("name: my-vendor");
  });

  test("create second skill preserves existing skill", async () => {
    await runCli(["init", env.registryDir], env.testDir);

    await runCli(["create", "skill-one"], env.testDir);
    const result = await runCli(["create", "skill-two"], env.testDir);
    expect(result.exitCode).toBe(0);

    // Both skills should appear in list
    const listResult = await runCli(["list"], env.testDir);
    expect(listResult.exitCode).toBe(0);
    expect(listResult.stdout).toContain("skill-one");
    expect(listResult.stdout).toContain("skill-two");
  });

  test("sync creates symlinks for all skills", async () => {
    await runCli(["init", env.registryDir], env.testDir);
    await runCli(["create", "my-skill"], env.testDir);

    const result = await runCli(["sync"], env.testDir);
    expect(result.exitCode).toBe(0);

    for (const skillsDir of [
      env.skillsDir,
      env.codexSkillsDir,
      env.kiroSkillsDir,
    ]) {
      const target = await readlink(join(skillsDir, "my-skill"));
      expect(target).toBe(join(env.registryDir, "core", "my-skill"));
    }
  });

  test("sync backfills missing targets from an older asm.toml", async () => {
    await runCli(["init", env.registryDir], env.testDir);
    await writeFile(
      env.asmTomlPath,
      '[config]\ndefault_scope = "user"\n\n[targets]\nclaude = "~/.claude/skills"\n',
      "utf-8",
    );
    await runCli(["create", "my-skill"], env.testDir);

    const result = await runCli(["sync"], env.testDir);
    expect(result.exitCode).toBe(0);

    expect(await readlink(join(env.codexSkillsDir, "my-skill"))).toBe(
      join(env.registryDir, "core", "my-skill"),
    );
    expect(await readlink(join(env.kiroSkillsDir, "my-skill"))).toBe(
      join(env.registryDir, "core", "my-skill"),
    );
  });

  test("list reflects skills in registry", async () => {
    await runCli(["init", env.registryDir], env.testDir);
    await runCli(["create", "alpha"], env.testDir);
    await runCli(["create", "beta"], env.testDir);

    const result = await runCli(["list"], env.testDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("alpha");
    expect(result.stdout).toContain("beta");
    expect(result.stdout).toContain("core");
  });

  test("info returns correct details for an installed skill", async () => {
    await runCli(["init", env.registryDir], env.testDir);
    await runCli(["create", "my-skill"], env.testDir);

    const result = await runCli(["info", "my-skill"], env.testDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("my-skill");
    expect(result.stdout).toContain("core");
  });

  test("remove deletes skill directory", async () => {
    await runCli(["init", env.registryDir], env.testDir);
    await runCli(["create", "my-skill"], env.testDir);

    const result = await runCli(["remove", "my-skill"], env.testDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Removed");

    // List should show no skills
    const listResult = await runCli(["list"], env.testDir);
    expect(listResult.stdout).toContain("No skills installed");

    // Directory should be gone
    const coreEntries = await readdir(join(env.registryDir, "core"));
    expect(coreEntries).not.toContain("my-skill");
  });

  test("full lifecycle: init → create → add vendor → sync → list → remove", async () => {
    await runCli(["init", env.registryDir], env.testDir);

    // Add core skill
    const addCore = await runCli(["create", "lifecycle-skill"], env.testDir);
    expect(addCore.exitCode).toBe(0);

    // Add vendor skill
    const vendorSrc = await createVendorSource(env.testDir, "lifecycle-vendor");
    const addVendor = await runCli(["add", "lifecycle-vendor", "--url", vendorSrc], env.testDir, GIT_FILE_PROTO_ENV);
    expect(addVendor.exitCode).toBe(0);

    // Sync — creates symlinks
    const sync1 = await runCli(["sync"], env.testDir);
    expect(sync1.exitCode).toBe(0);

    const linkTarget = await readlink(join(env.skillsDir, "lifecycle-skill"));
    expect(linkTarget).toBe(join(env.registryDir, "core", "lifecycle-skill"));

    // Verify vendor symlink too
    const vendorLink = await readlink(join(env.skillsDir, "lifecycle-vendor"));
    expect(vendorLink).toBe(join(env.registryDir, "vendor", "lifecycle-vendor"));

    // List should show both skills
    const listResult = await runCli(["list"], env.testDir);
    expect(listResult.stdout).toContain("lifecycle-skill");
    expect(listResult.stdout).toContain("lifecycle-vendor");

    // Remove core skill
    const removeResult = await runCli(["remove", "lifecycle-skill"], env.testDir);
    expect(removeResult.exitCode).toBe(0);

    // Symlink should be removed
    try {
      await lstat(join(env.skillsDir, "lifecycle-skill"));
      expect("symlink still exists").toBe("should have been removed");
    } catch (e: unknown) {
      expect((e as NodeJS.ErrnoException).code).toBe("ENOENT");
    }

    // Vendor symlink should still exist
    const vendorLinkAfter = await readlink(join(env.skillsDir, "lifecycle-vendor"));
    expect(vendorLinkAfter).toBe(join(env.registryDir, "vendor", "lifecycle-vendor"));

    // List should only show vendor skill
    const listResult2 = await runCli(["list"], env.testDir);
    expect(listResult2.stdout).toContain("lifecycle-vendor");
    expect(listResult2.stdout).not.toContain("lifecycle-skill");
  });
});
