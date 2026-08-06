import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { writeFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  asmrcPath,
  readRegistryPath,
  writeRegistryPath,
  asmTomlPath,
  syncHashPathInRegistry,
  registryPath,
  userSkillsDir,
  userCodexSkillsDir,
  userKiroSkillsDir,
  managedTomlPath,
  projectClaudeSkillsDir,
  projectCodexSkillsDir,
  projectSkillsTargets,
  projectSkillsTargetDirs,
} from "../../src/utils/paths";

let tempDir: string;
let originalHome: string | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "asm-paths-test-"));
  originalHome = process.env.HOME;
  process.env.HOME = tempDir;
});

afterEach(async () => {
  process.env.HOME = originalHome;
  await rm(tempDir, { recursive: true, force: true });
});

describe("asmrcPath()", () => {
  test("returns ~/.asmrc", () => {
    expect(asmrcPath()).toBe(join(tempDir, ".asmrc"));
  });
});

describe("readRegistryPath()", () => {
  test("reads registry path from ~/.asmrc", async () => {
    await writeFile(asmrcPath(), "/my/registry\n", "utf-8");

    const result = await readRegistryPath();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe("/my/registry");
    }
  });

  test("trims whitespace from .asmrc content", async () => {
    await writeFile(asmrcPath(), "  /my/registry  \n", "utf-8");

    const result = await readRegistryPath();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe("/my/registry");
    }
  });

  test("returns err when ~/.asmrc does not exist", async () => {
    const result = await readRegistryPath();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("not found");
    }
  });

  test("returns err when ~/.asmrc is empty", async () => {
    await writeFile(asmrcPath(), "", "utf-8");

    const result = await readRegistryPath();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("empty");
    }
  });
});

describe("writeRegistryPath()", () => {
  test("writes registry path to ~/.asmrc", async () => {
    const result = await writeRegistryPath("/my/registry");
    expect(result.ok).toBe(true);

    const readResult = await readRegistryPath();
    expect(readResult.ok).toBe(true);
    if (readResult.ok) {
      expect(readResult.value).toBe("/my/registry");
    }
  });
});

describe("asmTomlPath()", () => {
  test("returns <registryDir>/asm.toml", () => {
    expect(asmTomlPath("/my/registry")).toBe("/my/registry/asm.toml");
  });
});

describe("syncHashPathInRegistry()", () => {
  test("returns <registryDir>/.sync-hash", () => {
    expect(syncHashPathInRegistry("/my/registry")).toBe("/my/registry/.sync-hash");
  });
});

describe("registryPath()", () => {
  test("expands ~ in registry path", () => {
    const config = {
      registryPath: "~/Developer/agent-skills",
      defaultScope: "user" as const,
      targets: {},
      vendors: {},
    };
    expect(registryPath(config)).toBe(join(tempDir, "Developer", "agent-skills"));
  });

  test("returns absolute path as-is", () => {
    const config = {
      registryPath: "/opt/skills",
      defaultScope: "user" as const,
      targets: {},
      vendors: {},
    };
    expect(registryPath(config)).toBe("/opt/skills");
  });
});

describe("userSkillsDir()", () => {
  test("returns ~/.claude/skills", () => {
    expect(userSkillsDir()).toBe(join(tempDir, ".claude", "skills"));
  });
});

describe("userCodexSkillsDir()", () => {
  test("returns ~/.agents/skills", () => {
    expect(userCodexSkillsDir()).toBe(join(tempDir, ".agents", "skills"));
  });
});

describe("userKiroSkillsDir()", () => {
  test("returns ~/.kiro/skills", () => {
    expect(userKiroSkillsDir()).toBe(join(tempDir, ".kiro", "skills"));
  });
});

describe("managedTomlPath()", () => {
  test("returns .asm-managed.toml in target dir", () => {
    expect(managedTomlPath("/some/project")).toBe("/some/project/.asm-managed.toml");
  });
});

describe("projectClaudeSkillsDir()", () => {
  test("returns <project>/.claude/skills", () => {
    expect(projectClaudeSkillsDir("/some/project")).toBe("/some/project/.claude/skills");
  });
});

describe("projectCodexSkillsDir()", () => {
  test("returns <project>/.agents/skills", () => {
    expect(projectCodexSkillsDir("/some/project")).toBe("/some/project/.agents/skills");
  });
});

describe("projectSkillsTargets()", () => {
  test("pairs each project target with its corresponding global target", () => {
    expect(projectSkillsTargets("/some/project")).toEqual([
      {
        targetDir: "/some/project/.claude/skills",
        globalDir: join(tempDir, ".claude", "skills"),
      },
      {
        targetDir: "/some/project/.agents/skills",
        globalDir: join(tempDir, ".agents", "skills"),
      },
    ]);
  });
});

describe("projectSkillsTargetDirs()", () => {
  test("returns claude and codex project target dirs in stable order", () => {
    expect(projectSkillsTargetDirs("/some/project")).toEqual([
      "/some/project/.claude/skills",
      "/some/project/.agents/skills",
    ]);
  });
});
