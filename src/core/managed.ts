import type { Result, ManagedState, ManagedEntry } from "../types";
import { ok, err } from "../utils/result";
import { readToml, writeToml } from "../utils/toml";

function parseManagedState(raw: Record<string, unknown>): Result<ManagedState> {
  const state: ManagedState = { links: {} };

  const linksRaw = raw.links;
  if (linksRaw === undefined) {
    return ok(state);
  }

  if (typeof linksRaw !== "object" || linksRaw === null || Array.isArray(linksRaw)) {
    return err("Invalid managed state: [links] must be a table");
  }

  const linksTable = linksRaw as Record<string, unknown>;
  for (const [name, value] of Object.entries(linksTable)) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return err(`Invalid managed state: link "${name}" must be a table`);
    }
    const record = value as Record<string, unknown>;
    if (typeof record.target !== "string") {
      return err(`Invalid managed state: link "${name}" must have a string "target" field`);
    }
    state.links[name] = { target: record.target };
  }

  return ok(state);
}

function managedToToml(state: ManagedState): Record<string, unknown> {
  const links: Record<string, unknown> = {};
  for (const [name, entry] of Object.entries(state.links)) {
    links[name] = { target: entry.target };
  }
  return { links };
}

/** Read .asm-managed.toml. Returns empty state if file doesn't exist. */
export async function readManaged(path: string): Promise<Result<ManagedState>> {
  const raw = await readToml(path);

  if (!raw.ok) {
    if (raw.error.includes("File not found")) {
      return ok({ links: {} });
    }
    return raw;
  }

  return parseManagedState(raw.value);
}

/** Write .asm-managed.toml. */
export async function writeManaged(path: string, state: ManagedState): Promise<Result<void>> {
  return writeToml(path, managedToToml(state));
}

/** Add or update a managed entry. */
export async function addManagedEntry(
  path: string,
  name: string,
  entry: ManagedEntry,
): Promise<Result<void>> {
  const state = await readManaged(path);
  if (!state.ok) return state;

  state.value.links[name] = entry;

  return writeManaged(path, state.value);
}

/** Remove a managed entry. */
export async function removeManagedEntry(
  path: string,
  name: string,
): Promise<Result<void>> {
  const state = await readManaged(path);
  if (!state.ok) return state;

  delete state.value.links[name];

  return writeManaged(path, state.value);
}
