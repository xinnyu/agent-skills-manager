import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile, readlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkUpgrades, upgradeSkills } from "../src/core/upgrade";
import { gitExec } from "../src/utils/git";

async function initBareRepo(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await gitExec(["init", "--bare"], dir);
}

async function initWorkRepo(dir: string, bareUrl: string): Promise<void> {
  await gitExec(["clone", bareUrl, dir]);
  await gitExec(["config", "user.email", "test@test.com"], dir);
  await gitExec(["config", "user.name", "Test"], dir);
}

describe("upgrade — checkUpgrades()", () => {
  let tmpDir: string;
  let bareDir: string;
  let registryDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "asm-upgrade-test-"));
    bareDir = join(tmpDir, "bare");
    registryDir = join(tmpDir, "registry");

    // Create a bare repo to act as remote
    await initBareRepo(bareDir);

    // Create the registry with a vendor submodule clone
    await mkdir(join(registryDir, "vendor"), { recursive: true });
    await mkdir(join(registryDir, "core"), { recursive: true });
    await initWorkRepo(join(registryDir, "vendor", "test-skill"), bareDir);

    // Make an initial commit in the vendor skill
    const skillDir = join(registryDir, "vendor", "test-skill");
    await writeFile(join(skillDir, "README.md"), "initial", "utf-8");
    await writeFile(join(skillDir, "SKILL.md"), "---\nname: test-skill\ndescription: Test\n---\n", "utf-8");
    await gitExec(["add", "."], skillDir);
    await gitExec(["commit", "-m", "initial commit"], skillDir);
    await gitExec(["push", "origin", "HEAD"], skillDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("detects available update", async () => {
    // Create a new commit in the bare repo via a temp clone
    const updateClone = join(tmpDir, "update-clone");
    await initWorkRepo(updateClone, bareDir);
    await writeFile(join(updateClone, "update.txt"), "new content", "utf-8");
    await gitExec(["add", "."], updateClone);
    await gitExec(["commit", "-m", "add update"], updateClone);
    await gitExec(["push", "origin", "HEAD"], updateClone);

    const result = await checkUpgrades(registryDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0].name).toBe("test-skill");
      expect(result.value[0].currentRef).toBeTruthy();
      expect(result.value[0].remoteRef).toBeTruthy();
      expect(result.value[0].currentRef).not.toBe(result.value[0].remoteRef);
    }
  });

  test("dry-run does not execute upgrade", async () => {
    const skillDir = join(registryDir, "vendor", "test-skill");

    // Create a new commit in the bare repo
    const updateClone = join(tmpDir, "update-clone2");
    await initWorkRepo(updateClone, bareDir);
    await writeFile(join(updateClone, "dry-run.txt"), "test", "utf-8");
    await gitExec(["add", "."], updateClone);
    await gitExec(["commit", "-m", "dry-run test"], updateClone);
    await gitExec(["push", "origin", "HEAD"], updateClone);

    // Get current ref before dry-run
    const beforeRef = await gitExec(["rev-parse", "HEAD"], skillDir);
    expect(beforeRef.ok).toBe(true);

    const result = await upgradeSkills({
      dryRun: true,
      overrideRegistryPath: registryDir,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
    }

    // Verify HEAD hasn't changed
    const afterRef = await gitExec(["rev-parse", "HEAD"], skillDir);
    expect(afterRef.ok).toBe(true);
    if (beforeRef.ok && afterRef.ok) {
      expect(afterRef.value).toBe(beforeRef.value);
    }
  });

  test("no update available returns empty array", async () => {
    const result = await checkUpgrades(registryDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(0);
    }
  });

  test("skips core skills (only checks vendor)", async () => {
    // Add a core skill directory (should be ignored by upgrade)
    await mkdir(join(registryDir, "core", "core-skill"), { recursive: true });

    const result = await checkUpgrades(registryDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Should only check vendor skills, not core
      expect(result.value).toHaveLength(0);
    }
  });
});

/**
 * The fixtures above put SKILL.md at the vendor repo root, where the skill name
 * happens to equal the repo name — which hides the bug entirely. Real vendors
 * ship their skills in subdirectories (skills/<name>/SKILL.md) and often ship
 * several per repo, so the git unit must be the repo, not the skill.
 */
describe("upgrade — repo is the git unit, not the skill", () => {
  let tmpDir: string;
  let bareDir: string;
  let registryDir: string;
  let repoDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "asm-upgrade-nested-"));
    bareDir = join(tmpDir, "bare");
    registryDir = join(tmpDir, "registry");
    repoDir = join(registryDir, "vendor", "acme-skills");

    await initBareRepo(bareDir);
    await mkdir(join(registryDir, "vendor"), { recursive: true });
    await mkdir(join(registryDir, "core"), { recursive: true });
    await initWorkRepo(repoDir, bareDir);

    // Two skills, both in subdirectories, neither named after the repo.
    for (const name of ["alpha-skill", "beta-skill"]) {
      const dir = join(repoDir, "skills", name);
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, "SKILL.md"),
        `---\nname: ${name}\ndescription: Test ${name}\n---\n`,
        "utf-8",
      );
    }
    await gitExec(["add", "."], repoDir);
    await gitExec(["commit", "-m", "initial commit"], repoDir);
    await gitExec(["push", "origin", "HEAD"], repoDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("reports the repo once, not once per contained skill", async () => {
    const updateClone = join(tmpDir, "update-clone");
    await initWorkRepo(updateClone, bareDir);
    await writeFile(join(updateClone, "update.txt"), "new", "utf-8");
    await gitExec(["add", "."], updateClone);
    await gitExec(["commit", "-m", "add update"], updateClone);
    await gitExec(["push", "origin", "HEAD"], updateClone);

    const result = await checkUpgrades(registryDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Before the fix this threw ENOENT posix_spawn 'git' — it tried to run git
    // in vendor/alpha-skill, which does not exist.
    expect(result.value).toHaveLength(1);
    expect(result.value[0].name).toBe("acme-skills");
  });

  test("actually fast-forwards the repo on apply", async () => {
    const beforeRef = await gitExec(["rev-parse", "HEAD"], repoDir);
    expect(beforeRef.ok).toBe(true);

    const updateClone = join(tmpDir, "update-clone2");
    await initWorkRepo(updateClone, bareDir);
    await writeFile(join(updateClone, "update.txt"), "new", "utf-8");
    await gitExec(["add", "."], updateClone);
    await gitExec(["commit", "-m", "add update"], updateClone);
    const pushed = await gitExec(["rev-parse", "HEAD"], updateClone);
    await gitExec(["push", "origin", "HEAD"], updateClone);

    // upgradeSkills syncs afterwards, and sync validates the *user* manifest —
    // without this the test reads the developer's real ~/.asm/skills.toml.
    const originalHome = process.env.HOME;
    process.env.HOME = tmpDir;
    try {
      await writeFile(join(tmpDir, ".asmrc"), registryDir + "\n", "utf-8");
      const result = await upgradeSkills({ overrideRegistryPath: registryDir });
      expect(result.ok).toBe(true);
    } finally {
      process.env.HOME = originalHome;
    }

    const afterRef = await gitExec(["rev-parse", "HEAD"], repoDir);
    expect(afterRef.ok).toBe(true);
    if (beforeRef.ok && afterRef.ok && pushed.ok) {
      expect(afterRef.value).not.toBe(beforeRef.value);
      expect(afterRef.value).toBe(pushed.value);
    }
  });

  test("a non-git vendor does not abort the sweep", async () => {
    // A declared-but-uninitialized submodule, or a local path vendor whose
    // target is gone: previously the first one killed the whole run.
    await mkdir(join(registryDir, "vendor", "empty-vendor", "skills", "ghost"), {
      recursive: true,
    });
    await writeFile(
      join(registryDir, "vendor", "empty-vendor", "skills", "ghost", "SKILL.md"),
      "---\nname: ghost\ndescription: Not a git repo\n---\n",
      "utf-8",
    );

    const updateClone = join(tmpDir, "update-clone3");
    await initWorkRepo(updateClone, bareDir);
    await writeFile(join(updateClone, "update.txt"), "new", "utf-8");
    await gitExec(["add", "."], updateClone);
    await gitExec(["commit", "-m", "add update"], updateClone);
    await gitExec(["push", "origin", "HEAD"], updateClone);

    const result = await checkUpgrades(registryDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // The healthy repo is still reported despite the broken sibling.
      expect(result.value.map((u) => u.name)).toEqual(["acme-skills"]);
    }
  });
});

describe("upgrade — post-upgrade sync", () => {
  let tmpDir: string;
  let bareDir: string;
  let registryDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "asm-upgrade-sync-test-"));
    bareDir = join(tmpDir, "bare");
    registryDir = join(tmpDir, "registry");

    await initBareRepo(bareDir);
    await mkdir(join(registryDir, "vendor"), { recursive: true });
    await mkdir(join(registryDir, "core"), { recursive: true });
    await initWorkRepo(join(registryDir, "vendor", "test-skill"), bareDir);

    const skillDir = join(registryDir, "vendor", "test-skill");
    await writeFile(join(skillDir, "README.md"), "initial", "utf-8");
    await writeFile(join(skillDir, "SKILL.md"), "---\nname: test-skill\ndescription: Test\n---\n", "utf-8");
    await gitExec(["add", "."], skillDir);
    await gitExec(["commit", "-m", "initial commit"], skillDir);
    await gitExec(["push", "origin", "HEAD"], skillDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("calls sync after upgrading vendor skills", async () => {
    // Create target directories
    const target1 = join(tmpDir, "target1");
    const target2 = join(tmpDir, "target2");
    await mkdir(target1, { recursive: true });
    await mkdir(target2, { recursive: true });

    // Create asm.toml with targets
    const asmToml = join(registryDir, "asm.toml");
    await writeFile(
      asmToml,
      `[config]\ndefault_scope = "user"\n\n[targets]\nt1 = "${target1}"\nt2 = "${target2}"\n`,
    );

    // Create a new commit in the bare repo via a temp clone
    const updateClone = join(tmpDir, "update-clone");
    await initWorkRepo(updateClone, bareDir);
    await writeFile(join(updateClone, "update.txt"), "new content", "utf-8");
    await gitExec(["add", "."], updateClone);
    await gitExec(["commit", "-m", "add update"], updateClone);
    await gitExec(["push", "origin", "HEAD"], updateClone);

    // Point HOME to tmpDir so .asmrc writes don't pollute real home
    const originalHome = process.env.HOME;
    process.env.HOME = tmpDir;

    try {
      await writeFile(join(tmpDir, ".asmrc"), registryDir + "\n", "utf-8");

      const result = await upgradeSkills({
        overrideRegistryPath: registryDir,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
      }

      // Verify sync created symlinks in both targets
      const t1Link = await readlink(join(target1, "test-skill"));
      expect(t1Link).toBe(join(registryDir, "vendor", "test-skill"));

      const t2Link = await readlink(join(target2, "test-skill"));
      expect(t2Link).toBe(join(registryDir, "vendor", "test-skill"));
    } finally {
      process.env.HOME = originalHome;
    }
  });
});
