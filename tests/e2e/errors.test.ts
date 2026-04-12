import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { addCoreSkill } from "../../src/core/add";
import { initRegistry } from "../../src/core/registry";
import { createTestEnv, cleanupTestEnv, gitInit } from "./helpers";
import type { TestEnv } from "./helpers";

let env: TestEnv;
let originalHome: string | undefined;

beforeEach(async () => {
  env = await createTestEnv();
  originalHome = process.env.HOME;
  process.env.HOME = env.testDir;
});

afterEach(async () => {
  process.env.HOME = originalHome;
  await cleanupTestEnv(env.testDir);
});

describe("error paths", () => {
  test("add duplicate skill returns error indicating already exists", async () => {
    await gitInit(env.registryDir);
    await initRegistry(env.registryDir);

    const first = await addCoreSkill("duped", env.registryDir, { targets: { test: env.skillsDir } });
    expect(first.ok).toBe(true);

    const second = await addCoreSkill("duped", env.registryDir, { targets: { test: env.skillsDir } });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error).toContain("duped");
      expect(second.error).toContain("already exists");
    }
  });

  test("add skill with invalid name returns validation error", async () => {
    await gitInit(env.registryDir);
    await initRegistry(env.registryDir);

    const result = await addCoreSkill("Invalid_Name!", env.registryDir, { targets: { test: env.skillsDir } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Invalid skill name");
      expect(result.error).toContain("Invalid_Name!");
    }
  });
});
