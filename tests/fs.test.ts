import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, lstat, readlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureDir, createSymlink, removeSymlink, readSymlinkTarget } from "../src/utils/fs";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "asm-fs-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("ensureDir()", () => {
  test("creates a new directory", async () => {
    const dir = join(tempDir, "newdir");
    const result = await ensureDir(dir);
    expect(result.ok).toBe(true);

    const stat = await lstat(dir);
    expect(stat.isDirectory()).toBe(true);
  });

  test("succeeds if directory already exists", async () => {
    const dir = join(tempDir, "existing");
    await ensureDir(dir);
    const result = await ensureDir(dir);
    expect(result.ok).toBe(true);
  });

  test("creates nested directories", async () => {
    const dir = join(tempDir, "a", "b", "c");
    const result = await ensureDir(dir);
    expect(result.ok).toBe(true);

    const stat = await lstat(dir);
    expect(stat.isDirectory()).toBe(true);
  });
});

describe("createSymlink()", () => {
  test("creates a symbolic link", async () => {
    const source = join(tempDir, "source");
    const target = join(tempDir, "link");
    await writeFile(source, "content");

    const result = await createSymlink(source, target);
    expect(result.ok).toBe(true);

    const linkTarget = await readlink(target);
    expect(linkTarget).toBe(source);
  });

  test("replaces existing symlink", async () => {
    const source1 = join(tempDir, "source1");
    const source2 = join(tempDir, "source2");
    const target = join(tempDir, "link");
    await writeFile(source1, "one");
    await writeFile(source2, "two");

    await createSymlink(source1, target);
    const result = await createSymlink(source2, target);
    expect(result.ok).toBe(true);

    const linkTarget = await readlink(target);
    expect(linkTarget).toBe(source2);
  });
});

describe("removeSymlink()", () => {
  test("removes an existing symlink", async () => {
    const source = join(tempDir, "source");
    const target = join(tempDir, "link");
    await writeFile(source, "content");
    await createSymlink(source, target);

    const result = await removeSymlink(target);
    expect(result.ok).toBe(true);
  });

  test("succeeds if symlink does not exist", async () => {
    const result = await removeSymlink(join(tempDir, "nonexistent"));
    expect(result.ok).toBe(true);
  });

  test("returns error if path is a regular file", async () => {
    const file = join(tempDir, "regular");
    await writeFile(file, "content");

    const result = await removeSymlink(file);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("not a symbolic link");
    }
  });
});

describe("readSymlinkTarget()", () => {
  test("reads target of a symlink", async () => {
    const source = join(tempDir, "source");
    const target = join(tempDir, "link");
    await writeFile(source, "content");
    await createSymlink(source, target);

    const result = await readSymlinkTarget(target);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(source);
    }
  });

  test("returns error for non-existent path", async () => {
    const result = await readSymlinkTarget(join(tempDir, "nope"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Symlink not found");
    }
  });
});
