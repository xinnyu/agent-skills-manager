import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  Result,
  RuntimeCheck,
  RuntimeInstall,
  RuntimeInstallKind,
  RuntimeInstallResult,
  RuntimeSpec,
  RuntimeStatus,
  VendorConfig,
} from "../types";
import { ok, err } from "../utils/result";
import { gitExec } from "../utils/git";
import { readToml } from "../utils/toml";
import { expandHome, registryPath } from "../utils/paths";
import { parseRuntimeSpec, readConfig } from "./config";

const VENDOR_RUNTIME_FILE = "asm.runtime.toml";

// ── merge / resolve ──────────────────────────────────────────────────────────

function mergeInstall(
  base?: RuntimeInstall,
  override?: RuntimeInstall,
): RuntimeInstall | undefined {
  if (!base && !override) return undefined;
  return {
    preferred: override?.preferred ?? base?.preferred,
    fromVendor: override?.fromVendor ?? base?.fromVendor,
    brew: override?.brew ?? base?.brew,
    npm: override?.npm ?? base?.npm,
    cmd: override?.cmd ?? base?.cmd,
  };
}

/** Local asm.toml runtime overrides vendor-shipped asm.runtime.toml. */
export function mergeRuntimeSpec(
  base?: RuntimeSpec,
  override?: RuntimeSpec,
): RuntimeSpec | undefined {
  if (!base && !override) return undefined;
  if (!base) return override;
  if (!override) return base;

  return {
    bin: override.bin || base.bin,
    versionFrom: override.versionFrom ?? base.versionFrom,
    version: override.version ?? base.version,
    versionCmd: override.versionCmd ?? base.versionCmd,
    install: mergeInstall(base.install, override.install),
  };
}

/** Load vendor-shipped asm.runtime.toml if present (missing file is not an error). */
export async function loadVendorRuntimeFile(
  vendorDir: string,
): Promise<Result<RuntimeSpec | undefined>> {
  const path = join(vendorDir, VENDOR_RUNTIME_FILE);
  const raw = await readToml(path);
  if (!raw.ok) {
    if (raw.error.includes("File not found")) {
      return ok(undefined);
    }
    return raw;
  }

  const section = raw.value.runtime ?? raw.value;
  // Prefer [runtime] table; bare top-level bin is also accepted.
  if (
    section === raw.value &&
    typeof raw.value.bin !== "string" &&
    raw.value.runtime === undefined
  ) {
    return err(`${path}: expected [runtime] table with "bin"`);
  }

  return parseRuntimeSpec(section, `[runtime] in ${path}`);
}

export function resolveInstallStrategy(
  install?: RuntimeInstall,
): RuntimeInstallKind | null {
  if (!install) return null;

  if (install.preferred) {
    return install.preferred;
  }

  // Monorepo alignment first, then published channels, then free-form.
  if (install.fromVendor) return "from-vendor";
  if (install.brew) return "brew";
  if (install.npm) return "npm";
  if (install.cmd) return "cmd";
  return null;
}

export function runtimeNeedsFix(status: RuntimeStatus): boolean {
  return status === "behind" || status === "missing";
}

// ── version helpers ──────────────────────────────────────────────────────────

/** Extract the first X.Y.Z triple from a free-form version string. */
export function parseSemver(input: string): [number, number, number] | null {
  const match = input.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Compare two free-form version strings by first semver triple. null if incomparable. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return null;

  for (let i = 0; i < 3; i++) {
    if (pa[i] < pb[i]) return -1;
    if (pa[i] > pb[i]) return 1;
  }
  return 0;
}

async function readPackageJsonVersion(vendorDir: string): Promise<string | null> {
  try {
    const raw = await readFile(join(vendorDir, "package.json"), "utf-8");
    const pkg = JSON.parse(raw) as { version?: unknown };
    return typeof pkg.version === "string" && pkg.version.trim() !== ""
      ? pkg.version.trim()
      : null;
  } catch {
    return null;
  }
}

/** Best-effort: first `version = "..."` in pyproject.toml (usually [project]). */
async function readPyprojectVersion(vendorDir: string): Promise<string | null> {
  try {
    const raw = await readFile(join(vendorDir, "pyproject.toml"), "utf-8");
    const match = raw.match(/^\s*version\s*=\s*"([^"]+)"/m);
    return match?.[1]?.trim() || null;
  } catch {
    return null;
  }
}

async function readGitTagVersion(vendorDir: string): Promise<string | null> {
  const result = await gitExec(["describe", "--tags", "--abbrev=0"], vendorDir);
  if (!result.ok) return null;
  return result.value.replace(/^v/, "").trim() || null;
}

export async function resolveExpectedVersion(
  vendorDir: string,
  spec: RuntimeSpec,
): Promise<string | null> {
  const source = spec.versionFrom;

  if (source === "literal") {
    return spec.version?.trim() || null;
  }

  if (source === "package.json") {
    return readPackageJsonVersion(vendorDir);
  }

  if (source === "pyproject.toml") {
    return readPyprojectVersion(vendorDir);
  }

  if (source === "git-tag") {
    return readGitTagVersion(vendorDir);
  }

  // Auto: package.json → pyproject.toml → git-tag → literal field.
  const fromPkg = await readPackageJsonVersion(vendorDir);
  if (fromPkg) return fromPkg;

  const fromPy = await readPyprojectVersion(vendorDir);
  if (fromPy) return fromPy;

  const fromTag = await readGitTagVersion(vendorDir);
  if (fromTag) return fromTag;

  return spec.version?.trim() || null;
}

async function shellCapture(
  command: string,
  cwd?: string,
): Promise<Result<string>> {
  const proc = Bun.spawn(["/bin/bash", "-lc", command], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: Bun.env,
  });

  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();

  if (exitCode !== 0) {
    const detail = (stderr || stdout).trim() || `exit ${exitCode}`;
    return err(detail);
  }

  return ok(stdout.trim());
}

/** Resolve binary path. Shell `command -v` honors current PATH (unlike Bun.which cache). */
async function whichBin(bin: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_+=.@-]+$/.test(bin)) {
    // Refuse shell metacharacters in binary names.
    return null;
  }
  const viaShell = await shellCapture(`command -v ${bin}`);
  if (viaShell.ok) {
    const first = viaShell.value.split("\n")[0]?.trim();
    if (first) return first;
  }
  return Bun.which(bin) ?? null;
}

export async function resolveInstalledVersion(
  spec: RuntimeSpec,
): Promise<Result<{ version: string | null; path: string | null }>> {
  const binPath = await whichBin(spec.bin);
  if (!binPath) {
    return ok({ version: null, path: null });
  }

  const versionCmd = spec.versionCmd ?? `${spec.bin} --version`;
  const captured = await shellCapture(versionCmd);
  if (!captured.ok) {
    return err(captured.error);
  }

  const parsed = parseSemver(captured.value);
  return ok({
    version: parsed ? parsed.join(".") : captured.value.split("\n")[0]?.trim() || null,
    path: binPath,
  });
}

function classifyStatus(
  expected: string | null,
  installed: string | null,
  path: string | null,
  versionError?: string,
): { status: RuntimeStatus; detail?: string } {
  if (!path) {
    return { status: "missing", detail: "not on PATH" };
  }

  if (versionError) {
    return { status: "unreadable", detail: versionError };
  }

  if (!installed) {
    return { status: "unreadable", detail: "version command produced no output" };
  }

  if (!expected) {
    return { status: "no-expected", detail: "present; no expected version declared" };
  }

  const cmp = compareVersions(installed, expected);
  if (cmp === null) {
    // Fallback: exact string match after stripping a leading v.
    const a = installed.replace(/^v/, "");
    const b = expected.replace(/^v/, "");
    if (a === b) return { status: "ok" };
    return {
      status: "unreadable",
      detail: `cannot compare versions "${installed}" vs "${expected}"`,
    };
  }

  if (cmp === 0) return { status: "ok" };
  if (cmp < 0) return { status: "behind" };
  return { status: "ahead" };
}

// ── check ────────────────────────────────────────────────────────────────────

export async function checkOneRuntime(
  vendor: string,
  vendorDir: string,
  spec: RuntimeSpec,
): Promise<RuntimeCheck> {
  const expectedVersion = await resolveExpectedVersion(vendorDir, spec);
  const strategy = resolveInstallStrategy(spec.install);

  const installed = await resolveInstalledVersion(spec);
  if (!installed.ok) {
    const binPath = await whichBin(spec.bin);
    const { status, detail } = classifyStatus(
      expectedVersion,
      null,
      binPath,
      installed.error,
    );
    return {
      vendor,
      bin: spec.bin,
      status,
      expectedVersion,
      installedVersion: null,
      path: binPath,
      strategy,
      detail,
    };
  }

  const { status, detail } = classifyStatus(
    expectedVersion,
    installed.value.version,
    installed.value.path,
  );

  return {
    vendor,
    bin: spec.bin,
    status,
    expectedVersion,
    installedVersion: installed.value.version,
    path: installed.value.path,
    strategy,
    detail,
  };
}

async function resolveVendorRuntime(
  vendorDir: string,
  configRuntime?: RuntimeSpec,
): Promise<Result<RuntimeSpec | undefined>> {
  const shipped = await loadVendorRuntimeFile(vendorDir);
  if (!shipped.ok) return shipped;
  return ok(mergeRuntimeSpec(shipped.value, configRuntime));
}

function vendorDirFor(regPath: string, name: string, config: VendorConfig): string {
  if (config.path) {
    return expandHome(config.path);
  }
  return join(regPath, "vendor", name);
}

/**
 * Check companion CLIs for every vendor that declares a runtime
 * (via asm.toml and/or vendor asm.runtime.toml).
 */
export async function checkRuntimes(options?: {
  overrideRegistryPath?: string;
  /** Only check these vendor names. Default: all with a runtime. */
  vendors?: string[];
}): Promise<Result<RuntimeCheck[]>> {
  const config = await readConfig(
    options?.overrideRegistryPath
      ? join(options.overrideRegistryPath, "asm.toml")
      : undefined,
  );
  if (!config.ok) return config;

  let regPath = options?.overrideRegistryPath;
  if (!regPath) {
    regPath = registryPath(config.value);
    if (!regPath) {
      return err("Registry path not configured. Run \"asm init\" first.");
    }
  }

  const filter = options?.vendors ? new Set(options.vendors) : null;
  const checks: RuntimeCheck[] = [];

  for (const [name, vendor] of Object.entries(config.value.vendors)) {
    if (filter && !filter.has(name)) continue;

    const dir = vendorDirFor(regPath, name, vendor);
    const resolved = await resolveVendorRuntime(dir, vendor.runtime);
    if (!resolved.ok) {
      checks.push({
        vendor: name,
        bin: vendor.runtime?.bin ?? "?",
        status: "unreadable",
        expectedVersion: null,
        installedVersion: null,
        path: null,
        strategy: null,
        detail: resolved.error,
      });
      continue;
    }

    if (!resolved.value) continue;

    checks.push(await checkOneRuntime(name, dir, resolved.value));
  }

  // Stable order for CLI tables.
  checks.sort((a, b) => a.vendor.localeCompare(b.vendor));
  return ok(checks);
}

// ── install ──────────────────────────────────────────────────────────────────

async function runInstallCommand(
  command: string,
  cwd?: string,
): Promise<Result<string>> {
  return shellCapture(command, cwd);
}

export async function installOneRuntime(
  vendor: string,
  vendorDir: string,
  spec: RuntimeSpec,
  strategyOverride?: RuntimeInstallKind,
): Promise<RuntimeInstallResult> {
  const install = spec.install;
  const strategy = strategyOverride ?? resolveInstallStrategy(install);

  if (!strategy || !install) {
    return {
      vendor,
      strategy: strategy ?? "cmd",
      ok: false,
      message: "no install strategy declared for this runtime",
    };
  }

  let command: string;
  let cwd: string | undefined;

  switch (strategy) {
    case "from-vendor": {
      if (!install.fromVendor) {
        return {
          vendor,
          strategy,
          ok: false,
          message: "from-vendor strategy selected but from_vendor is empty",
        };
      }
      command = install.fromVendor;
      cwd = vendorDir;
      break;
    }
    case "brew": {
      if (!install.brew) {
        return {
          vendor,
          strategy,
          ok: false,
          message: "brew strategy selected but brew formula is empty",
        };
      }
      // upgrade if present, otherwise install.
      command = `brew upgrade ${shellQuote(install.brew)} 2>/dev/null || brew install ${shellQuote(install.brew)}`;
      break;
    }
    case "npm": {
      if (!install.npm) {
        return {
          vendor,
          strategy,
          ok: false,
          message: "npm strategy selected but npm package is empty",
        };
      }
      command = `npm install -g ${shellQuote(install.npm)}`;
      break;
    }
    case "cmd": {
      if (!install.cmd) {
        return {
          vendor,
          strategy,
          ok: false,
          message: "cmd strategy selected but cmd is empty",
        };
      }
      command = install.cmd;
      break;
    }
    default: {
      return {
        vendor,
        strategy,
        ok: false,
        message: `unknown strategy: ${strategy as string}`,
      };
    }
  }

  const result = await runInstallCommand(command, cwd);
  if (!result.ok) {
    return {
      vendor,
      strategy,
      ok: false,
      message: result.error,
    };
  }

  return {
    vendor,
    strategy,
    ok: true,
    message: result.value || `installed via ${strategy}`,
  };
}

/** Quote a single shell token. Formulas/packages are expected to be simple identifiers. */
function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_@/.=+-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Install/fix companion CLIs that are missing or behind.
 * Only acts on vendors with a declared install strategy.
 */
export async function installRuntimes(options?: {
  overrideRegistryPath?: string;
  /** Only fix these vendors. Default: all that need fix. */
  vendors?: string[];
  /** Also reinstall ok/ahead runtimes. Default false. */
  force?: boolean;
}): Promise<Result<RuntimeInstallResult[]>> {
  const config = await readConfig(
    options?.overrideRegistryPath
      ? join(options.overrideRegistryPath, "asm.toml")
      : undefined,
  );
  if (!config.ok) return config;

  let regPath = options?.overrideRegistryPath;
  if (!regPath) {
    regPath = registryPath(config.value);
    if (!regPath) {
      return err("Registry path not configured. Run \"asm init\" first.");
    }
  }

  const checks = await checkRuntimes({
    overrideRegistryPath: regPath,
    vendors: options?.vendors,
  });
  if (!checks.ok) return checks;

  const results: RuntimeInstallResult[] = [];

  for (const check of checks.value) {
    if (!options?.force && !runtimeNeedsFix(check.status)) {
      continue;
    }

    if (!check.strategy) {
      results.push({
        vendor: check.vendor,
        strategy: "cmd",
        ok: false,
        message: `${check.status}: no install strategy declared — fix manually or add [vendor.${check.vendor}.runtime.install]`,
      });
      continue;
    }

    const vendor = config.value.vendors[check.vendor];
    if (!vendor) continue;

    const dir = vendorDirFor(regPath, check.vendor, vendor);
    const resolved = await resolveVendorRuntime(dir, vendor.runtime);
    if (!resolved.ok || !resolved.value) {
      results.push({
        vendor: check.vendor,
        strategy: check.strategy,
        ok: false,
        message: resolved.ok ? "runtime disappeared" : resolved.error,
      });
      continue;
    }

    results.push(await installOneRuntime(check.vendor, dir, resolved.value, check.strategy));
  }

  return ok(results);
}

// ── formatting helpers (shared by doctor / upgrade) ──────────────────────────

export function formatRuntimeStatus(status: RuntimeStatus): string {
  switch (status) {
    case "ok":
      return "ok";
    case "ahead":
      return "ahead";
    case "behind":
      return "behind";
    case "missing":
      return "missing";
    case "unreadable":
      return "unreadable";
    case "no-expected":
      return "no-expected";
  }
}

export function runtimeCheckRows(checks: RuntimeCheck[]): string[][] {
  return checks.map((c) => [
    c.vendor,
    c.bin,
    c.expectedVersion ?? "—",
    c.installedVersion ?? "—",
    formatRuntimeStatus(c.status),
    c.strategy ?? "—",
    c.detail ?? "",
  ]);
}

export const RUNTIME_TABLE_HEADERS = [
  "VENDOR",
  "BIN",
  "EXPECTED",
  "INSTALLED",
  "STATUS",
  "STRATEGY",
  "DETAIL",
] as const;
