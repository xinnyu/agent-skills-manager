import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, stat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initRegistry } from "../src/core/registry";
import { asmrcPath } from "../src/utils/paths";

let tempDir: string;
let originalHome: string | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "asm-init-test-"));
  originalHome = process.env.HOME;
  process.env.HOME = tempDir;
});

afterEach(async () => {
  process.env.HOME = originalHome;
  await rm(tempDir, { recursive: true, force: true });
});

describe("initRegistry()", () => {
  test("creates registry directory with core/ and vendor/ subdirs", async () => {
    const registryDir = join(tempDir, "my-registry");
    const result = await initRegistry(registryDir);
    expect(result.ok).toBe(true);

    const coreStat = await stat(join(registryDir, "core"));
    expect(coreStat.isDirectory()).toBe(true);

    const vendorStat = await stat(join(registryDir, "vendor"));
    expect(vendorStat.isDirectory()).toBe(true);
  });

  test("initializes git repo", async () => {
    const registryDir = join(tempDir, "git-registry");
    await initRegistry(registryDir);

    const gitStat = await stat(join(registryDir, ".git"));
    expect(gitStat.isDirectory()).toBe(true);
  });

  test("writes ~/.asmrc with registry path", async () => {
    const registryDir = join(tempDir, "config-registry");
    const result = await initRegistry(registryDir);
    expect(result.ok).toBe(true);

    const asmrcContent = await readFile(asmrcPath(), "utf-8");
    expect(asmrcContent.trim()).toBe(registryDir);
  });

  test("works with already existing directory", async () => {
    const registryDir = join(tempDir, "existing");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(registryDir, { recursive: true });

    const result = await initRegistry(registryDir);
    expect(result.ok).toBe(true);
  });

  test("does not re-init git if already a git repo", async () => {
    const registryDir = join(tempDir, "git-existing");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(registryDir, { recursive: true });

    const { gitExec } = await import("../src/utils/git");
    await gitExec(["init"], registryDir);

    const result = await initRegistry(registryDir);
    expect(result.ok).toBe(true);
  });

  test("creates nested directories when path does not exist", async () => {
    const registryDir = join(tempDir, "deep", "nested", "registry");
    const result = await initRegistry(registryDir);
    expect(result.ok).toBe(true);

    const s = await stat(registryDir);
    expect(s.isDirectory()).toBe(true);
  });
});
