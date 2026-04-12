import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { parse, stringify } from "smol-toml";

import type { Result } from "../types";
import { ok, err } from "./result";

/** Read and parse a TOML file. Returns err on missing file or parse failure. */
export async function readToml(path: string): Promise<Result<Record<string, unknown>>> {
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (e: unknown) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return err(`File not found: ${path}`);
    }
    return err(`Failed to read ${path}: ${String(e)}`);
  }

  try {
    const parsed = parse(raw);
    return ok(parsed as Record<string, unknown>);
  } catch (e: unknown) {
    return err(`Failed to parse TOML in ${path}: ${(e as Error).message}`);
  }
}

/** Write a value as TOML to a file, creating parent directories as needed. */
export async function writeToml(path: string, data: Record<string, unknown>): Promise<Result<void>> {
  let content: string;
  try {
    content = stringify(data);
  } catch (e: unknown) {
    return err(`Failed to stringify TOML: ${(e as Error).message}`);
  }

  try {
    await mkdir(dirname(path), { recursive: true });
  } catch (e: unknown) {
    return err(`Failed to create directory for ${path}: ${String(e)}`);
  }

  try {
    await writeFile(path, content, "utf-8");
  } catch (e: unknown) {
    return err(`Failed to write ${path}: ${String(e)}`);
  }

  return ok(undefined);
}
