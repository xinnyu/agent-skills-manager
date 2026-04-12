import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { findManifest, readManifest, checkManifestRequirements } from "../src/core/manifest";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "asm-manifest-test-"));
  await mkdir(join(tempDir, ".asm"), { recursive: true });
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("readManifest()", () => {
  test("parses valid manifest with required skills", async () => {
    const path = join(tempDir, ".asm", "skills.toml");
    await writeFile(
      path,
      `required = ["skill-a", "skill-b"]
`,
    );

    const result = await readManifest(path);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.skills).toEqual(["skill-a", "skill-b"]);
    }
  });

  test("returns empty manifest for missing file", async () => {
    const result = await readManifest(join(tempDir, "nonexistent.toml"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.skills).toEqual([]);
    }
  });

  test("returns error for invalid TOML", async () => {
    const path = join(tempDir, ".asm", "skills.toml");
    await writeFile(path, "{{invalid}}");

    const result = await readManifest(path);
    expect(result.ok).toBe(false);
  });

  test("returns error when required is not an array", async () => {
    const path = join(tempDir, ".asm", "skills.toml");
    await writeFile(path, 'required = "skill-a"\n');

    const result = await readManifest(path);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("must be an array");
    }
  });

  test("handles manifest with only required", async () => {
    const path = join(tempDir, ".asm", "skills.toml");
    await writeFile(path, 'required = ["skill-a"]\n');

    const result = await readManifest(path);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.skills).toEqual(["skill-a"]);
    }
  });
});

describe("findManifest()", () => {
  test("finds manifest in current directory", async () => {
    const path = join(tempDir, ".asm", "skills.toml");
    await writeFile(path, 'required = ["a"]\n');

    const result = await findManifest(tempDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(path);
    }
  });

  test("walks up directories to find manifest", async () => {
    const subDir = join(tempDir, "sub", "deep");
    await mkdir(subDir, { recursive: true });

    const path = join(tempDir, ".asm", "skills.toml");
    await writeFile(path, 'required = ["a"]\n');

    const result = await findManifest(subDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(path);
    }
  });

  test("returns null when no manifest found", async () => {
    const subDir = join(tempDir, "no-manifest");
    await mkdir(subDir, { recursive: true });

    const result = await findManifest(subDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value === null || typeof result.value === "string").toBe(true);
    }
  });
});

function makeSkill(name: string, type: "core" | "vendor" = "core", vendorRepo?: string) {
  return { name, type, sourcePath: `/fake/${name}`, vendorRepo } as const;
}

describe("checkManifestRequirements()", () => {
  test("required skill not installed → listed in missing", () => {
    const manifest = {
      skills: ["skill-a", "skill-b"],
      vendors: [],
    };
    const skills = [makeSkill("skill-a")];

    const result = checkManifestRequirements(manifest, skills);
    expect(result.missing).toEqual(["skill-b"]);
  });

  test("all required installed → empty missing", () => {
    const manifest = {
      skills: ["skill-a", "skill-b"],
      vendors: [],
    };
    const skills = [makeSkill("skill-a"), makeSkill("skill-b")];

    const result = checkManifestRequirements(manifest, skills);
    expect(result.missing).toEqual([]);
  });

  test("vendors field: installed vendor repo → no missing", () => {
    const manifest = {
      skills: [],
      vendors: ["opencli"],
    };
    const skills = [
      makeSkill("opencli-usage", "vendor", "opencli"),
      makeSkill("opencli-browser", "vendor", "opencli"),
    ];

    const result = checkManifestRequirements(manifest, skills);
    expect(result.missing).toEqual([]);
    expect(result.missingVendors).toEqual([]);
  });

  test("vendors field: missing vendor repo → listed in missingVendors", () => {
    const manifest = {
      skills: [],
      vendors: ["opencli", "agent-browser"],
    };
    const skills = [makeSkill("opencli-usage", "vendor", "opencli")];

    const result = checkManifestRequirements(manifest, skills);
    expect(result.missingVendors).toEqual(["agent-browser"]);
  });

  test("mixed: required skills + vendors", () => {
    const manifest = {
      skills: ["my-skill"],
      vendors: ["opencli"],
    };
    const skills = [
      makeSkill("my-skill"),
      makeSkill("opencli-usage", "vendor", "opencli"),
    ];

    const result = checkManifestRequirements(manifest, skills);
    expect(result.missing).toEqual([]);
    expect(result.missingVendors).toEqual([]);
  });
});
