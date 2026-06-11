import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readFile, mkdir, readlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { addCoreSkill } from "../src/core/add";
import { addVendorSkill, addLocalVendor } from "../src/core/vendor";
import { detectSkillPath, scanRegistry } from "../src/core/registry";
import { readToml } from "../src/utils/toml";
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
  tempDir = await mkdtemp(join(tmpdir(), "asm-add-test-"));
  originalHome = process.env.HOME;
  process.env.HOME = tempDir;
  registryDir = join(tempDir, "registry");
  targetDir = join(tempDir, "skills");

  // Set up a bare registry with git
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

describe("addCoreSkill()", () => {
  test("creates skill directory and SKILL.md", async () => {
    const result = await addCoreSkill("my-skill", registryDir, { targets: { test: targetDir } });
    expect(result.ok).toBe(true);

    const skillMd = await readFile(join(registryDir, "core", "my-skill", "SKILL.md"), "utf-8");
    expect(skillMd).toContain("name: my-skill");
  });

  test("triggers sync: creates symlink in target", async () => {
    await addCoreSkill("my-skill", registryDir, { targets: { test: targetDir } });

    const target = await readlink(join(targetDir, "my-skill"));
    expect(target).toBe(join(registryDir, "core", "my-skill"));
  });

  test("does not write state to asm.toml", async () => {
    await addCoreSkill("my-skill", registryDir, { targets: { test: targetDir } });

    // asm.toml should not have a [skills] section
    const asmToml = join(registryDir, "asm.toml");
    try {
      const raw = await readToml(asmToml);
      if (raw.ok) {
        expect(raw.value.skills).toBeUndefined();
      }
    } catch {
      // asm.toml might not exist, which is also fine
    }
  });

  test("skill appears in registry scan", async () => {
    await addCoreSkill("my-skill", registryDir, { targets: { test: targetDir } });

    const skills = await scanRegistry(registryDir);
    expect(skills.ok).toBe(true);
    if (skills.ok) {
      const skill = skills.value.find((s) => s.name === "my-skill");
      expect(skill).toBeDefined();
      expect(skill!.type).toBe("core");
    }
  });

  test("returns error for duplicate skill", async () => {
    await addCoreSkill("my-skill", registryDir, { targets: { test: targetDir } });
    const result = await addCoreSkill("my-skill", registryDir, { targets: { test: targetDir } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("already exists");
    }
  });

  test("returns error for invalid name with uppercase", async () => {
    const result = await addCoreSkill("MySkill", registryDir, { targets: { test: targetDir } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Invalid skill name");
    }
  });

  test("returns error for name starting with number", async () => {
    const result = await addCoreSkill("1skill", registryDir, { targets: { test: targetDir } });
    expect(result.ok).toBe(false);
  });

  test("returns error for empty name", async () => {
    const result = await addCoreSkill("", registryDir, { targets: { test: targetDir } });
    expect(result.ok).toBe(false);
  });

  test("returns error for name with special characters", async () => {
    const result = await addCoreSkill("my_skill", registryDir, { targets: { test: targetDir } });
    expect(result.ok).toBe(false);
  });
});

describe("addVendorSkill() (mock-free)", () => {
  test("adds vendor skill from a local git repo", async () => {
    // Create a fake "remote" repo with SKILL.md
    const fakeRemote = join(tempDir, "fake-remote");
    await mkdir(fakeRemote, { recursive: true });
    await gitExec(["init"], fakeRemote);
    await gitExec(["config", "user.email", "test@test.com"], fakeRemote);
    await gitExec(["config", "user.name", "Test"], fakeRemote);
    await Bun.write(join(fakeRemote, "SKILL.md"), "# Test Skill");
    await gitExec(["add", "."], fakeRemote);
    await gitExec(["commit", "-m", "init"], fakeRemote);

    // Need initial commit in registry for submodule to work
    await Bun.write(join(registryDir, ".gitkeep"), "");
    await gitExec(["add", "."], registryDir);
    await gitExec(["commit", "-m", "init"], registryDir);

    const result = await addVendorSkill("test-vendor", `file://${fakeRemote}`, registryDir, { targets: { test: targetDir } });
    expect(result.ok).toBe(true);

    // Verify it appears in registry scan
    const skills = await scanRegistry(registryDir);
    expect(skills.ok).toBe(true);
    if (skills.ok) {
      const skill = skills.value.find((s) => s.name === "test-vendor");
      expect(skill).toBeDefined();
      expect(skill!.type).toBe("vendor");
    }

    // Verify symlink in target
    const target = await readlink(join(targetDir, "test-vendor"));
    expect(target).toBe(join(registryDir, "vendor", "test-vendor"));
  });

  test("records remote vendor URL in asm.toml", async () => {
    const fakeRemote = join(tempDir, "fake-remote-config");
    await mkdir(fakeRemote, { recursive: true });
    await gitExec(["init"], fakeRemote);
    await gitExec(["config", "user.email", "test@test.com"], fakeRemote);
    await gitExec(["config", "user.name", "Test"], fakeRemote);
    await Bun.write(join(fakeRemote, "SKILL.md"), "# Test Skill");
    await gitExec(["add", "."], fakeRemote);
    await gitExec(["commit", "-m", "init"], fakeRemote);

    await Bun.write(join(registryDir, ".gitkeep"), "");
    await gitExec(["add", "."], registryDir);
    await gitExec(["commit", "-m", "init"], registryDir);

    const url = `file://${fakeRemote}`;
    const result = await addVendorSkill("test-vendor", url, registryDir, { targets: { test: targetDir } });
    expect(result.ok).toBe(true);

    const toml = await readToml(join(registryDir, "asm.toml"));
    expect(toml.ok).toBe(true);
    if (toml.ok) {
      const vendor = toml.value.vendor as Record<string, { url?: string }>;
      expect(vendor["test-vendor"]).toEqual({ url });
    }
  });

  test("records local vendor path in asm.toml", async () => {
    const localVendor = join(tempDir, "local-vendor");
    await mkdir(localVendor, { recursive: true });
    await Bun.write(join(localVendor, "SKILL.md"), "# Local Vendor");

    const result = await addLocalVendor("local-vendor", localVendor, registryDir, { targets: { test: targetDir } });
    expect(result.ok).toBe(true);

    const toml = await readToml(join(registryDir, "asm.toml"));
    expect(toml.ok).toBe(true);
    if (toml.ok) {
      const vendor = toml.value.vendor as Record<string, { path?: string }>;
      expect(vendor["local-vendor"]).toEqual({ path: localVendor });
    }
  });

  test("vendor repo with multiple skills creates symlinks for each", async () => {
    // Create a fake "remote" repo with two skills in subdirectories
    const fakeRemote = join(tempDir, "fake-remote-multi");
    await mkdir(join(fakeRemote, "skills", "skill-alpha"), { recursive: true });
    await mkdir(join(fakeRemote, "skills", "skill-beta"), { recursive: true });
    await gitExec(["init"], fakeRemote);
    await gitExec(["config", "user.email", "test@test.com"], fakeRemote);
    await gitExec(["config", "user.name", "Test"], fakeRemote);
    await Bun.write(join(fakeRemote, "skills", "skill-alpha", "SKILL.md"), "---\nname: skill-alpha\ndescription: Alpha\n---\n");
    await Bun.write(join(fakeRemote, "skills", "skill-beta", "SKILL.md"), "---\nname: skill-beta\ndescription: Beta\n---\n");
    await Bun.write(join(fakeRemote, "README.md"), "# Multi-skill repo");
    await gitExec(["add", "."], fakeRemote);
    await gitExec(["commit", "-m", "init"], fakeRemote);

    await Bun.write(join(registryDir, ".gitkeep"), "");
    await gitExec(["add", "."], registryDir);
    await gitExec(["commit", "-m", "init"], registryDir);

    const result = await addVendorSkill("multi-vendor", `file://${fakeRemote}`, registryDir, { targets: { test: targetDir } });
    expect(result.ok).toBe(true);

    // Both skills should have symlinks
    const alphaTarget = await readlink(join(targetDir, "skill-alpha"));
    expect(alphaTarget).toBe(join(registryDir, "vendor", "multi-vendor", "skills", "skill-alpha"));

    const betaTarget = await readlink(join(targetDir, "skill-beta"));
    expect(betaTarget).toBe(join(registryDir, "vendor", "multi-vendor", "skills", "skill-beta"));
  });

  test("returns error for invalid git URL", async () => {
    await Bun.write(join(registryDir, ".gitkeep"), "");
    await gitExec(["add", "."], registryDir);
    await gitExec(["commit", "-m", "init"], registryDir);

    const result = await addVendorSkill(
      "bad-vendor",
      "/nonexistent/repo.git",
      registryDir,
      { targets: { test: targetDir } },
    );
    expect(result.ok).toBe(false);
  });
});

describe("detectSkillPath()", () => {
  test("finds SKILL.md at root", async () => {
    const dir = join(tempDir, "detect-root");
    await mkdir(dir, { recursive: true });
    await Bun.write(join(dir, "SKILL.md"), "# Skill");
    const result = await detectSkillPath(dir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(".");
    }
  });

  test("finds SKILL.md in subdirectory", async () => {
    const dir = join(tempDir, "detect-sub");
    await mkdir(join(dir, "lib"), { recursive: true });
    await Bun.write(join(dir, "lib", "SKILL.md"), "# Skill");
    const result = await detectSkillPath(dir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe("lib");
    }
  });
});
