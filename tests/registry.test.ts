import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { detectSkillPath, readRegistryMeta, updateRegistryMeta } from "../src/core/registry";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "asm-registry-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("detectSkillPath()", () => {
  test("returns '.' when SKILL.md is at root", async () => {
    await writeFile(join(tempDir, "SKILL.md"), "# Skill");
    const result = await detectSkillPath(tempDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(".");
    }
  });

  test("returns subdirectory name when SKILL.md is in a subdirectory", async () => {
    await mkdir(join(tempDir, "src"));
    await writeFile(join(tempDir, "src", "SKILL.md"), "# Skill");
    const result = await detectSkillPath(tempDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe("src");
    }
  });

  test("excludes node_modules", async () => {
    await mkdir(join(tempDir, "node_modules"));
    await writeFile(join(tempDir, "node_modules", "SKILL.md"), "# Skill");
    const result = await detectSkillPath(tempDir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("No SKILL.md found");
    }
  });

  test("excludes tests directory", async () => {
    await mkdir(join(tempDir, "tests"));
    await writeFile(join(tempDir, "tests", "SKILL.md"), "# Skill");
    const result = await detectSkillPath(tempDir);
    expect(result.ok).toBe(false);
  });

  test("excludes test directory", async () => {
    await mkdir(join(tempDir, "test"));
    await writeFile(join(tempDir, "test", "SKILL.md"), "# Skill");
    const result = await detectSkillPath(tempDir);
    expect(result.ok).toBe(false);
  });

  test("excludes examples directory", async () => {
    await mkdir(join(tempDir, "examples"));
    await writeFile(join(tempDir, "examples", "SKILL.md"), "# Skill");
    const result = await detectSkillPath(tempDir);
    expect(result.ok).toBe(false);
  });

  test("excludes hidden directories", async () => {
    await mkdir(join(tempDir, ".hidden"));
    await writeFile(join(tempDir, ".hidden", "SKILL.md"), "# Skill");
    const result = await detectSkillPath(tempDir);
    expect(result.ok).toBe(false);
  });

  test("returns error when no SKILL.md found", async () => {
    const result = await detectSkillPath(tempDir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("No SKILL.md found");
    }
  });

  test("returns error for nonexistent directory", async () => {
    const result = await detectSkillPath(join(tempDir, "nonexistent"));
    expect(result.ok).toBe(false);
  });
});

describe("readRegistryMeta()", () => {
  test("returns empty meta when asm.toml does not exist", async () => {
    const result = await readRegistryMeta(tempDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({});
    }
  });

  test("reads skill_path from asm.toml", async () => {
    await writeFile(join(tempDir, "asm.toml"), 'skill_path = "src"\n');
    const result = await readRegistryMeta(tempDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.skillPath).toBe("src");
    }
  });

  test("returns error for invalid skill_path type", async () => {
    await writeFile(join(tempDir, "asm.toml"), "skill_path = 42\n");
    const result = await readRegistryMeta(tempDir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Invalid skill_path");
    }
  });
});

describe("updateRegistryMeta()", () => {
  test("writes skillPath to asm.toml", async () => {
    const result = await updateRegistryMeta(tempDir, { skillPath: "lib" });
    expect(result.ok).toBe(true);

    const meta = await readRegistryMeta(tempDir);
    expect(meta.ok).toBe(true);
    if (meta.ok) {
      expect(meta.value.skillPath).toBe("lib");
    }
  });

  test("updates existing asm.toml", async () => {
    await writeFile(join(tempDir, "asm.toml"), 'skill_path = "old"\n');
    const result = await updateRegistryMeta(tempDir, { skillPath: "new" });
    expect(result.ok).toBe(true);

    const meta = await readRegistryMeta(tempDir);
    expect(meta.ok).toBe(true);
    if (meta.ok) {
      expect(meta.value.skillPath).toBe("new");
    }
  });
});
