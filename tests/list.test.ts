import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { scanRegistry } from "../src/core/registry";

describe("list command — registry scan", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "asm-list-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("empty registry returns empty skills", async () => {
    const registryDir = join(tmpDir, "registry");
    await mkdir(join(registryDir, "core"), { recursive: true });
    await mkdir(join(registryDir, "vendor"), { recursive: true });

    const skills = await scanRegistry(registryDir);
    expect(skills.ok).toBe(true);
    if (skills.ok) {
      expect(skills.value).toHaveLength(0);
    }
  });

  test("lists skills from core/ and vendor/ directories", async () => {
    const registryDir = join(tmpDir, "registry");

    // Create core skill
    await mkdir(join(registryDir, "core", "my-skill"), { recursive: true });
    await writeFile(
      join(registryDir, "core", "my-skill", "SKILL.md"),
      "---\nname: my-skill\ndescription: A core skill\n---\n",
    );

    // Create vendor skill
    await mkdir(join(registryDir, "vendor", "another-skill"), { recursive: true });
    await writeFile(
      join(registryDir, "vendor", "another-skill", "SKILL.md"),
      "---\nname: another-skill\ndescription: A vendor skill\n---\n",
    );

    const skills = await scanRegistry(registryDir);
    expect(skills.ok).toBe(true);
    if (skills.ok) {
      expect(skills.value).toHaveLength(2);

      const mySkill = skills.value.find((s) => s.name === "my-skill");
      expect(mySkill).toBeDefined();
      expect(mySkill!.type).toBe("core");
      expect(mySkill!.description).toBe("A core skill");

      const another = skills.value.find((s) => s.name === "another-skill");
      expect(another).toBeDefined();
      expect(another!.type).toBe("vendor");
      expect(another!.description).toBe("A vendor skill");
    }
  });

  test("handles missing core/ or vendor/ directories gracefully", async () => {
    const registryDir = join(tmpDir, "registry");
    await mkdir(registryDir, { recursive: true });
    // No core/ or vendor/ directories

    const skills = await scanRegistry(registryDir);
    expect(skills.ok).toBe(true);
    if (skills.ok) {
      expect(skills.value).toHaveLength(0);
    }
  });

  test("reads description from SKILL.md frontmatter", async () => {
    const registryDir = join(tmpDir, "registry");
    await mkdir(join(registryDir, "core", "desc-skill"), { recursive: true });
    await writeFile(
      join(registryDir, "core", "desc-skill", "SKILL.md"),
      "---\nname: desc-skill\ndescription: This is the description\n---\n\nContent here\n",
    );

    const skills = await scanRegistry(registryDir);
    expect(skills.ok).toBe(true);
    if (skills.ok) {
      expect(skills.value[0].description).toBe("This is the description");
    }
  });

  test("vendor repo with multiple skills discovers all of them", async () => {
    const registryDir = join(tmpDir, "registry");
    const repoDir = join(registryDir, "vendor", "multi-repo");
    await mkdir(join(repoDir, "skills", "skill-one"), { recursive: true });
    await mkdir(join(repoDir, "skills", "skill-two"), { recursive: true });
    await writeFile(
      join(repoDir, "skills", "skill-one", "SKILL.md"),
      "---\nname: skill-one\ndescription: First skill\n---\n",
    );
    await writeFile(
      join(repoDir, "skills", "skill-two", "SKILL.md"),
      "---\nname: skill-two\ndescription: Second skill\n---\n",
    );

    const skills = await scanRegistry(registryDir);
    expect(skills.ok).toBe(true);
    if (skills.ok) {
      const one = skills.value.find((s) => s.name === "skill-one");
      expect(one).toBeDefined();
      expect(one!.type).toBe("vendor");
      expect(one!.sourcePath).toBe(join(repoDir, "skills", "skill-one"));
      expect(one!.description).toBe("First skill");

      const two = skills.value.find((s) => s.name === "skill-two");
      expect(two).toBeDefined();
      expect(two!.type).toBe("vendor");
      expect(two!.description).toBe("Second skill");
    }
  });
});
