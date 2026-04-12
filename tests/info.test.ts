import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { scanRegistry } from "../src/core/registry";

describe("info command — core logic (registry scan)", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "asm-info-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("returns detailed info for installed skill", async () => {
    const registryDir = join(tmpDir, "registry");
    await mkdir(join(registryDir, "vendor", "my-skill"), { recursive: true });
    await writeFile(
      join(registryDir, "vendor", "my-skill", "SKILL.md"),
      "---\nname: my-skill\ndescription: A vendor skill\n---\n",
    );

    const skills = await scanRegistry(registryDir);
    expect(skills.ok).toBe(true);
    if (skills.ok) {
      const skill = skills.value.find((s) => s.name === "my-skill");
      expect(skill).toBeDefined();
      expect(skill!.type).toBe("vendor");
      expect(skill!.description).toBe("A vendor skill");
    }
  });

  test("skill not found in registry", async () => {
    const registryDir = join(tmpDir, "registry");
    await mkdir(join(registryDir, "core"), { recursive: true });
    await mkdir(join(registryDir, "vendor"), { recursive: true });

    const skills = await scanRegistry(registryDir);
    expect(skills.ok).toBe(true);
    if (skills.ok) {
      const skill = skills.value.find((s) => s.name === "nonexistent");
      expect(skill).toBeUndefined();
    }
  });

  test("returns info for core skill with description", async () => {
    const registryDir = join(tmpDir, "registry");
    await mkdir(join(registryDir, "core", "simple-skill"), { recursive: true });
    await writeFile(
      join(registryDir, "core", "simple-skill", "SKILL.md"),
      "---\nname: simple-skill\ndescription: A simple core skill\n---\n",
    );

    const skills = await scanRegistry(registryDir);
    expect(skills.ok).toBe(true);
    if (skills.ok) {
      const skill = skills.value.find((s) => s.name === "simple-skill");
      expect(skill).toBeDefined();
      expect(skill!.type).toBe("core");
      expect(skill!.description).toBe("A simple core skill");
    }
  });
});
