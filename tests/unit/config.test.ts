import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readConfig } from "../../src/core/config";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "asm-config-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("readConfig() — reading <registry>/asm.toml", () => {
  test("returns defaults when asm.toml does not exist", async () => {
    const result = await readConfig(join(tempDir, "asm.toml"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.defaultScope).toBe("user");
      expect(result.value.targets).toEqual({
        claude: "~/.claude/skills",
        codex: "~/.agents/skills",
        kiro: "~/.kiro/skills",
      });
      expect(result.value.vendors).toEqual({});
    }
  });

  test("reads [config] section", async () => {
    const path = join(tempDir, "asm.toml");
    await writeFile(path, '[config]\ndefault_scope = "project"\n');

    const result = await readConfig(path);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.defaultScope).toBe("project");
    }
  });

  test("reads [targets] section", async () => {
    const path = join(tempDir, "asm.toml");
    await writeFile(path, '[config]\n\n[targets]\nclaude = "~/.claude/skills"\ncodex = "~/.codex/skills"\n');

    const result = await readConfig(path);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.targets.claude).toBe("~/.claude/skills");
      expect(result.value.targets.codex).toBe("~/.codex/skills");
      expect(result.value.targets.kiro).toBe("~/.kiro/skills");
    }
  });

  test("reads [vendor.*] sections", async () => {
    const path = join(tempDir, "asm.toml");
    await writeFile(path, '[config]\n\n[vendor.my-skill]\nurl = "https://github.com/test/skill.git"\n');

    const result = await readConfig(path);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.vendors["my-skill"]).toEqual({
        url: "https://github.com/test/skill.git",
      });
    }
  });

  test("reads all three sections together", async () => {
    const path = join(tempDir, "asm.toml");
    await writeFile(
      path,
      `[config]
default_scope = "project"

[targets]
claude = "~/.claude/skills"

[vendor.my-vendor]
url = "https://github.com/test/skill.git"
`,
    );

    const result = await readConfig(path);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.defaultScope).toBe("project");
      expect(result.value.targets.claude).toBe("~/.claude/skills");
      expect(result.value.targets.codex).toBe("~/.agents/skills");
      expect(result.value.targets.kiro).toBe("~/.kiro/skills");
      expect(result.value.vendors["my-vendor"].url).toBe("https://github.com/test/skill.git");
    }
  });
});

describe("readConfig() — defaults when sections missing", () => {
  test("returns defaults for empty file", async () => {
    const path = join(tempDir, "asm.toml");
    await writeFile(path, "");

    const result = await readConfig(path);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.defaultScope).toBe("user");

      expect(result.value.targets).toEqual({
        claude: "~/.claude/skills",
        codex: "~/.agents/skills",
        kiro: "~/.kiro/skills",
      });
      expect(result.value.vendors).toEqual({});
    }
  });

  test("returns defaults when [config] section missing", async () => {
    const path = join(tempDir, "asm.toml");
    await writeFile(path, '[targets]\nclaude = "~/.claude/skills"\n');

    const result = await readConfig(path);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.defaultScope).toBe("user");

      expect(result.value.targets.claude).toBe("~/.claude/skills");
      expect(result.value.targets.codex).toBe("~/.agents/skills");
      expect(result.value.targets.kiro).toBe("~/.kiro/skills");
    }
  });

  test("backfills default targets when [targets] section is missing", async () => {
    const path = join(tempDir, "asm.toml");
    await writeFile(path, "[config]\n");

    const result = await readConfig(path);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.targets).toEqual({
        claude: "~/.claude/skills",
        codex: "~/.agents/skills",
        kiro: "~/.kiro/skills",
      });
    }
  });

  test("backfills missing default targets into existing [targets]", async () => {
    const path = join(tempDir, "asm.toml");
    await writeFile(path, '[config]\n\n[targets]\nclaude = "~/.claude/skills"\n');

    const result = await readConfig(path);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.targets).toEqual({
        claude: "~/.claude/skills",
        codex: "~/.agents/skills",
        kiro: "~/.kiro/skills",
      });
    }
  });
});

describe("readConfig() — boundary input validation", () => {
  test("returns error for invalid TOML syntax", async () => {
    const path = join(tempDir, "asm.toml");
    await writeFile(path, "{{invalid toml}}");

    const result = await readConfig(path);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Failed to parse TOML");
    }
  });

  test("returns error for invalid scope value", async () => {
    const path = join(tempDir, "asm.toml");
    await writeFile(path, '[config]\ndefault_scope = "global"\n');

    const result = await readConfig(path);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Invalid scope");
    }
  });

  test("returns error for wrong type in target value", async () => {
    const path = join(tempDir, "asm.toml");
    await writeFile(path, "[targets]\nclaude = 42\n");

    const result = await readConfig(path);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Invalid target");
    }
  });

  test("returns error when [config] is not a table", async () => {
    const path = join(tempDir, "asm.toml");
    await writeFile(path, 'config = "bad"\n');

    const result = await readConfig(path);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Invalid [config]");
    }
  });

  test("returns error when path is a directory", async () => {
    const dirPath = join(tempDir, "asm.toml");
    await mkdir(dirPath);

    const result = await readConfig(dirPath);
    expect(result.ok).toBe(false);
  });
});
