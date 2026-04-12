import { readFile, writeFile } from "node:fs/promises";
import { homedir as osHomedir } from "node:os";
import { join } from "node:path";

import type { AsmConfig, Result } from "../types";
import { ok, err } from "./result";

export interface ProjectSkillsTarget {
  targetDir: string;
  globalDir: string;
}

/** Resolve home directory, respecting runtime HOME overrides */
function homedir(): string {
  return process.env.HOME || osHomedir();
}

export function expandHome(p: string): string {
  if (p.startsWith("~/")) {
    return join(homedir(), p.slice(2));
  }
  return p;
}

/** ~/.asmrc */
export function asmrcPath(): string {
  return join(homedir(), ".asmrc");
}

/** Read the registry absolute path from ~/.asmrc */
export async function readRegistryPath(): Promise<Result<string>> {
  const rcPath = asmrcPath();
  let content: string;
  try {
    content = await readFile(rcPath, "utf-8");
  } catch (e: unknown) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return err(`~/.asmrc not found. Run "asm init" first.`);
    }
    return err(`Failed to read ${rcPath}: ${String(e)}`);
  }

  const trimmed = content.trim();
  if (!trimmed) {
    return err("~/.asmrc is empty");
  }

  return ok(trimmed);
}

/** Write the registry absolute path to ~/.asmrc */
export async function writeRegistryPath(registryDir: string): Promise<Result<void>> {
  const rcPath = asmrcPath();
  try {
    await writeFile(rcPath, registryDir + "\n", "utf-8");
  } catch (e: unknown) {
    return err(`Failed to write ${rcPath}: ${String(e)}`);
  }
  return ok(undefined);
}

/** ~/.asm/skills.toml — user-level manifest */
export function userManifestPath(): string {
  return join(homedir(), ".asm", "skills.toml");
}

/** <registryDir>/asm.toml */
export function asmTomlPath(registryDir: string): string {
  return join(registryDir, "asm.toml");
}

/** <registryDir>/.sync-hash */
export function syncHashPathInRegistry(registryDir: string): string {
  return join(registryDir, ".sync-hash");
}

/** Resolve registry path from config, expanding ~ */
export function registryPath(config: AsmConfig): string {
  return expandHome(config.registryPath);
}

/** ~/.claude/skills/ */
export function userSkillsDir(): string {
  return join(homedir(), ".claude", "skills");
}

/** ~/.agents/skills/ */
export function userCodexSkillsDir(): string {
  return join(homedir(), ".agents", "skills");
}

/** <targetDir>/.asm-managed.toml */
export function managedTomlPath(targetDir: string): string {
  return join(targetDir, ".asm-managed.toml");
}

/** <projectDir>/.claude/skills/ — Claude project-scope skills directory */
export function projectClaudeSkillsDir(projectDir: string): string {
  return join(projectDir, ".claude", "skills");
}

/** <projectDir>/.agents/skills/ — Codex project-scope skills directory */
export function projectCodexSkillsDir(projectDir: string): string {
  return join(projectDir, ".agents", "skills");
}

/** Project-scope target directories paired with their corresponding global agent directories. */
export function projectSkillsTargets(projectDir: string): ProjectSkillsTarget[] {
  return [
    {
      targetDir: projectClaudeSkillsDir(projectDir),
      globalDir: userSkillsDir(),
    },
    {
      targetDir: projectCodexSkillsDir(projectDir),
      globalDir: userCodexSkillsDir(),
    },
  ];
}

/** Project-scope target directories in stable sync order. */
export function projectSkillsTargetDirs(projectDir: string): string[] {
  return projectSkillsTargets(projectDir).map((target) => target.targetDir);
}
