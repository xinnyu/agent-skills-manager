import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { gitExec, gitRevision } from "../src/utils/git";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "asm-git-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("gitExec()", () => {
  test("runs a successful git command", async () => {
    const proc = Bun.spawn(["git", "init"], { cwd: tempDir, stdout: "pipe", stderr: "pipe" });
    await proc.exited;

    const result = await gitExec(["status"], tempDir);
    expect(result.ok).toBe(true);
  });

  test("returns error for invalid git command", async () => {
    const result = await gitExec(["not-a-real-command"], tempDir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("not-a-real-command");
    }
  });

  test("returns error when not in a git repo", async () => {
    const result = await gitExec(["log"], tempDir);
    expect(result.ok).toBe(false);
  });
});

describe("gitRevision()", () => {
  test("returns short hash after commit", async () => {
    Bun.spawn(["git", "init"], { cwd: tempDir, stdout: "pipe", stderr: "pipe" });
    await Bun.spawn(["git", "init"], { cwd: tempDir, stdout: "pipe", stderr: "pipe" }).exited;
    await Bun.write(join(tempDir, "file.txt"), "content");
    await Bun.spawn(["git", "add", "."], { cwd: tempDir, stdout: "pipe", stderr: "pipe" }).exited;
    await Bun.spawn(["git", "commit", "-m", "init", "--author", "Test <test@test.com>"], {
      cwd: tempDir,
      stdout: "pipe",
      stderr: "pipe",
    }).exited;

    const result = await gitRevision(tempDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.length).toBeGreaterThan(0);
      expect(result.value.length).toBeLessThanOrEqual(12);
    }
  });

  test("returns error in empty repo with no commits", async () => {
    await Bun.spawn(["git", "init"], { cwd: tempDir, stdout: "pipe", stderr: "pipe" }).exited;
    const result = await gitRevision(tempDir);
    expect(result.ok).toBe(false);
  });
});
