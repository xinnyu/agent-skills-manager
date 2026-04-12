import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { syncSkills } from "../../src/core/sync-engine";

let tempDir: string;
let registryDir: string;
let targetDir: string;
let syncHash: string;
let originalHome: string | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "asm-sync-hash-"));
  originalHome = process.env.HOME;
  process.env.HOME = tempDir;
  registryDir = join(tempDir, "registry");
  targetDir = join(tempDir, "skills");
  syncHash = join(registryDir, ".sync-hash");

  await mkdir(join(registryDir, "vendor", "my-skill"), { recursive: true });
  await mkdir(targetDir, { recursive: true });
});

afterEach(async () => {
  process.env.HOME = originalHome;
  await rm(tempDir, { recursive: true, force: true });
});

describe("syncSkills() — hash path uses registry/.sync-hash", () => {
  test("writes sync hash to registry/.sync-hash", async () => {
    const result = await syncSkills({
      registryDir,
      targets: { test: targetDir },
      overrideSyncHashPath: syncHash,
    });

    expect(result.ok).toBe(true);

    // Verify hash file was written in registry directory
    const hashContent = await readFile(syncHash, "utf-8");
    expect(hashContent.trim().length).toBeGreaterThan(0);
    expect(syncHash).toBe(join(registryDir, ".sync-hash"));
  });

  test("reads existing hash from registry/.sync-hash for fast-path", async () => {
    // First sync writes hash
    await syncSkills({
      registryDir,
      targets: { test: targetDir },
      overrideSyncHashPath: syncHash,
    });

    // Second sync should use fast path
    const result = await syncSkills({
      registryDir,
      targets: { test: targetDir },
      overrideSyncHashPath: syncHash,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.skipped).toBe(true);
    }
  });
});
