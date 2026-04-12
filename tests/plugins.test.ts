import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getPluginManagedSkills } from "../src/utils/plugins";

let tempDir: string;
let pluginsPath: string;
let lockPath: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "asm-plugins-test-"));
  pluginsPath = join(tempDir, "installed_plugins.json");
  lockPath = join(tempDir, ".skill-lock.json");
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function noPlugins() {
  return join(tempDir, "nonexistent-plugins.json");
}

function noLock() {
  return join(tempDir, "nonexistent-lock.json");
}

describe("getPluginManagedSkills()", () => {
  describe("installed_plugins.json formats", () => {
    test("reads from current format (object with plugins map)", async () => {
      await writeFile(pluginsPath, JSON.stringify({
        version: 2,
        plugins: {
          "skill-a@marketplace": [{ scope: "user" }],
          "skill-b@other": [{ scope: "user" }],
        },
      }));

      const result = await getPluginManagedSkills({
        installedPluginsPath: pluginsPath,
        skillLockPath: noLock(),
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.sort()).toEqual(["skill-a", "skill-b"]);
      }
    });

    test("reads from legacy format (string array)", async () => {
      await writeFile(pluginsPath, JSON.stringify(["skill-a", "skill-b"]));

      const result = await getPluginManagedSkills({
        installedPluginsPath: pluginsPath,
        skillLockPath: noLock(),
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(["skill-a", "skill-b"]);
      }
    });

    test("reads from legacy format (object array with name)", async () => {
      await writeFile(pluginsPath, JSON.stringify([
        { name: "skill-a", version: "1.0" },
        { name: "skill-b" },
      ]));

      const result = await getPluginManagedSkills({
        installedPluginsPath: pluginsPath,
        skillLockPath: noLock(),
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(["skill-a", "skill-b"]);
      }
    });
  });

  describe(".skill-lock.json formats", () => {
    test("reads from current format (object with skills map)", async () => {
      await writeFile(lockPath, JSON.stringify({
        version: 3,
        skills: {
          "lock-skill-x": { source: "foo/bar" },
          "lock-skill-y": { source: "baz/qux" },
        },
      }));

      const result = await getPluginManagedSkills({
        installedPluginsPath: noPlugins(),
        skillLockPath: lockPath,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.sort()).toEqual(["lock-skill-x", "lock-skill-y"]);
      }
    });

    test("reads from legacy format (string array)", async () => {
      await writeFile(lockPath, JSON.stringify(["lock-skill-x"]));

      const result = await getPluginManagedSkills({
        installedPluginsPath: noPlugins(),
        skillLockPath: lockPath,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(["lock-skill-x"]);
      }
    });
  });

  describe("merging and deduplication", () => {
    test("merges and deduplicates from both files", async () => {
      await writeFile(pluginsPath, JSON.stringify({
        version: 2,
        plugins: {
          "skill-a@mp": [],
          "skill-b@mp": [],
        },
      }));
      await writeFile(lockPath, JSON.stringify({
        version: 3,
        skills: {
          "skill-b": {},
          "skill-c": {},
        },
      }));

      const result = await getPluginManagedSkills({
        installedPluginsPath: pluginsPath,
        skillLockPath: lockPath,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.sort()).toEqual(["skill-a", "skill-b", "skill-c"]);
      }
    });
  });

  describe("edge cases", () => {
    test("returns empty array when files do not exist (ENOENT)", async () => {
      const result = await getPluginManagedSkills({
        installedPluginsPath: noPlugins(),
        skillLockPath: noLock(),
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([]);
      }
    });

    test("returns error on invalid JSON", async () => {
      await writeFile(pluginsPath, "not valid json {{{");

      const result = await getPluginManagedSkills({
        installedPluginsPath: pluginsPath,
        skillLockPath: noLock(),
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("Invalid JSON");
      }
    });

    test("returns error when data is neither array nor valid object", async () => {
      await writeFile(pluginsPath, JSON.stringify("just a string"));

      const result = await getPluginManagedSkills({
        installedPluginsPath: pluginsPath,
        skillLockPath: noLock(),
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("expected an array or object");
      }
    });

    test("handles empty plugins/skills objects", async () => {
      await writeFile(pluginsPath, JSON.stringify({ version: 2, plugins: {} }));
      await writeFile(lockPath, JSON.stringify({ version: 3, skills: {} }));

      const result = await getPluginManagedSkills({
        installedPluginsPath: pluginsPath,
        skillLockPath: lockPath,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([]);
      }
    });

    test("handles empty arrays (legacy format)", async () => {
      await writeFile(pluginsPath, JSON.stringify([]));
      await writeFile(lockPath, JSON.stringify([]));

      const result = await getPluginManagedSkills({
        installedPluginsPath: pluginsPath,
        skillLockPath: lockPath,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([]);
      }
    });

    test("trims whitespace from skill names", async () => {
      await writeFile(pluginsPath, JSON.stringify(["  skill-a  ", "skill-b"]));

      const result = await getPluginManagedSkills({
        installedPluginsPath: pluginsPath,
        skillLockPath: noLock(),
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(["skill-a", "skill-b"]);
      }
    });

    test("skips empty string entries in legacy format", async () => {
      await writeFile(pluginsPath, JSON.stringify(["skill-a", "", "  ", "skill-b"]));

      const result = await getPluginManagedSkills({
        installedPluginsPath: pluginsPath,
        skillLockPath: noLock(),
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(["skill-a", "skill-b"]);
      }
    });
  });
});
