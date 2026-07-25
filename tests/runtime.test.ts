import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseRuntimeSpec } from "../src/core/config";
import {
  checkOneRuntime,
  checkRuntimes,
  compareVersions,
  loadVendorRuntimeFile,
  mergeRuntimeSpec,
  parseSemver,
  resolveExpectedVersion,
  resolveInstallStrategy,
  runtimeNeedsFix,
} from "../src/core/runtime";
describe("parseSemver / compareVersions", () => {
  test("extracts first X.Y.Z triple", () => {
    expect(parseSemver("1.8.6")).toEqual([1, 8, 6]);
    expect(parseSemver("v0.11.0")).toEqual([0, 11, 0]);
    expect(parseSemver("sim-use 0.10.0 (build 42)")).toEqual([0, 10, 0]);
    expect(parseSemver("no version here")).toBeNull();
  });

  test("compares versions", () => {
    expect(compareVersions("0.10.0", "0.11.0")).toBe(-1);
    expect(compareVersions("1.8.6", "1.8.4")).toBe(1);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("abc", "1.0.0")).toBeNull();
  });
});

describe("resolveInstallStrategy", () => {
  test("honors preferred when configured", () => {
    expect(
      resolveInstallStrategy({
        preferred: "brew",
        brew: "lycorp-jp/tap/sim-use",
        npm: "@x/y",
      }),
    ).toBe("brew");
  });

  test("default order prefers from-vendor", () => {
    expect(
      resolveInstallStrategy({
        fromVendor: "npm i -g .",
        brew: "foo",
        npm: "bar",
      }),
    ).toBe("from-vendor");
  });

  test("falls through brew → npm → cmd", () => {
    expect(resolveInstallStrategy({ brew: "a", npm: "b" })).toBe("brew");
    expect(resolveInstallStrategy({ npm: "b", cmd: "c" })).toBe("npm");
    expect(resolveInstallStrategy({ cmd: "echo hi" })).toBe("cmd");
    expect(resolveInstallStrategy(undefined)).toBeNull();
    expect(resolveInstallStrategy({})).toBeNull();
  });
});

describe("mergeRuntimeSpec", () => {
  test("local override wins field-by-field", () => {
    const merged = mergeRuntimeSpec(
      {
        bin: "opencli",
        versionFrom: "package.json",
        install: { npm: "@jackwener/opencli", fromVendor: "npm i -g ." },
      },
      {
        bin: "opencli",
        install: { preferred: "npm", npm: "@jackwener/opencli@latest" },
      },
    );

    expect(merged).toEqual({
      bin: "opencli",
      versionFrom: "package.json",
      version: undefined,
      versionCmd: undefined,
      install: {
        preferred: "npm",
        fromVendor: "npm i -g .",
        brew: undefined,
        npm: "@jackwener/opencli@latest",
        cmd: undefined,
      },
    });
  });

  test("returns undefined when both missing", () => {
    expect(mergeRuntimeSpec(undefined, undefined)).toBeUndefined();
  });
});

describe("parseRuntimeSpec", () => {
  test("parses full runtime table", () => {
    const result = parseRuntimeSpec(
      {
        bin: "sim-use",
        version_from: "git-tag",
        version_cmd: "sim-use --version",
        install: {
          preferred: "brew",
          brew: "lycorp-jp/tap/sim-use",
          from_vendor: "make install",
        },
      },
      "[runtime]",
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        bin: "sim-use",
        versionFrom: "git-tag",
        versionCmd: "sim-use --version",
        install: {
          preferred: "brew",
          brew: "lycorp-jp/tap/sim-use",
          fromVendor: "make install",
        },
      });
    }
  });

  test("rejects preferred without matching strategy", () => {
    const result = parseRuntimeSpec(
      {
        bin: "x",
        install: { preferred: "brew" },
      },
      "[runtime]",
    );
    expect(result.ok).toBe(false);
  });

  test("rejects literal without version", () => {
    const result = parseRuntimeSpec(
      { bin: "x", version_from: "literal" },
      "[runtime]",
    );
    expect(result.ok).toBe(false);
  });
});

describe("loadVendorRuntimeFile + resolveExpectedVersion", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "asm-runtime-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("loads asm.runtime.toml from vendor root", async () => {
    await writeFile(
      join(tmpDir, "asm.runtime.toml"),
      `[runtime]\nbin = "demo-cli"\nversion_from = "literal"\nversion = "2.0.0"\n\n[runtime.install]\nnpm = "demo-cli"\n`,
    );

    const loaded = await loadVendorRuntimeFile(tmpDir);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.value?.bin).toBe("demo-cli");
      expect(loaded.value?.version).toBe("2.0.0");
      expect(loaded.value?.install?.npm).toBe("demo-cli");
    }
  });

  test("missing file is ok(undefined)", async () => {
    const loaded = await loadVendorRuntimeFile(tmpDir);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.value).toBeUndefined();
    }
  });

  test("reads expected version from package.json", async () => {
    await writeFile(
      join(tmpDir, "package.json"),
      JSON.stringify({ name: "demo", version: "3.1.4" }),
    );
    const v = await resolveExpectedVersion(tmpDir, {
      bin: "demo",
      versionFrom: "package.json",
    });
    expect(v).toBe("3.1.4");
  });

  test("auto falls back to package.json", async () => {
    await writeFile(
      join(tmpDir, "package.json"),
      JSON.stringify({ name: "demo", version: "9.9.9" }),
    );
    const v = await resolveExpectedVersion(tmpDir, { bin: "demo" });
    expect(v).toBe("9.9.9");
  });
});

describe("checkOneRuntime", () => {
  let tmpDir: string;
  let binDir: string;
  let originalPath: string | undefined;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "asm-runtime-check-"));
    binDir = join(tmpDir, "bin");
    await mkdir(binDir, { recursive: true });

    const fakeBin = join(binDir, "fake-cli");
    await writeFile(fakeBin, "#!/bin/bash\necho 'fake-cli 1.2.3'\n");
    await chmod(fakeBin, 0o755);

    originalPath = process.env.PATH;
    process.env.PATH = `${binDir}:${originalPath ?? ""}`;

    await writeFile(
      join(tmpDir, "package.json"),
      JSON.stringify({ name: "fake-cli", version: "1.2.3" }),
    );
  });

  afterEach(async () => {
    process.env.PATH = originalPath;
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("status ok when versions match", async () => {
    const check = await checkOneRuntime("fake", tmpDir, {
      bin: "fake-cli",
      versionFrom: "package.json",
      install: { npm: "fake-cli" },
    });
    expect(check.status).toBe("ok");
    expect(check.expectedVersion).toBe("1.2.3");
    expect(check.installedVersion).toBe("1.2.3");
    expect(check.strategy).toBe("npm");
  });

  test("status behind when skill is newer", async () => {
    await writeFile(
      join(tmpDir, "package.json"),
      JSON.stringify({ name: "fake-cli", version: "9.0.0" }),
    );
    const check = await checkOneRuntime("fake", tmpDir, {
      bin: "fake-cli",
      versionFrom: "package.json",
    });
    expect(check.status).toBe("behind");
    expect(runtimeNeedsFix(check.status)).toBe(true);
  });

  test("status missing when bin not on PATH", async () => {
    process.env.PATH = "/nonexistent";
    const check = await checkOneRuntime("fake", tmpDir, {
      bin: "definitely-missing-cli-xyz",
      versionFrom: "package.json",
    });
    expect(check.status).toBe("missing");
    expect(runtimeNeedsFix(check.status)).toBe(true);
  });
});

describe("checkRuntimes integration with asm.toml", () => {
  let tmpDir: string;
  let registryDir: string;
  let binDir: string;
  let originalPath: string | undefined;
  let originalHome: string | undefined;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "asm-runtime-int-"));
    registryDir = join(tmpDir, "registry");
    binDir = join(tmpDir, "bin");
    await mkdir(join(registryDir, "vendor", "demo"), { recursive: true });
    await mkdir(binDir, { recursive: true });

    await writeFile(
      join(registryDir, "vendor", "demo", "package.json"),
      JSON.stringify({ name: "demo-cli", version: "2.0.0" }),
    );
    await writeFile(
      join(registryDir, "vendor", "demo", "SKILL.md"),
      "---\nname: demo\ndescription: demo\n---\n",
    );

    const fakeBin = join(binDir, "demo-cli");
    await writeFile(fakeBin, "#!/bin/bash\necho '1.0.0'\n");
    await chmod(fakeBin, 0o755);

    await writeFile(
      join(registryDir, "asm.toml"),
      `[config]\ndefault_scope = "user"\n\n[targets]\nclaude = "${join(tmpDir, "skills")}"\n\n[vendor.demo]\nurl = "https://example.com/demo.git"\n\n[vendor.demo.runtime]\nbin = "demo-cli"\nversion_from = "package.json"\n\n[vendor.demo.runtime.install]\nnpm = "demo-cli"\n`,
    );

    // Point HOME so readConfig via ~/.asmrc resolves if needed.
    // checkRuntimes with overrideRegistryPath uses the override asm.toml directly.
    originalHome = process.env.HOME;
    originalPath = process.env.PATH;
    process.env.HOME = tmpDir;
    process.env.PATH = `${binDir}:${originalPath ?? ""}`;
    await writeFile(join(tmpDir, ".asmrc"), registryDir + "\n");
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    process.env.PATH = originalPath;
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("detects behind runtime from registry config", async () => {
    const result = await checkRuntimes({ overrideRegistryPath: registryDir });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0].vendor).toBe("demo");
      expect(result.value[0].status).toBe("behind");
      expect(result.value[0].expectedVersion).toBe("2.0.0");
      expect(result.value[0].installedVersion).toBe("1.0.0");
      expect(result.value[0].strategy).toBe("npm");
    }
  });

  test("merges vendor asm.runtime.toml with local override", async () => {
    await writeFile(
      join(registryDir, "vendor", "demo", "asm.runtime.toml"),
      `[runtime]\nbin = "demo-cli"\nversion_from = "package.json"\n\n[runtime.install]\nfrom_vendor = "echo from-vendor"\nnpm = "demo-cli"\n`,
    );

    // Local preferred=npm should win over shipped from-vendor default order.
    await writeFile(
      join(registryDir, "asm.toml"),
      `[config]\ndefault_scope = "user"\n\n[targets]\nclaude = "${join(tmpDir, "skills")}"\n\n[vendor.demo]\nurl = "https://example.com/demo.git"\n\n[vendor.demo.runtime]\nbin = "demo-cli"\n\n[vendor.demo.runtime.install]\npreferred = "npm"\nnpm = "demo-cli"\n`,
    );

    const result = await checkRuntimes({ overrideRegistryPath: registryDir });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value[0].strategy).toBe("npm");
    }
  });
});

describe("runtimeNeedsFix", () => {
  test("only missing and behind need fix", () => {
    expect(runtimeNeedsFix("missing")).toBe(true);
    expect(runtimeNeedsFix("behind")).toBe(true);
    expect(runtimeNeedsFix("ok")).toBe(false);
    expect(runtimeNeedsFix("ahead")).toBe(false);
    expect(runtimeNeedsFix("unreadable")).toBe(false);
    expect(runtimeNeedsFix("no-expected")).toBe(false);
  });
});
