import { dirname } from "node:path";

import type {
  AsmConfig,
  Result,
  RuntimeInstall,
  RuntimeInstallKind,
  RuntimeSpec,
  RuntimeVersionSource,
  Scope,
  TargetsConfig,
  VendorConfig,
} from "../types";
import { ok, err } from "../utils/result";
import { readRegistryPath, asmTomlPath } from "../utils/paths";
import { readToml, writeToml } from "../utils/toml";

const VALID_RUNTIME_INSTALL_KINDS: ReadonlySet<string> = new Set<RuntimeInstallKind>([
  "from-vendor",
  "brew",
  "npm",
  "cmd",
]);

const VALID_VERSION_SOURCES: ReadonlySet<string> = new Set<RuntimeVersionSource>([
  "package.json",
  "pyproject.toml",
  "git-tag",
  "literal",
]);

const DEFAULTS: AsmConfig = {
  registryPath: "",
  defaultScope: "user",
  targets: {},
  vendors: {},
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

/** Parse a RuntimeSpec from a TOML table (snake_case keys). Exported for vendor asm.runtime.toml. */
export function parseRuntimeSpec(raw: unknown, label: string): Result<RuntimeSpec> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return err(`Invalid ${label}: must be a table`);
  }

  const obj = raw as Record<string, unknown>;

  if (typeof obj.bin !== "string" || obj.bin.trim() === "") {
    return err(`Invalid ${label}: "bin" is required and must be a non-empty string`);
  }

  const spec: RuntimeSpec = { bin: obj.bin.trim() };

  if ("version_from" in obj) {
    if (typeof obj.version_from !== "string" || !VALID_VERSION_SOURCES.has(obj.version_from)) {
      return err(
        `Invalid ${label}.version_from: must be one of package.json | pyproject.toml | git-tag | literal`,
      );
    }
    spec.versionFrom = obj.version_from as RuntimeVersionSource;
  }

  if ("version" in obj) {
    if (typeof obj.version !== "string") {
      return err(`Invalid ${label}.version: expected string`);
    }
    spec.version = obj.version;
  }

  if (spec.versionFrom === "literal" && !spec.version) {
    return err(`Invalid ${label}: version_from = "literal" requires "version"`);
  }

  if ("version_cmd" in obj) {
    if (typeof obj.version_cmd !== "string" || obj.version_cmd.trim() === "") {
      return err(`Invalid ${label}.version_cmd: expected non-empty string`);
    }
    spec.versionCmd = obj.version_cmd.trim();
  }

  if ("install" in obj) {
    const install = parseRuntimeInstall(obj.install, `${label}.install`);
    if (!install.ok) return install;
    if (install.value) {
      spec.install = install.value;
    }
  }

  return ok(spec);
}

function parseRuntimeInstall(raw: unknown, label: string): Result<RuntimeInstall | undefined> {
  if (raw === undefined || raw === null) {
    return ok(undefined);
  }

  if (typeof raw !== "object" || Array.isArray(raw)) {
    return err(`Invalid ${label}: must be a table`);
  }

  const obj = raw as Record<string, unknown>;
  const install: RuntimeInstall = {};

  if ("preferred" in obj) {
    if (typeof obj.preferred !== "string" || !VALID_RUNTIME_INSTALL_KINDS.has(obj.preferred)) {
      return err(
        `Invalid ${label}.preferred: must be one of from-vendor | brew | npm | cmd`,
      );
    }
    install.preferred = obj.preferred as RuntimeInstallKind;
  }

  if ("from_vendor" in obj) {
    if (typeof obj.from_vendor !== "string" || obj.from_vendor.trim() === "") {
      return err(`Invalid ${label}.from_vendor: expected non-empty string`);
    }
    install.fromVendor = obj.from_vendor.trim();
  }

  if ("brew" in obj) {
    if (typeof obj.brew !== "string" || obj.brew.trim() === "") {
      return err(`Invalid ${label}.brew: expected non-empty string`);
    }
    install.brew = obj.brew.trim();
  }

  if ("npm" in obj) {
    if (typeof obj.npm !== "string" || obj.npm.trim() === "") {
      return err(`Invalid ${label}.npm: expected non-empty string`);
    }
    install.npm = obj.npm.trim();
  }

  if ("cmd" in obj) {
    if (typeof obj.cmd !== "string" || obj.cmd.trim() === "") {
      return err(`Invalid ${label}.cmd: expected non-empty string`);
    }
    install.cmd = obj.cmd.trim();
  }

  if (
    install.preferred &&
    ((install.preferred === "from-vendor" && !install.fromVendor) ||
      (install.preferred === "brew" && !install.brew) ||
      (install.preferred === "npm" && !install.npm) ||
      (install.preferred === "cmd" && !install.cmd))
  ) {
    return err(
      `Invalid ${label}: preferred = "${install.preferred}" but that strategy is not configured`,
    );
  }

  if (!install.fromVendor && !install.brew && !install.npm && !install.cmd) {
    // Empty install table is allowed (check-only companion).
    return ok(Object.keys(install).length > 0 ? install : undefined);
  }

  return ok(install);
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

  if ("runtime" in obj) {
    const runtime = parseRuntimeSpec(obj.runtime, `[vendor.${name}.runtime]`);
    if (!runtime.ok) return runtime;
    vendor.runtime = runtime.value;
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
      return ok({ ...DEFAULTS, registryPath: regDir });
    }
    return raw;
  }

  return parseAsmToml(raw.value, regDir);
}

/** Add or update one [vendor.<name>] entry in <registry>/asm.toml. */
export async function upsertVendorConfig(
  registryDir: string,
  name: string,
  vendorConfig: VendorConfig,
): Promise<Result<void>> {
  const tomlPath = asmTomlPath(registryDir);
  const existing = await readToml(tomlPath);
  let raw: Record<string, unknown>;

  if (existing.ok) {
    raw = existing.value;
  } else if (existing.error.includes("File not found")) {
    raw = {};
  } else {
    return existing;
  }

  if (
    raw.vendor !== undefined &&
    (typeof raw.vendor !== "object" || raw.vendor === null || Array.isArray(raw.vendor))
  ) {
    return err("Invalid [vendor]: must be a table");
  }

  const vendors = (raw.vendor ?? {}) as Record<string, unknown>;
  vendors[name] = vendorConfig;
  raw.vendor = vendors;

  return writeToml(tomlPath, raw);
}


/** Write default asm.toml with [config] and [targets] sections */
export async function writeDefaultAsmToml(registryDir: string): Promise<Result<void>> {
  const tomlPath = asmTomlPath(registryDir);

  // Check if asm.toml already exists
  const existing = await readToml(tomlPath);
  if (existing.ok) {
    const raw = existing.value;
    let changed = false;

    if (!raw.config || typeof raw.config !== "object") {
      raw.config = {
        default_scope: "user",
      };
      changed = true;
    }

    if (!raw.targets || typeof raw.targets !== "object") {
      raw.targets = {
        claude: "~/.claude/skills",
      };
      changed = true;
    }

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
    targets: {
      claude: "~/.claude/skills",
    },
  });
}
