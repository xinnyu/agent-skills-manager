/** Discriminated union for error handling without exceptions */
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/** Scope for config default */
export type Scope = "user" | "project";

/** How a skill was installed — determined by registry directory */
export type SkillType = "core" | "vendor";

/** Sync target mapping (e.g., claude → ~/.claude/skills/) */
export type TargetsConfig = Record<string, string>;

/** Vendor skill configuration from asm.toml [vendor.*] */
export interface VendorConfig {
  url?: string;
  path?: string;
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
  kind: "claude" | "codex" | "kiro";
  type: ScannedSkillType;
  description?: string;
}

/** Options for recursive skill discovery */
export interface DiscoverOptions {
  roots?: string[];
}
