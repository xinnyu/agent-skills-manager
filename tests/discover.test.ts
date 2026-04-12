import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { discoverSkills } from "../src/core/discover";
import { runCli, gitInit } from "./e2e/helpers";

let tempDir: string;
let originalHome: string | undefined;

async function writeSkill(
  skillDir: string,
  description?: string,
): Promise<void> {
  await mkdir(skillDir, { recursive: true });

  const frontmatter = description
    ? `---\nname: ${basename(skillDir)}\ndescription: ${description}\n---\n`
    : `---\nname: ${basename(skillDir)}\n---\n`;

  await writeFile(join(skillDir, "SKILL.md"), `${frontmatter}\nContent\n`, "utf-8");
}

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "asm-discover-test-"));
  originalHome = process.env.HOME;
  process.env.HOME = tempDir;
});

afterEach(async () => {
  process.env.HOME = originalHome;
  await rm(tempDir, { recursive: true, force: true });
});

describe("discoverSkills()", () => {
  test("defaults to the user home root and discovers claude and codex skills recursively", async () => {
    const claudeSkillDir = join(tempDir, "Developer", "proj-a", ".claude", "skills", "alpha");
    const codexSkillDir = join(tempDir, "Projects", "proj-b", ".agents", "skills", "beta");
    const externalSkillDir = join(tempDir, "external-skill");
    const symlinkSkillPath = join(tempDir, "Sandbox", "proj-c", ".claude", "skills", "gamma");

    await writeSkill(claudeSkillDir, "Alpha description");
    await writeSkill(codexSkillDir, "Beta description");
    await gitInit(codexSkillDir);
    await writeSkill(externalSkillDir, "Gamma description");

    await mkdir(join(tempDir, "Sandbox", "proj-c", ".claude", "skills"), { recursive: true });
    await symlink(externalSkillDir, symlinkSkillPath);

    const result = await discoverSkills();

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toHaveLength(3);

    const byName = new Map(result.value.map((skill) => [skill.name, skill]));
    expect(byName.get("alpha")).toMatchObject({
      kind: "claude",
      type: "directory",
      description: "Alpha description",
      path: claudeSkillDir,
    });
    expect(byName.get("beta")).toMatchObject({
      kind: "codex",
      type: "git-repo",
      description: "Beta description",
      path: codexSkillDir,
    });
    expect(byName.get("gamma")).toMatchObject({
      kind: "claude",
      type: "symlink",
      description: "Gamma description",
      path: symlinkSkillPath,
    });
  });

  test("filters managed skills and returns empty results for nonexistent roots", async () => {
    const skillsDir = join(tempDir, "Workspace", "proj-a", ".claude", "skills");
    await writeSkill(join(skillsDir, "managed-skill"), "Managed");
    await writeSkill(join(skillsDir, "free-skill"));
    await writeFile(
      join(skillsDir, ".asm-managed.toml"),
      '[links.managed-skill]\ntarget = "/registry/core/managed-skill"\n',
      "utf-8",
    );

    const result = await discoverSkills({
      roots: [join(tempDir, "Workspace"), join(tempDir, "does-not-exist")],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toHaveLength(1);
    expect(result.value[0]).toMatchObject({
      name: "free-skill",
      kind: "claude",
      type: "directory",
      description: undefined,
    });
  });

  test("skips node_modules, .git, and Library while scanning roots", async () => {
    await writeSkill(join(tempDir, "node_modules", "pkg", ".claude", "skills", "ignored-node"), "skip");
    await writeSkill(join(tempDir, ".git", "repo", ".agents", "skills", "ignored-git"), "skip");
    await writeSkill(join(tempDir, "Library", "Stuff", ".claude", "skills", "ignored-library"), "skip");
    await writeSkill(join(tempDir, "Work", "proj", ".agents", "skills", "kept-skill"), "keep");

    const result = await discoverSkills({ roots: [tempDir] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toHaveLength(1);
    expect(result.value[0]).toMatchObject({
      name: "kept-skill",
      kind: "codex",
    });
  });
});

describe("discover command", () => {
  test("prints a table by default", async () => {
    await writeSkill(
      join(tempDir, "Projects", "proj-a", ".claude", "skills", "table-skill"),
      "Shown in table",
    );

    const result = await runCli(["discover"], tempDir);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("NAME");
    expect(result.stdout).toContain("KIND");
    expect(result.stdout).toContain("TYPE");
    expect(result.stdout).toContain("table-skill");
    expect(result.stdout).toContain("Shown in table");
  });

  test("supports --json and trims, filters, and expands --roots entries", async () => {
    await writeSkill(
      join(tempDir, "Developer", "proj-a", ".agents", "skills", "json-skill"),
      "Shown in json",
    );

    const result = await runCli(
      ["discover", "--json", "--roots", " ~/Developer , ~/Missing ,  , "],
      tempDir,
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");

    const parsed = JSON.parse(result.stdout) as Array<Record<string, string>>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      name: "json-skill",
      kind: "codex",
      type: "directory",
      description: "Shown in json",
    });
  });

  test("treats an empty --roots value as an empty root list", async () => {
    await writeSkill(
      join(tempDir, "Developer", "proj-a", ".claude", "skills", "home-skill"),
      "Hidden by empty roots",
    );

    const result = await runCli(["discover", "--json", "--roots", ""], tempDir);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual([]);
  });
});
