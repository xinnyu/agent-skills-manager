import { mkdir, symlink, unlink, readlink, lstat } from "node:fs/promises";

import type { Result } from "../types";
import { ok, err } from "./result";

/** Ensure a directory exists, creating it recursively if needed. */
export async function ensureDir(path: string): Promise<Result<void>> {
  try {
    await mkdir(path, { recursive: true });
  } catch (e: unknown) {
    return err(`Failed to create directory ${path}: ${String(e)}`);
  }
  return ok(undefined);
}

/** Create a symbolic link. Removes existing symlink or file at target if present. Refuses to delete directories. */
export async function createSymlink(source: string, target: string): Promise<Result<void>> {
  try {
    const stat = await lstat(target);
    if (stat.isSymbolicLink()) {
      await unlink(target);
    } else if (stat.isDirectory()) {
      return err(`${target} is a directory — remove it manually before syncing`);
    } else {
      await unlink(target);
    }
  } catch (e: unknown) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      return err(`Failed to remove existing ${target}: ${String(e)}`);
    }
  }

  try {
    await symlink(source, target);
  } catch (e: unknown) {
    return err(`Failed to create symlink ${target} -> ${source}: ${String(e)}`);
  }
  return ok(undefined);
}

/** Remove a symbolic link. */
export async function removeSymlink(path: string): Promise<Result<void>> {
  try {
    const stat = await lstat(path);
    if (!stat.isSymbolicLink()) {
      return err(`${path} is not a symbolic link`);
    }
    await unlink(path);
  } catch (e: unknown) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return ok(undefined);
    }
    return err(`Failed to remove symlink ${path}: ${String(e)}`);
  }
  return ok(undefined);
}

/** Read the target of a symbolic link. */
export async function readSymlinkTarget(path: string): Promise<Result<string>> {
  try {
    const target = await readlink(path);
    return ok(target);
  } catch (e: unknown) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return err(`Symlink not found: ${path}`);
    }
    return err(`Failed to read symlink ${path}: ${String(e)}`);
  }
}
