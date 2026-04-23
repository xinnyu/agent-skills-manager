import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  asmrcPath,
  registryPath,
  userSkillsDir,
  userCodexSkillsDir,
  userKiroSkillsDir,
  managedTomlPath,
  asmTomlPath,
  syncHashPathInRegistry,
} from "../src/utils/paths";

const HOME = homedir();

describe("asmrcPath()", () => {
  test("returns ~/.asmrc", () => {
    expect(asmrcPath()).toBe(join(HOME, ".asmrc"));
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
    expect(registryPath(config)).toBe(join(HOME, "Developer", "agent-skills"));
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
    expect(userSkillsDir()).toBe(join(HOME, ".claude", "skills"));
  });
});

describe("userCodexSkillsDir()", () => {
  test("returns ~/.agents/skills", () => {
    expect(userCodexSkillsDir()).toBe(join(HOME, ".agents", "skills"));
  });
});

describe("userKiroSkillsDir()", () => {
  test("returns ~/.kiro/skills", () => {
    expect(userKiroSkillsDir()).toBe(join(HOME, ".kiro", "skills"));
  });
});

describe("managedTomlPath()", () => {
  test("returns .asm-managed.toml in target dir", () => {
    expect(managedTomlPath("/some/project")).toBe("/some/project/.asm-managed.toml");
  });

  test("works with relative path", () => {
    expect(managedTomlPath("./mydir")).toBe("mydir/.asm-managed.toml");
  });
});
