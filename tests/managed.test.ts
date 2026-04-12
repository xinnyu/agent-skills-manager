import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readManaged, writeManaged, addManagedEntry, removeManagedEntry } from "../src/core/managed";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "asm-managed-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("readManaged()", () => {
  test("returns empty state for missing file", async () => {
    const result = await readManaged(join(tempDir, "nonexistent.toml"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.links).toEqual({});
    }
  });

  test("reads valid managed state", async () => {
    const path = join(tempDir, "managed.toml");
    await writeFile(
      path,
      `[links.my-skill]
target = "/path/to/skill"
`,
    );

    const result = await readManaged(path);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.links["my-skill"]).toEqual({ target: "/path/to/skill" });
    }
  });

  test("returns error for invalid TOML", async () => {
    const path = join(tempDir, "managed.toml");
    await writeFile(path, "{{invalid}}");
    const result = await readManaged(path);
    expect(result.ok).toBe(false);
  });
});

describe("writeManaged()", () => {
  test("read/write roundtrip preserves data", async () => {
    const path = join(tempDir, "managed.toml");

    const state = {
      links: {
        "skill-a": { target: "/path/a" },
        "skill-b": { target: "/path/b" },
      },
    };

    const writeResult = await writeManaged(path, state);
    expect(writeResult.ok).toBe(true);

    const readResult = await readManaged(path);
    expect(readResult.ok).toBe(true);
    if (readResult.ok) {
      expect(readResult.value).toEqual(state);
    }
  });
});

describe("addManagedEntry()", () => {
  test("adds entry to empty file", async () => {
    const path = join(tempDir, "managed.toml");

    const result = await addManagedEntry(path, "new-skill", { target: "/path/new" });
    expect(result.ok).toBe(true);

    const state = await readManaged(path);
    expect(state.ok).toBe(true);
    if (state.ok) {
      expect(state.value.links["new-skill"]).toEqual({ target: "/path/new" });
    }
  });

  test("preserves existing entries when adding", async () => {
    const path = join(tempDir, "managed.toml");

    await addManagedEntry(path, "skill-a", { target: "/path/a" });
    await addManagedEntry(path, "skill-b", { target: "/path/b" });

    const state = await readManaged(path);
    expect(state.ok).toBe(true);
    if (state.ok) {
      expect(Object.keys(state.value.links)).toHaveLength(2);
      expect(state.value.links["skill-a"]).toEqual({ target: "/path/a" });
      expect(state.value.links["skill-b"]).toEqual({ target: "/path/b" });
    }
  });
});

describe("removeManagedEntry()", () => {
  test("removes entry and preserves others", async () => {
    const path = join(tempDir, "managed.toml");

    await addManagedEntry(path, "skill-a", { target: "/path/a" });
    await addManagedEntry(path, "skill-b", { target: "/path/b" });

    const result = await removeManagedEntry(path, "skill-a");
    expect(result.ok).toBe(true);

    const state = await readManaged(path);
    expect(state.ok).toBe(true);
    if (state.ok) {
      expect(state.value.links["skill-a"]).toBeUndefined();
      expect(state.value.links["skill-b"]).toEqual({ target: "/path/b" });
    }
  });

  test("removing nonexistent entry is idempotent", async () => {
    const path = join(tempDir, "managed.toml");
    await addManagedEntry(path, "skill-a", { target: "/path/a" });

    const result = await removeManagedEntry(path, "nonexistent");
    expect(result.ok).toBe(true);

    const state = await readManaged(path);
    expect(state.ok).toBe(true);
    if (state.ok) {
      expect(Object.keys(state.value.links)).toHaveLength(1);
    }
  });
});
