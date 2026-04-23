import { dirname } from "node:path";

import type {
  AsmConfig,
  Result,
  Scope,
  TargetsConfig,
  VendorConfig,
} from "../types";
import { ok, err } from "../utils/result";
import { readRegistryPath, asmTomlPath } from "../utils/paths";
import { readToml, writeToml } from "../utils/toml";

const DEFAULTS: AsmConfig = {
  registryPath: "",
  defaultScope: "user",
  targets: {},
  vendors: {},
};

const DEFAULT_TARGETS: TargetsConfig = {
  claude: "~/.claude/skills",
  codex: "~/.agents/skills",
  kiro: "~/.kiro/skills",
};

const VALID_SCOPES: ReadonlySet<string> = new Set<Scope>(["user", "project"]);


function validateScope(value: unknown): Result<Scope> {
  if (typeof value !== "string") {
    return err(`Invalid scope type: expected string, got ${typeof value}`);
  }
  const trimmed = value.trim();
  if (!VALID_SCOPES.has(trimmed)) {
    return err(`Invalid scope "${trimmed}": must be "user" or "project"`);
  }
  return ok(trimmed as Scope);
}

function parseConfigSection(raw: Record<string, unknown>): Result<{ defaultScope: Scope }> {
  let defaultScope: Scope = "user";

  if ("default_scope" in raw) {
    const scope = validateScope(raw.default_scope);
    if (!scope.ok) return scope;
    defaultScope = scope.value;
  }

  return ok({ defaultScope });
}

function parseTargetsSection(raw: unknown): Result<TargetsConfig> {
  if (raw === undefined || raw === null) {
    return ok({});
  }

  if (typeof raw !== "object" || Array.isArray(raw)) {
    return err("Invalid [targets]: must be a table");
  }

  const targets: TargetsConfig = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== "string") {
      return err(`Invalid target "${key}": expected string, got ${typeof value}`);
    }
    targets[key] = value;
  }

  return ok(targets);
}

function parseVendorSection(name: string, raw: unknown): Result<VendorConfig> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return err(`Invalid [vendor.${name}]: must be a table`);
  }

  const obj = raw as Record<string, unknown>;
  const vendor: VendorConfig = {};

  if ("url" in obj) {
    if (typeof obj.url !== "string") {
      return err(`Invalid url in [vendor.${name}]: expected string`);
    }
    vendor.url = obj.url;
  }

  if ("path" in obj) {
    if (typeof obj.path !== "string") {
      return err(`Invalid path in [vendor.${name}]: expected string`);
    }
    vendor.path = obj.path;
  }

  if (vendor.url && vendor.path) {
    return err(`[vendor.${name}]: cannot specify both "url" and "path"`);
  }

  if (!vendor.url && !vendor.path) {
    return err(`[vendor.${name}]: must specify either "url" or "path"`);
  }

  return ok(vendor);
}

function parseVendorsTable(raw: unknown): Result<Record<string, VendorConfig>> {
  if (raw === undefined || raw === null) {
    return ok({});
  }

  if (typeof raw !== "object" || Array.isArray(raw)) {
    return err("Invalid [vendor]: must be a table");
  }

  const vendors: Record<string, VendorConfig> = {};
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    const vendor = parseVendorSection(name, value);
    if (!vendor.ok) return vendor;
    vendors[name] = vendor.value;
  }

  return ok(vendors);
}

function applyDefaultTargets(raw: Record<string, unknown>): boolean {
  let changed = false;

  if (raw.config === undefined) {
    raw.config = {
      default_scope: "user",
    };
    changed = true;
  }

  if (raw.targets === undefined) {
    raw.targets = { ...DEFAULT_TARGETS };
    changed = true;
    return changed;
  }

  if (typeof raw.targets !== "object" || raw.targets === null || Array.isArray(raw.targets)) {
    return changed;
  }

  const targets = raw.targets as Record<string, unknown>;
  for (const [name, dir] of Object.entries(DEFAULT_TARGETS)) {
    if (!(name in targets)) {
      targets[name] = dir;
      changed = true;
    }
  }

  return changed;
}

function parseAsmToml(raw: Record<string, unknown>, regDir: string): Result<AsmConfig> {
  const config: AsmConfig = { ...DEFAULTS, registryPath: regDir };

  // Parse [config] section
  const configSection = raw.config;
  if (configSection !== undefined) {
    if (typeof configSection !== "object" || configSection === null || Array.isArray(configSection)) {
      return err("Invalid [config]: must be a table");
    }
    const parsed = parseConfigSection(configSection as Record<string, unknown>);
    if (!parsed.ok) return parsed;
    config.defaultScope = parsed.value.defaultScope;
  }

  // Parse [targets] section
  const targets = parseTargetsSection(raw.targets);
  if (!targets.ok) return targets;
  config.targets = targets.value;

  // Parse [vendor.*] sections
  const vendors = parseVendorsTable(raw.vendor);
  if (!vendors.ok) return vendors;
  config.vendors = vendors.value;

  return ok(config);
}

/** Resolve the asm.toml file path from override or ~/.asmrc */
async function resolveAsmTomlFilePath(overridePath?: string): Promise<Result<{ tomlPath: string; regDir: string }>> {
  if (overridePath) {
    return ok({ tomlPath: overridePath, regDir: dirname(overridePath) });
  }

  const reg = await readRegistryPath();
  if (!reg.ok) return reg;

  return ok({ tomlPath: asmTomlPath(reg.value), regDir: reg.value });
}

/** Read ASM configuration from <registry>/asm.toml, falling back to defaults if missing. */
export async function readConfig(overridePath?: string): Promise<Result<AsmConfig>> {
  const resolved = await resolveAsmTomlFilePath(overridePath);
  if (!resolved.ok) {
    if (resolved.error.includes("not found")) {
      return ok({ ...DEFAULTS });
    }
    return resolved;
  }

  const { tomlPath, regDir } = resolved.value;
  const raw = await readToml(tomlPath);

  if (!raw.ok) {
    if (raw.error.includes("File not found")) {
      const initWrite = await writeToml(tomlPath, {
        config: {
          default_scope: "user",
        },
        targets: DEFAULT_TARGETS,
      });
      if (!initWrite.ok) return initWrite;
      return ok({
        ...DEFAULTS,
        registryPath: regDir,
        defaultScope: "user",
        targets: { ...DEFAULT_TARGETS },
      });
    }
    return raw;
  }

  const changed = applyDefaultTargets(raw.value);
  if (changed) {
    const write = await writeToml(tomlPath, raw.value);
    if (!write.ok) return write;
  }

  return parseAsmToml(raw.value, regDir);
}


/** Write default asm.toml with [config] and [targets] sections */
export async function writeDefaultAsmToml(registryDir: string): Promise<Result<void>> {
  const tomlPath = asmTomlPath(registryDir);

  // Check if asm.toml already exists
  const existing = await readToml(tomlPath);
  if (existing.ok) {
    const raw = existing.value;
    const changed = applyDefaultTargets(raw);

    if (changed) {
      return writeToml(tomlPath, raw);
    }
    return ok(undefined);
  }

  if (!existing.error.includes("File not found")) {
    return existing;
  }

  return writeToml(tomlPath, {
    config: {
      default_scope: "user",
    },
    targets: DEFAULT_TARGETS,
  });
}
