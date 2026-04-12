import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readToml, writeToml } from "../src/utils/toml";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "asm-toml-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("readToml()", () => {
  test("reads and parses valid TOML", async () => {
    const path = join(tempDir, "test.toml");
    await Bun.write(path, 'name = "hello"\ncount = 42\n');

    const result = await readToml(path);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("hello");
      expect(result.value.count).toBe(42);
    }
  });

  test("returns error for non-existent file", async () => {
    const result = await readToml(join(tempDir, "nope.toml"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("File not found");
    }
  });

  test("returns error for invalid TOML", async () => {
    const path = join(tempDir, "bad.toml");
    await Bun.write(path, "this is not valid toml {{{}}}");

    const result = await readToml(path);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Failed to parse TOML");
    }
  });

  test("handles empty file", async () => {
    const path = join(tempDir, "empty.toml");
    await Bun.write(path, "");

    const result = await readToml(path);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({});
    }
  });
});

describe("writeToml()", () => {
  test("writes valid TOML", async () => {
    const path = join(tempDir, "out.toml");
    const result = await writeToml(path, { name: "test", count: 10 });

    expect(result.ok).toBe(true);
    const content = await readFile(path, "utf-8");
    expect(content).toContain("name");
    expect(content).toContain("test");
  });

  test("creates parent directories", async () => {
    const path = join(tempDir, "nested", "deep", "config.toml");
    const result = await writeToml(path, { key: "value" });

    expect(result.ok).toBe(true);
    const content = await readFile(path, "utf-8");
    expect(content).toContain("key");
  });

  test("overwrites existing file", async () => {
    const path = join(tempDir, "overwrite.toml");
    await writeToml(path, { old: "data" });
    await writeToml(path, { new: "data" });

    const content = await readFile(path, "utf-8");
    expect(content).toContain("new");
    expect(content).not.toContain("old");
  });
});
