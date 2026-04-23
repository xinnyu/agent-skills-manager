import { mkdtemp, rm, mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { resolve } from "path";

const projectRoot = resolve(import.meta.dir, "../..");

export interface TestEnv {
  testDir: string;
  registryDir: string;
  skillsDir: string;
  codexSkillsDir: string;
  kiroSkillsDir: string;
  asmTomlPath: string;
  syncHashPath: string;
  cacheDir: string;
  /** @deprecated Use asmTomlPath instead */
  configPath: string;
  configDir: string;
}

/** Create an isolated temporary directory structure for a single test. */
export async function createTestEnv(): Promise<TestEnv> {
  const testDir = await mkdtemp(join(tmpdir(), "asm-e2e-"));
  const skillsDir = join(testDir, ".claude", "skills");
  const codexSkillsDir = join(testDir, ".agents", "skills");
  const kiroSkillsDir = join(testDir, ".kiro", "skills");
  const registryDir = join(testDir, "registry");
  const cacheDir = join(registryDir, ".cache");
  const configDir = join(testDir, ".asm");

  await mkdir(skillsDir, { recursive: true });
  await mkdir(codexSkillsDir, { recursive: true });
  await mkdir(kiroSkillsDir, { recursive: true });
  await mkdir(registryDir, { recursive: true });
  await mkdir(cacheDir, { recursive: true });
  await mkdir(configDir, { recursive: true });

  const asmTomlPath = join(registryDir, "asm.toml");

  return {
    testDir,
    registryDir,
    skillsDir,
    codexSkillsDir,
    kiroSkillsDir,
    asmTomlPath,
    syncHashPath: join(registryDir, ".sync-hash"),
    cacheDir,
    // Legacy aliases pointing to asm.toml for backward compat
    configPath: asmTomlPath,
    configDir,
  };
}

/** Remove the temporary directory tree created by createTestEnv. */
export async function cleanupTestEnv(testDir: string): Promise<void> {
  await rm(testDir, { recursive: true, force: true });
}

export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Run the CLI via Bun.spawn with HOME redirected to testDir so that
 * ~/.asmrc and user-level skill directories resolve inside the temp directory.
 */
export async function runCli(
  args: string[],
  testDir: string,
  env?: Record<string, string>,
): Promise<CliResult> {
  const proc = Bun.spawn(["bun", "run", join(projectRoot, "src/cli.ts"), ...args], {
    cwd: testDir,
    env: {
      ...process.env,
      HOME: testDir,
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

export interface MockServer {
  url: string;
  stop: () => void;
}

/** Start a mock HTTP server that returns the given body for every request. */
export function startMockServer(
  body: string,
  contentType = "text/plain",
): MockServer {
  const server = Bun.serve({
    port: 0,
    fetch() {
      return new Response(body, {
        headers: { "Content-Type": contentType },
      });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    stop: () => server.stop(),
  };
}

/** Initialize a git repository in the given directory. */
export async function gitInit(dir: string): Promise<void> {
  await Bun.spawn(["git", "init", dir], { stdout: "ignore", stderr: "ignore" }).exited;
  await Bun.spawn(["git", "-C", dir, "config", "user.email", "test@test.com"], {
    stdout: "ignore",
    stderr: "ignore",
  }).exited;
  await Bun.spawn(["git", "-C", dir, "config", "user.name", "Test"], {
    stdout: "ignore",
    stderr: "ignore",
  }).exited;
}

/** Write an asm.toml pointing at the test registry with given targets. */
export async function writeTestConfig(
  asmTomlPath: string,
  _registryDir: string,
  targets: Record<string, string> = {},
): Promise<void> {
  const targetLines = Object.entries(targets).map(([k, v]) => `${k} = "${v}"`).join("\n");
  const content = `[config]\ndefault_scope = "user"\n\n[targets]\n${targetLines}\n`;
  await mkdir(join(asmTomlPath, ".."), { recursive: true });
  await writeFile(asmTomlPath, content, "utf-8");
}

/**
 * Create a core skill directory with a SKILL.md inside the registry.
 * Does NOT write state — skills are discovered by scanning the registry.
 */
export async function seedCoreSkill(
  name: string,
  registryDir: string,
  _asmTomlPath?: string,
): Promise<void> {
  const skillDir = join(registryDir, "core", name);
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    join(skillDir, "SKILL.md"),
    `---\nname: ${name}\ndescription: Test skill ${name}\n---\n\nTest content for ${name}\n`,
    "utf-8",
  );
}
