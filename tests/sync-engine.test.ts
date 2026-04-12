import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, readlink, symlink, lstat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { syncSkills } from "../src/core/sync-engine";
import { readManaged } from "../src/core/managed";

let tempDir: string;
let registryDir: string;
let targetDir: string;
let syncHash: string;
let managedPath: string;
let originalHome: string | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "asm-sync-test-"));
  originalHome = process.env.HOME;
  process.env.HOME = tempDir;
  registryDir = join(tempDir, "registry");
  targetDir = join(tempDir, "skills");
  syncHash = join(registryDir, ".sync-hash");
  managedPath = join(targetDir, ".asm-managed.toml");

  // Create registry structure with skills
  await mkdir(join(registryDir, "vendor", "my-skill"), { recursive: true });
  await writeFile(join(registryDir, "vendor", "my-skill", "SKILL.md"), "---\nname: my-skill\ndescription: Test vendor\n---\n");
  await mkdir(join(registryDir, "core", "local-skill"), { recursive: true });
  await mkdir(targetDir, { recursive: true });
});

afterEach(async () => {
  process.env.HOME = originalHome;
  await rm(tempDir, { recursive: true, force: true });
});

function syncOpts() {
  return {
    registryDir,
    targets: { test: targetDir },
    overrideSyncHashPath: syncHash,
  };
}

describe("syncSkills()", () => {
  test("creates symlinks for all registry skills", async () => {
    const result = await syncSkills(syncOpts());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.skipped).toBe(false);
    }

    const vendorTarget = await readlink(join(targetDir, "my-skill"));
    expect(vendorTarget).toBe(join(registryDir, "vendor", "my-skill"));

    const coreTarget = await readlink(join(targetDir, "local-skill"));
    expect(coreTarget).toBe(join(registryDir, "core", "local-skill"));

    const managed = await readManaged(managedPath);
    expect(managed.ok).toBe(true);
    if (managed.ok) {
      expect(managed.value.links["my-skill"]).toBeDefined();
      expect(managed.value.links["local-skill"]).toBeDefined();
    }
  });

  test("removes symlinks for skills no longer in registry", async () => {
    // First sync with two skills
    await syncSkills(syncOpts());

    // Remove one skill from registry
    await rm(join(registryDir, "vendor", "my-skill"), { recursive: true, force: true });

    const result = await syncSkills(syncOpts());
    expect(result.ok).toBe(true);

    // my-skill symlink should be gone
    let exists = true;
    try {
      await lstat(join(targetDir, "my-skill"));
    } catch {
      exists = false;
    }
    expect(exists).toBe(false);

    // local-skill should still exist
    const coreTarget = await readlink(join(targetDir, "local-skill"));
    expect(coreTarget).toBe(join(registryDir, "core", "local-skill"));

    const managed = await readManaged(managedPath);
    expect(managed.ok).toBe(true);
    if (managed.ok) {
      expect(managed.value.links["my-skill"]).toBeUndefined();
      expect(managed.value.links["local-skill"]).toBeDefined();
    }
  });

  test("idempotent: double sync produces same result", async () => {
    await syncSkills(syncOpts());

    const result = await syncSkills(syncOpts());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.skipped).toBe(true);
    }

    const target = await readlink(join(targetDir, "my-skill"));
    expect(target).toBe(join(registryDir, "vendor", "my-skill"));
  });

  test("ownership protection: non-managed symlinks untouched", async () => {
    const externalTarget = join(tempDir, "external");
    await mkdir(externalTarget, { recursive: true });
    await symlink(externalTarget, join(targetDir, "external-skill"));

    await syncSkills(syncOpts());

    const target = await readlink(join(targetDir, "external-skill"));
    expect(target).toBe(externalTarget);
  });

  test("fast-path skips when hash matches", async () => {
    await syncSkills(syncOpts());

    const result = await syncSkills(syncOpts());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.skipped).toBe(true);
    }
  });

  test("self-healing: deleted managed symlink is restored", async () => {
    await syncSkills(syncOpts());

    const { unlink } = await import("node:fs/promises");
    await unlink(join(targetDir, "my-skill"));

    const result = await syncSkills(syncOpts());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.skipped).toBe(false);
    }

    const target = await readlink(join(targetDir, "my-skill"));
    expect(target).toBe(join(registryDir, "vendor", "my-skill"));
  });

  test("broken symlink (wrong target) gets fixed", async () => {
    await syncSkills(syncOpts());

    const { unlink } = await import("node:fs/promises");
    await unlink(join(targetDir, "my-skill"));
    await symlink("/wrong/target", join(targetDir, "my-skill"));

    const result = await syncSkills(syncOpts());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.skipped).toBe(false);
    }

    const target = await readlink(join(targetDir, "my-skill"));
    expect(target).toBe(join(registryDir, "vendor", "my-skill"));
  });

  test("multi-target: syncs to multiple target directories", async () => {
    const target2 = join(tempDir, "skills2");
    await mkdir(target2, { recursive: true });

    const result = await syncSkills({
      registryDir,
      targets: { t1: targetDir, t2: target2 },
      overrideSyncHashPath: syncHash,
    });

    expect(result.ok).toBe(true);

    // Both targets should have symlinks
    const t1Link = await readlink(join(targetDir, "my-skill"));
    expect(t1Link).toBe(join(registryDir, "vendor", "my-skill"));

    const t2Link = await readlink(join(target2, "my-skill"));
    expect(t2Link).toBe(join(registryDir, "vendor", "my-skill"));

    // Both should have managed state
    const managed1 = await readManaged(join(targetDir, ".asm-managed.toml"));
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

  test("empty targets: returns skipped", async () => {
    const result = await syncSkills({
      registryDir,
      targets: {},
      overrideSyncHashPath: syncHash,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.skipped).toBe(true);
    }
  });

  test("manifest validation: required skill not in registry returns error", async () => {
    const projectDir = join(tempDir, "project");
    await mkdir(join(projectDir, ".asm"), { recursive: true });
    await writeFile(join(projectDir, ".asm", "skills.toml"), 'required = ["missing-skill"]\n');

    const result = await syncSkills({
      ...syncOpts(),
      cwd: projectDir,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("missing-skill");
      expect(result.error).toContain("not installed");
    }
  });

  test("project manifest syncs skills to both claude and codex project directories", async () => {
    const projectDir = join(tempDir, "project");
    const projectClaudeDir = join(projectDir, ".claude", "skills");
    const projectCodexDir = join(projectDir, ".agents", "skills");
    await mkdir(join(tempDir, ".asm"), { recursive: true });
    await writeFile(join(tempDir, ".asm", "skills.toml"), 'required = ["local-skill"]\n');
    await mkdir(join(projectDir, ".asm"), { recursive: true });
    await writeFile(join(projectDir, ".asm", "skills.toml"), 'required = ["my-skill"]\n');

    const result = await syncSkills({
      ...syncOpts(),
      cwd: projectDir,
    });

    expect(result.ok).toBe(true);

    const claudeTarget = await readlink(join(projectClaudeDir, "my-skill"));
    expect(claudeTarget).toBe(join(registryDir, "vendor", "my-skill"));

    const codexTarget = await readlink(join(projectCodexDir, "my-skill"));
    expect(codexTarget).toBe(join(registryDir, "vendor", "my-skill"));

    const claudeManaged = await readManaged(join(projectClaudeDir, ".asm-managed.toml"));
    expect(claudeManaged.ok).toBe(true);
    if (claudeManaged.ok) {
      expect(claudeManaged.value.links["my-skill"]).toBeDefined();
    }

    const codexManaged = await readManaged(join(projectCodexDir, ".asm-managed.toml"));
    expect(codexManaged.ok).toBe(true);
    if (codexManaged.ok) {
      expect(codexManaged.value.links["my-skill"]).toBeDefined();
    }
  });

  test("stale project managed links are cleaned up from both project directories after manifest removal", async () => {
    const projectDir = join(tempDir, "project");
    const projectSubdir = join(projectDir, "nested");
    const projectClaudeDir = join(projectDir, ".claude", "skills");
    const projectCodexDir = join(projectDir, ".agents", "skills");
    const manifestDir = join(projectDir, ".asm");
    const manifestPath = join(manifestDir, "skills.toml");
    await mkdir(manifestDir, { recursive: true });
    await mkdir(projectSubdir, { recursive: true });
    await writeFile(manifestPath, 'required = ["my-skill"]\n');

    const initial = await syncSkills({
      ...syncOpts(),
      cwd: projectDir,
    });
    expect(initial.ok).toBe(true);

    await rm(manifestPath, { force: true });

    const result = await syncSkills({
      ...syncOpts(),
      cwd: projectSubdir,
    });
    expect(result.ok).toBe(true);

    let claudeExists = true;
    try {
      await lstat(join(projectClaudeDir, "my-skill"));
    } catch {
      claudeExists = false;
    }
    expect(claudeExists).toBe(false);

    let codexExists = true;
    try {
      await lstat(join(projectCodexDir, "my-skill"));
    } catch {
      codexExists = false;
    }
    expect(codexExists).toBe(false);
  });

  test("project manifest dedupes only the matching global agent target", async () => {
    const projectDir = join(tempDir, "project");
    const projectClaudeDir = join(projectDir, ".claude", "skills");
    const projectCodexDir = join(projectDir, ".agents", "skills");
    await mkdir(join(tempDir, ".asm"), { recursive: true });
    await writeFile(join(tempDir, ".asm", "skills.toml"), 'required = ["my-skill"]\n');
    await mkdir(join(projectDir, ".asm"), { recursive: true });
    await writeFile(join(projectDir, ".asm", "skills.toml"), 'required = ["my-skill"]\n');
    const globalClaudeDir = join(tempDir, ".claude", "skills");
    await mkdir(globalClaudeDir, { recursive: true });

    const result = await syncSkills({
      registryDir,
      targets: { claude: globalClaudeDir },
      overrideSyncHashPath: syncHash,
      cwd: projectDir,
    });

    expect(result.ok).toBe(true);

    const globalTarget = await readlink(join(globalClaudeDir, "my-skill"));
    expect(globalTarget).toBe(join(registryDir, "vendor", "my-skill"));

    let projectClaudeExists = true;
    try {
      await lstat(join(projectClaudeDir, "my-skill"));
    } catch {
      projectClaudeExists = false;
    }
    expect(projectClaudeExists).toBe(false);

    const projectCodexTarget = await readlink(join(projectCodexDir, "my-skill"));
    expect(projectCodexTarget).toBe(join(registryDir, "vendor", "my-skill"));
  });

  test("project manifest skips both project targets when both global agent targets already contain the skill", async () => {
    const projectDir = join(tempDir, "project");
    const projectClaudeDir = join(projectDir, ".claude", "skills");
    const projectCodexDir = join(projectDir, ".agents", "skills");
    const globalClaudeDir = join(tempDir, ".claude", "skills");
    const globalCodexDir = join(tempDir, ".agents", "skills");
    await mkdir(join(tempDir, ".asm"), { recursive: true });
    await writeFile(join(tempDir, ".asm", "skills.toml"), 'required = ["my-skill"]\n');
    await mkdir(join(projectDir, ".asm"), { recursive: true });
    await writeFile(join(projectDir, ".asm", "skills.toml"), 'required = ["my-skill"]\n');
    await mkdir(globalClaudeDir, { recursive: true });
    await mkdir(globalCodexDir, { recursive: true });

    const result = await syncSkills({
      registryDir,
      targets: { claude: globalClaudeDir, codex: globalCodexDir },
      overrideSyncHashPath: syncHash,
      cwd: projectDir,
    });

    expect(result.ok).toBe(true);
    expect(await readlink(join(globalClaudeDir, "my-skill"))).toBe(join(registryDir, "vendor", "my-skill"));
    expect(await readlink(join(globalCodexDir, "my-skill"))).toBe(join(registryDir, "vendor", "my-skill"));

    let projectClaudeExists = true;
    try {
      await lstat(join(projectClaudeDir, "my-skill"));
    } catch {
      projectClaudeExists = false;
    }
    expect(projectClaudeExists).toBe(false);

    let projectCodexExists = true;
    try {
      await lstat(join(projectCodexDir, "my-skill"));
    } catch {
      projectCodexExists = false;
    }
    expect(projectCodexExists).toBe(false);
  });

  test("vendor repo with multiple skills registers each one", async () => {
    // Create a vendor repo containing two skills in subdirectories
    const repoDir = join(registryDir, "vendor", "multi-repo");
    await mkdir(join(repoDir, "skills", "skill-alpha"), { recursive: true });
    await mkdir(join(repoDir, "skills", "skill-beta"), { recursive: true });
    await writeFile(join(repoDir, "skills", "skill-alpha", "SKILL.md"), "---\nname: skill-alpha\ndescription: Alpha\n---\n");
    await writeFile(join(repoDir, "skills", "skill-beta", "SKILL.md"), "---\nname: skill-beta\ndescription: Beta\n---\n");

    const result = await syncSkills(syncOpts());
    expect(result.ok).toBe(true);

    const alphaTarget = await readlink(join(targetDir, "skill-alpha"));
    expect(alphaTarget).toBe(join(repoDir, "skills", "skill-alpha"));

    const betaTarget = await readlink(join(targetDir, "skill-beta"));
    expect(betaTarget).toBe(join(repoDir, "skills", "skill-beta"));
  });
});
