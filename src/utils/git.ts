import type { Result } from "../types";
import { ok, err } from "./result";

export interface GitExecOptions {
  cwd?: string;
  env?: Record<string, string>;
}

/** Execute a git command and return stdout on success. */
export async function gitExec(args: string[], cwdOrOpts?: string | GitExecOptions): Promise<Result<string>> {
  const opts: GitExecOptions = typeof cwdOrOpts === "string" ? { cwd: cwdOrOpts } : cwdOrOpts ?? {};
  const proc = Bun.spawn(["git", ...args], {
    cwd: opts.cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: opts.env ? { ...Bun.env, ...opts.env } : Bun.env,
  });

  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();

  if (exitCode !== 0) {
    return err(`git ${args[0]} failed (exit ${exitCode}): ${stderr.trim()}`);
  }

  return ok(stdout.trim());
}

/** Add a git submodule. */
export async function gitSubmoduleAdd(url: string, path: string, cwd?: string): Promise<Result<void>> {
  const result = await gitExec(["submodule", "add", url, path], { cwd });
  if (!result.ok) return result;
  return ok(undefined);
}

/** Initialize git submodules. */
export async function gitSubmoduleInit(cwd?: string): Promise<Result<void>> {
  const result = await gitExec(["submodule", "init"], cwd);
  if (!result.ok) return result;
  return ok(undefined);
}

/** Update git submodules. */
export async function gitSubmoduleUpdate(cwd?: string): Promise<Result<void>> {
  const result = await gitExec(["submodule", "update", "--init", "--recursive"], cwd);
  if (!result.ok) return result;
  return ok(undefined);
}

/** Get the current git revision (short hash). */
export async function gitRevision(cwd?: string): Promise<Result<string>> {
  return gitExec(["rev-parse", "--short", "HEAD"], cwd);
}
