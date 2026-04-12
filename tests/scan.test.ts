import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile, symlink, readlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { scanSkills, adoptAsCore, adoptAsVendor, adoptSkill } from "../src/core/scan";
import { readManaged } from "../src/core/managed";
import { gitExec } from "../src/utils/git";

// Allow file:// protocol for local git submodule tests
Bun.env.GIT_CONFIG_COUNT = "1";
Bun.env.GIT_CONFIG_KEY_0 = "protocol.file.allow";
Bun.env.GIT_CONFIG_VALUE_0 = "always";

let tempDir: string;
let skillsDir: string;
let registryDir: string;
let managedPath: string;
let originalHome: string | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "asm-scan-test-"));
  originalHome = process.env.HOME;
  process.env.HOME = tempDir;
  skillsDir = join(tempDir, ".claude", "skills");
  registryDir = join(tempDir, "registry");
  managedPath = join(skillsDir, ".asm-managed.toml");

  await mkdir(skillsDir, { recursive: true });
  await mkdir(join(registryDir, "core"), { recursive: true });
  await mkdir(join(registryDir, "vendor"), { recursive: true });

  // Initialize git in registry
  await gitExec(["init"], registryDir);
  await gitExec(["config", "user.email", "test@test.com"], registryDir);
  await gitExec(["config", "user.name", "Test"], registryDir);
  await writeFile(join(registryDir, ".gitkeep"), "");
  await gitExec(["add", "."], registryDir);
  await gitExec(["commit", "-m", "init"], registryDir);
});

afterEach(async () => {
  process.env.HOME = originalHome;
  await rm(tempDir, { recursive: true, force: true });
});

describe("scanSkills()", () => {
  test("returns empty array for empty directory", async () => {
    const result = await scanSkills({ skillsDir, managedPath, skipPluginExclusion: true });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.skills).toEqual([]);
    }
  });

  test("returns empty array when directory does not exist", async () => {
    const result = await scanSkills({
      skillsDir: join(tempDir, "nonexistent"),
      managedPath: join(tempDir, "nonexistent", ".asm-managed.toml"),
      skipPluginExclusion: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.skills).toEqual([]);
    }
  });

  test("discovers unmanaged directories", async () => {
    const skillDir = join(skillsDir, "my-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      "---\nname: my-skill\ndescription: A test skill\n---\n\nContent\n",
    );

    const result = await scanSkills({ skillsDir, managedPath, skipPluginExclusion: true });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.skills).toHaveLength(1);
      expect(result.value.skills[0].name).toBe("my-skill");
      expect(result.value.skills[0].type).toBe("directory");
      expect(result.value.skills[0].description).toBe("A test skill");
      expect(result.value.skills[0].foundIn).toEqual(["default"]);
    }
  });

  test("excludes hidden entries", async () => {
    await mkdir(join(skillsDir, ".hidden-skill"), { recursive: true });
    await mkdir(join(skillsDir, "visible-skill"), { recursive: true });

    const result = await scanSkills({ skillsDir, managedPath, skipPluginExclusion: true });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.skills).toHaveLength(1);
      expect(result.value.skills[0].name).toBe("visible-skill");
    }
  });

  test("excludes managed entries", async () => {
    await mkdir(join(skillsDir, "managed-skill"), { recursive: true });
    await mkdir(join(skillsDir, "unmanaged-skill"), { recursive: true });

    await writeFile(
      managedPath,
      '[links.managed-skill]\ntarget = "/some/path"\n',
    );

    const result = await scanSkills({ skillsDir, managedPath, skipPluginExclusion: true });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.skills).toHaveLength(1);
      expect(result.value.skills[0].name).toBe("unmanaged-skill");
    }
  });

  test("identifies symlink entries", async () => {
    const targetDir = join(tempDir, "target-skill");
    await mkdir(targetDir, { recursive: true });
    await writeFile(join(targetDir, "SKILL.md"), "---\nname: sym-skill\ndescription: Symlinked\n---\n");
    await symlink(targetDir, join(skillsDir, "sym-skill"));

    const result = await scanSkills({ skillsDir, managedPath, skipPluginExclusion: true });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.skills).toHaveLength(1);
      expect(result.value.skills[0].name).toBe("sym-skill");
      expect(result.value.skills[0].type).toBe("symlink");
      expect(result.value.skills[0].symlinkTarget).toBe(targetDir);
      expect(result.value.skills[0].description).toBe("Symlinked");
    }
  });

  test("identifies git repo entries", async () => {
    const skillDir = join(skillsDir, "git-skill");
    await mkdir(skillDir, { recursive: true });
    await gitExec(["init"], skillDir);
    await writeFile(join(skillDir, "SKILL.md"), "---\nname: git-skill\ndescription: Git repo\n---\n");
    await gitExec(["add", "."], skillDir);
    await gitExec(["config", "user.email", "test@test.com"], skillDir);
    await gitExec(["config", "user.name", "Test"], skillDir);
    await gitExec(["commit", "-m", "init"], skillDir);

    const result = await scanSkills({ skillsDir, managedPath, skipPluginExclusion: true });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.skills).toHaveLength(1);
      expect(result.value.skills[0].name).toBe("git-skill");
      expect(result.value.skills[0].type).toBe("git-repo");
    }
  });

  test("discovers multiple unmanaged skills", async () => {
    await mkdir(join(skillsDir, "skill-a"), { recursive: true });
    await mkdir(join(skillsDir, "skill-b"), { recursive: true });
    await mkdir(join(skillsDir, "skill-c"), { recursive: true });

    const result = await scanSkills({ skillsDir, managedPath, skipPluginExclusion: true });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.skills).toHaveLength(3);
      const names = result.value.skills.map((s) => s.name).sort();
      expect(names).toEqual(["skill-a", "skill-b", "skill-c"]);
    }
  });
});

describe("scanSkills() multi-target", () => {
  test("scans multiple target directories", async () => {
    const target1 = join(tempDir, "target1", "skills");
    const target2 = join(tempDir, "target2", "skills");
    await mkdir(target1, { recursive: true });
    await mkdir(target2, { recursive: true });

    await mkdir(join(target1, "skill-a"), { recursive: true });
    await mkdir(join(target2, "skill-b"), { recursive: true });

    const result = await scanSkills({
      targets: { t1: target1, t2: target2 },
      skipPluginExclusion: true,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.skills).toHaveLength(2);
      const names = result.value.skills.map((s) => s.name).sort();
      expect(names).toEqual(["skill-a", "skill-b"]);
    }
  });

  test("deduplicates skills found in multiple targets", async () => {
    const target1 = join(tempDir, "target1", "skills");
    const target2 = join(tempDir, "target2", "skills");
    await mkdir(target1, { recursive: true });
    await mkdir(target2, { recursive: true });

    // Same skill in both targets
    await mkdir(join(target1, "shared-skill"), { recursive: true });
    await mkdir(join(target2, "shared-skill"), { recursive: true });

    const result = await scanSkills({
      targets: { t1: target1, t2: target2 },
      skipPluginExclusion: true,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.skills).toHaveLength(1);
      expect(result.value.skills[0].name).toBe("shared-skill");
      expect(result.value.skills[0].foundIn.sort()).toEqual(["t1", "t2"]);
    }
  });

  test("foundIn annotates which targets contain each skill", async () => {
    const target1 = join(tempDir, "target1", "skills");
    const target2 = join(tempDir, "target2", "skills");
    await mkdir(target1, { recursive: true });
    await mkdir(target2, { recursive: true });

    await mkdir(join(target1, "only-in-t1"), { recursive: true });
    await mkdir(join(target2, "only-in-t2"), { recursive: true });
    await mkdir(join(target1, "in-both"), { recursive: true });
    await mkdir(join(target2, "in-both"), { recursive: true });

    const result = await scanSkills({
      targets: { t1: target1, t2: target2 },
      skipPluginExclusion: true,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const byName = new Map(result.value.skills.map((s) => [s.name, s]));
      expect(byName.get("only-in-t1")?.foundIn).toEqual(["t1"]);
      expect(byName.get("only-in-t2")?.foundIn).toEqual(["t2"]);
      expect(byName.get("in-both")?.foundIn.sort()).toEqual(["t1", "t2"]);
    }
  });

  test("handles nonexistent target directory gracefully", async () => {
    const target1 = join(tempDir, "target1", "skills");
    await mkdir(target1, { recursive: true });
    await mkdir(join(target1, "skill-a"), { recursive: true });

    const result = await scanSkills({
      targets: { t1: target1, t2: join(tempDir, "nonexistent") },
      skipPluginExclusion: true,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.skills).toHaveLength(1);
      expect(result.value.skills[0].name).toBe("skill-a");
    }
  });
});

describe("scanSkills() plugin exclusion", () => {
  test("excludes plugin-managed skills from results", async () => {
    await mkdir(join(skillsDir, "plugin-skill"), { recursive: true });
    await mkdir(join(skillsDir, "normal-skill"), { recursive: true });

    const pluginsPath = join(tempDir, "installed_plugins.json");
    await writeFile(pluginsPath, JSON.stringify(["plugin-skill"]));

    const result = await scanSkills({
      skillsDir,
      managedPath,
      pluginOptions: {
        installedPluginsPath: pluginsPath,
        skillLockPath: join(tempDir, "nonexistent-lock.json"),
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.skills).toHaveLength(1);
      expect(result.value.skills[0].name).toBe("normal-skill");
      expect(result.value.excludedPluginCount).toBe(1);
    }
  });

  test("excludes skills from .skill-lock.json", async () => {
    await mkdir(join(skillsDir, "locked-skill"), { recursive: true });
    await mkdir(join(skillsDir, "free-skill"), { recursive: true });

    const lockPath = join(tempDir, ".skill-lock.json");
    await writeFile(lockPath, JSON.stringify(["locked-skill"]));

    const result = await scanSkills({
      skillsDir,
      managedPath,
      pluginOptions: {
        installedPluginsPath: join(tempDir, "nonexistent-plugins.json"),
        skillLockPath: lockPath,
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.skills).toHaveLength(1);
      expect(result.value.skills[0].name).toBe("free-skill");
      expect(result.value.excludedPluginCount).toBe(1);
    }
  });

  test("reports zero excluded count when no plugins match", async () => {
    await mkdir(join(skillsDir, "my-skill"), { recursive: true });

    const result = await scanSkills({
      skillsDir,
      managedPath,
      pluginOptions: {
        installedPluginsPath: join(tempDir, "nonexistent-plugins.json"),
        skillLockPath: join(tempDir, "nonexistent-lock.json"),
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.skills).toHaveLength(1);
      expect(result.value.excludedPluginCount).toBe(0);
    }
  });

  test("excludes plugins from multi-target scan", async () => {
    const target1 = join(tempDir, "target1");
    const target2 = join(tempDir, "target2");
    await mkdir(target1, { recursive: true });
    await mkdir(target2, { recursive: true });

    await mkdir(join(target1, "plugin-skill"), { recursive: true });
    await mkdir(join(target1, "normal-skill"), { recursive: true });
    await mkdir(join(target2, "plugin-skill"), { recursive: true });

    const pluginsPath = join(tempDir, "installed_plugins.json");
    await writeFile(pluginsPath, JSON.stringify(["plugin-skill"]));

    const result = await scanSkills({
      targets: { t1: target1, t2: target2 },
      pluginOptions: {
        installedPluginsPath: pluginsPath,
        skillLockPath: join(tempDir, "nonexistent-lock.json"),
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.skills).toHaveLength(1);
      expect(result.value.skills[0].name).toBe("normal-skill");
      expect(result.value.excludedPluginCount).toBe(1);
    }
  });
});

describe("adoptAsCore()", () => {
  test("adopts a directory as core skill", async () => {
    const skillDir = join(skillsDir, "my-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "---\nname: my-skill\n---\n");

    const result = await adoptAsCore("my-skill", {
      registryDir,
      skillsDir,
      managedPath,
    });
    expect(result.ok).toBe(true);

    // Verify skill was moved to registry
    const registrySkillMd = Bun.file(join(registryDir, "core", "my-skill", "SKILL.md"));
    expect(await registrySkillMd.exists()).toBe(true);
  });

  test("adopts a symlink as core skill", async () => {
    const targetDir = join(tempDir, "symlink-target");
    await mkdir(targetDir, { recursive: true });
    await writeFile(join(targetDir, "SKILL.md"), "---\nname: sym-skill\n---\nContent\n");
    await symlink(targetDir, join(skillsDir, "sym-skill"));

    const result = await adoptAsCore("sym-skill", {
      registryDir,
      skillsDir,
      managedPath,
    });
    expect(result.ok).toBe(true);

    // Verify skill was copied to registry
    const registrySkillMd = Bun.file(join(registryDir, "core", "sym-skill", "SKILL.md"));
    expect(await registrySkillMd.exists()).toBe(true);
  });

  test("returns error for non-existent skill", async () => {
    const result = await adoptAsCore("nonexistent", {
      registryDir,
      skillsDir,
      managedPath,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("not found");
    }
  });

  test("returns error for already managed skill", async () => {
    const skillDir = join(skillsDir, "managed-skill");
    await mkdir(skillDir, { recursive: true });

    await writeFile(
      managedPath,
      '[links.managed-skill]\ntarget = "/some/path"\n',
    );

    const result = await adoptAsCore("managed-skill", {
      registryDir,
      skillsDir,
      managedPath,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("already managed");
    }
  });
});

describe("adoptAsCore() multi-target sync", () => {
  test("creates symlinks in all targets after adoption", async () => {
    const target1 = join(tempDir, "target1");
    const target2 = join(tempDir, "target2");
    await mkdir(target1, { recursive: true });
    await mkdir(target2, { recursive: true });

    const skillDir = join(skillsDir, "my-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "---\nname: my-skill\n---\n");

    const syncHash = join(tempDir, ".sync-hash");
    const result = await adoptAsCore("my-skill", {
      registryDir,
      skillsDir,
      managedPath,
      targets: { t1: target1, t2: target2 },
      overrideSyncHashPath: syncHash,
    });

    expect(result.ok).toBe(true);

    // Verify symlinks in both targets
    const t1Link = await readlink(join(target1, "my-skill"));
    expect(t1Link).toBe(join(registryDir, "core", "my-skill"));

    const t2Link = await readlink(join(target2, "my-skill"));
    expect(t2Link).toBe(join(registryDir, "core", "my-skill"));

    // Verify managed state in both targets
    const managed1 = await readManaged(join(target1, ".asm-managed.toml"));
    expect(managed1.ok).toBe(true);
    if (managed1.ok) {
      expect(managed1.value.links["my-skill"]).toBeDefined();
    }

    const managed2 = await readManaged(join(target2, ".asm-managed.toml"));
    expect(managed2.ok).toBe(true);
    if (managed2.ok) {
      expect(managed2.value.links["my-skill"]).toBeDefined();
    }
  });
});

describe("adoptAsVendor()", () => {
  test("adopts a git repo with remote URL as vendor", async () => {
    // Create a fake remote repo
    const fakeRemote = join(tempDir, "fake-remote");
    await mkdir(fakeRemote, { recursive: true });
    await gitExec(["init"], fakeRemote);
    await gitExec(["config", "user.email", "test@test.com"], fakeRemote);
    await gitExec(["config", "user.name", "Test"], fakeRemote);
    await writeFile(join(fakeRemote, "SKILL.md"), "---\nname: vendor-skill\ndescription: Vendor\n---\n");
    await gitExec(["add", "."], fakeRemote);
    await gitExec(["commit", "-m", "init"], fakeRemote);

    // Place git repo in skills dir with remote set
    const skillDir = join(skillsDir, "vendor-skill");
    await mkdir(skillDir, { recursive: true });
    await gitExec(["init"], skillDir);
    await gitExec(["config", "user.email", "test@test.com"], skillDir);
    await gitExec(["config", "user.name", "Test"], skillDir);
    await writeFile(join(skillDir, "SKILL.md"), "---\nname: vendor-skill\n---\n");
    await gitExec(["add", "."], skillDir);
    await gitExec(["commit", "-m", "init"], skillDir);
    await gitExec(["remote", "add", "origin", `file://${fakeRemote}`], skillDir);

    const result = await adoptAsVendor("vendor-skill", {
      registryDir,
      skillsDir,
      managedPath,
    });
    expect(result.ok).toBe(true);

    // Verify in registry
    const registrySkillMd = Bun.file(join(registryDir, "vendor", "vendor-skill", "SKILL.md"));
    expect(await registrySkillMd.exists()).toBe(true);
  });

  test("returns error for skill without remote URL", async () => {
    const skillDir = join(skillsDir, "no-remote");
    await mkdir(skillDir, { recursive: true });

    const result = await adoptAsVendor("no-remote", {
      registryDir,
      skillsDir,
      managedPath,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("no remote URL");
    }
  });

  test("returns error for non-existent skill", async () => {
    const result = await adoptAsVendor("nonexistent", {
      registryDir,
      skillsDir,
      managedPath,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("not found");
    }
  });

  test("returns error for already managed skill", async () => {
    const skillDir = join(skillsDir, "managed-skill");
    await mkdir(skillDir, { recursive: true });

    await writeFile(
      managedPath,
      '[links.managed-skill]\ntarget = "/some/path"\n',
    );

    const result = await adoptAsVendor("managed-skill", {
      registryDir,
      skillsDir,
      managedPath,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("already managed");
    }
  });
});

describe("adoptAsVendor() multi-target sync", () => {
  test("creates symlinks in all targets after vendor adoption", async () => {
    const target1 = join(tempDir, "target1");
    const target2 = join(tempDir, "target2");
    await mkdir(target1, { recursive: true });
    await mkdir(target2, { recursive: true });

    // Create a fake remote repo
    const fakeRemote = join(tempDir, "fake-remote");
    await mkdir(fakeRemote, { recursive: true });
    await gitExec(["init"], fakeRemote);
    await gitExec(["config", "user.email", "test@test.com"], fakeRemote);
    await gitExec(["config", "user.name", "Test"], fakeRemote);
    await writeFile(join(fakeRemote, "SKILL.md"), "---\nname: vendor-skill\n---\n");
    await gitExec(["add", "."], fakeRemote);
    await gitExec(["commit", "-m", "init"], fakeRemote);

    const skillDir = join(skillsDir, "vendor-skill");
    await mkdir(skillDir, { recursive: true });
    await gitExec(["init"], skillDir);
    await gitExec(["config", "user.email", "test@test.com"], skillDir);
    await gitExec(["config", "user.name", "Test"], skillDir);
    await writeFile(join(skillDir, "SKILL.md"), "---\nname: vendor-skill\n---\n");
    await gitExec(["add", "."], skillDir);
    await gitExec(["commit", "-m", "init"], skillDir);
    await gitExec(["remote", "add", "origin", `file://${fakeRemote}`], skillDir);

    const syncHash = join(tempDir, ".sync-hash");
    const result = await adoptAsVendor("vendor-skill", {
      registryDir,
      skillsDir,
      managedPath,
      targets: { t1: target1, t2: target2 },
      overrideSyncHashPath: syncHash,
    });

    expect(result.ok).toBe(true);

    // Verify symlinks in both targets
    const t1Link = await readlink(join(target1, "vendor-skill"));
    expect(t1Link).toBe(join(registryDir, "vendor", "vendor-skill"));

    const t2Link = await readlink(join(target2, "vendor-skill"));
    expect(t2Link).toBe(join(registryDir, "vendor", "vendor-skill"));
  });
});

describe("adoptSkill() dispatch", () => {
  test("dispatches to adoptAsCore", async () => {
    const skillDir = join(skillsDir, "dispatch-core");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "---\nname: dispatch-core\n---\n");

    const result = await adoptSkill("dispatch-core", "core", {
      registryDir,
      skillsDir,
      managedPath,
    });
    expect(result.ok).toBe(true);

    // Verify it's in registry
    const registrySkillMd = Bun.file(join(registryDir, "core", "dispatch-core", "SKILL.md"));
    expect(await registrySkillMd.exists()).toBe(true);
  });

  test("dispatches to adoptAsVendor with error for no remote", async () => {
    const skillDir = join(skillsDir, "dispatch-vendor");
    await mkdir(skillDir, { recursive: true });

    const result = await adoptSkill("dispatch-vendor", "vendor", {
      registryDir,
      skillsDir,
      managedPath,
    });
    expect(result.ok).toBe(false);
  });
});
