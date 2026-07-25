/** Discriminated union for error handling without exceptions */
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/** Scope for config default */
export type Scope = "user" | "project";

/** How a skill was installed — determined by registry directory */
export type SkillType = "core" | "vendor";

/** Sync target mapping (e.g., claude → ~/.claude/skills/) */
export type TargetsConfig = Record<string, string>;

/**
 * How a companion CLI is installed.
 * Only these declared strategies are allowed — ASM is not a package manager.
 */
export type RuntimeInstallKind = "from-vendor" | "brew" | "npm" | "cmd";

/** Where the expected CLI version comes from (relative to the vendor checkout). */
export type RuntimeVersionSource =
  | "package.json"
  | "pyproject.toml"
  | "git-tag"
  | "literal";

/** Declared install strategies for a companion CLI. */
export interface RuntimeInstall {
  /** Preferred strategy when multiple are present. Default order: from-vendor → brew → npm → cmd. */
  preferred?: RuntimeInstallKind;
  /** Shell command run with cwd = vendor checkout (best for monorepos: skill + CLI same commit). */
  fromVendor?: string;
  /** Homebrew formula, e.g. "lycorp-jp/tap/sim-use". */
  brew?: string;
  /** npm package, e.g. "@jackwener/opencli". */
  npm?: string;
  /** Explicit shell command (full control; opt-in only). */
  cmd?: string;
}

/**
 * Companion runtime (CLI binary) bound to a vendor skill package.
 * Skill content and the binary can drift when installed via different channels.
 */
export interface RuntimeSpec {
  /** Binary name expected on PATH. */
  bin: string;
  /** How to resolve the expected version. Default: package.json if present, else git-tag. */
  versionFrom?: RuntimeVersionSource;
  /** Expected version when versionFrom = "literal". */
  version?: string;
  /** Command that prints the installed version. Default: `<bin> --version`. */
  versionCmd?: string;
  install?: RuntimeInstall;
}

/** Vendor skill configuration from asm.toml [vendor.*] */
export interface VendorConfig {
  url?: string;
  path?: string;
  /** Optional companion CLI bound to this vendor package. */
  runtime?: RuntimeSpec;
}

/** Application configuration */
export interface AsmConfig {
  registryPath: string;
  defaultScope: Scope;
  targets: TargetsConfig;
  vendors: Record<string, VendorConfig>;
}

/** Information about an available upgrade for a vendor skill */
export interface UpgradeInfo {
  name: string;
  currentRef: string;
  remoteRef: string;
  summary: string;
}

/** Drift status of a vendor's companion CLI vs the skill checkout. */
export type RuntimeStatus =
  | "ok"
  | "ahead"
  | "behind"
  | "missing"
  | "unreadable"
  | "no-expected";

/** Result of checking one vendor runtime. */
export interface RuntimeCheck {
  vendor: string;
  bin: string;
  status: RuntimeStatus;
  expectedVersion: string | null;
  installedVersion: string | null;
  path: string | null;
  /** Resolved install strategy, if any is declared. */
  strategy: RuntimeInstallKind | null;
  /** Human-readable detail (error text, note, etc.). */
  detail?: string;
}

/** Result of attempting to install/fix one vendor runtime. */
export interface RuntimeInstallResult {
  vendor: string;
  strategy: RuntimeInstallKind;
  ok: boolean;
  message: string;
}

/** Registry metadata for a single skill */
export interface RegistryMeta {
  skillPath?: string;
}

/** A skill discovered by scanning the registry */
export interface RegistrySkill {
  name: string;
  type: SkillType;
  sourcePath: string;
  description?: string;
  /** For vendor skills, the name of the vendor repo containing this skill */
  vendorRepo?: string;
}

/** A single entry in .asm-managed.toml tracking a managed symlink */
export interface ManagedEntry {
  target: string;
}

/** Full .asm-managed.toml structure */
export interface ManagedState {
  links: Record<string, ManagedEntry>;
}

/** Full project manifest (.asm/skills.toml) */
export interface ProjectManifest {
  skills: string[];
  vendors: string[];
}

/** A single planned symlink action */
export interface SyncPlanEntry {
  source: string;
  target: string;
}

/** Sync Engine's computed expected symlink set */
export interface SyncPlan {
  links: Record<string, SyncPlanEntry>;
}


/** How a scanned skill was detected */
export type ScannedSkillType = "symlink" | "directory" | "git-repo";

/** Target type for adopting a scanned skill */
export type AdoptAs = "core" | "vendor";

/** A skill found by scanning that is not yet managed by ASM */
export interface ScannedSkill {
  name: string;
  path: string;
  type: ScannedSkillType;
  foundIn: string[];
  symlinkTarget?: string;
  remoteUrl?: string;
  description?: string;
}

/** A skill discovered recursively from workspace roots */
export interface DiscoveredSkill {
  name: string;
  path: string;
  kind: "claude" | "codex";
  type: ScannedSkillType;
  description?: string;
}

/** Options for recursive skill discovery */
export interface DiscoverOptions {
  roots?: string[];
}

