---
name: asm
description: "Manage AI agent skills via ASM (Agent Skills Manager). Use when user asks to install, remove, search, upgrade, list, scan, discover, create, fix, or review skills. Triggers on: \"装 skill\", \"安装 skill\", \"搜索 skill\", \"列出 skill\", \"升级 skill\", \"扫描 skill\", \"发现 skill\", \"散装 skill\", \"加 skill\", \"把 skill 加到\", \"帮我加一下\", \"asm\", \"install skill\", \"add skill\", \"remove skill\", \"search skill\", \"upgrade skill\", \"scan skill\", \"discover skill\", \"list skills\", \"skill 管理\", \"创建 skill\", \"写个 skill\", \"create a skill\", \"build a skill\", \"新建 skill\", \"修复 skill\", \"fix skill\", \"检查 skill\", \"审查 skill\", \"改进 skill\", \"优化 skill\"."
---

# ASM (Agent Skills Manager)

ASM 管理你所有的 AI agent skill。一个 git 仓库（registry）集中存储，通过 symlink 分发到各 agent 的 skills 目录。

## 核心概念

### Registry（仓库）

所有 skill 的集中存储，路径记录在 `~/.asmrc`（当前为 `/Users/pxy/Developer/asm-skills`）。

```
asm-skills/
  core/            # 自研 skill（每个子目录包含一个 SKILL.md）
    my-skill/
      SKILL.md     # 必须存在，定义 skill 元数据和内容
  vendor/          # 第三方 skill
    opencli/       # git submodule（远程 vendor）
    local-repo/    # symlink（本地 vendor）
  asm.toml         # registry 配置
```

每个 skill 目录下必须包含 `SKILL.md` 文件，ASM 通过递归扫描 `SKILL.md` 来发现 skill。

### Manifest（清单）— 控制哪些 skill 被同步

Manifest 决定 registry 中的哪些 skill 会被 symlink 到目标目录。分两级：

**用户级 manifest** `~/.asm/skills.toml` — 控制同步到 `~/.claude/skills/` 的 skill：

```toml
# 引用整个 vendor 包（自动包含其所有 skill）
vendors = ["agent-skills-manager", "loom"]

# 精确指定单个 skill（core 或 vendor 中的都行）
required = ["codex-code-review", "debug-loop"]
```

**项目级 manifest** `<project>/.asm/skills.toml` — 控制同步到项目级 agent 目录的 skill：

```toml
vendors = ["opencli"]
required = ["my-project-skill"]
```

项目级目标目录：

- Claude: `<project>/.claude/skills/`
- Codex: `<project>/.agents/skills/`

**不写 manifest** = registry 中所有 skill 全部同步（向后兼容）。

### Sync（同步）流程

`asm sync` 执行时：
1. 扫描 registry 中所有 skill
2. 用用户级 manifest 过滤 → symlink 到 `~/.claude/skills/`
3. 用项目级 manifest 过滤 → symlink 到 `<project>/.claude/skills/` 和 `<project>/.agents/skills/`
4. 验证 required 的 skill 是否都在 registry 中

### 三种管理状态

| 状态 | 说明 | 操作 |
|------|------|------|
| 在 registry 中 + 在 manifest 中 | 已纳管 + 已启用，sync 会创建 symlink | 正常使用 |
| 在 registry 中 + 不在 manifest 中 | 已纳管但未启用，`asm list` 可见但不会同步 | 需要时加到 manifest |
| 不在 registry 中 | 未纳管 | 用 `asm create`（自研）或 `asm add`（第三方 vendor） |

## 命令参考

```bash
# 初始化 registry（首次使用）
asm init [path]

# 查看所有 registry 中的 skill
asm list

# 查看某个 skill 的详细信息
asm info <name>

# 创建自研 skill（在 core/ 下创建目录 + SKILL.md 模板）
asm create <name>

# 添加远程 vendor（git submodule）
asm add <name> --url <git-url>

# 添加本地 vendor（symlink，改了即生效）
asm add <name> --path /path/to/local/repo

# 移除 skill 或 vendor
asm remove <name>

# 升级 vendor skill 到最新版本
asm upgrade [name]
asm upgrade --dry-run

# 同步 symlink（根据 manifest 重建所有 symlink）
asm sync

# 扫描目标目录中未被 ASM 管理的 skill
asm scan
asm scan --adopt --auto

# 全盘发现散落在各项目中的 skill
asm discover
asm discover --roots ~/Developer,~/Projects
asm discover --json

# 启动 Web UI
asm ui
```

## CLI 路径

```bash
bun run /Users/pxy/Developer/agent-skills-manager/src/cli.ts -- <command>
```

## Vendor 两种模式

```toml
# asm.toml
[vendor.opencli]
url = "https://github.com/nicepkg/opencli.git"   # 远程：git submodule

[vendor.asm]
path = "/Users/pxy/Developer/agent-skills-manager"  # 本地：symlink，改了即生效
```

一个 vendor repo 可以包含多个 skill，ASM 会递归扫描所有 `SKILL.md`。

## 常见操作示例

### 添加一个第三方 skill 并启用

```bash
asm add awesome-skills --url https://github.com/user/awesome-skills
```
然后在 `~/.asm/skills.toml` 的 `vendors` 中加入 `"awesome-skills"`，再 `asm sync`。

### 只纳管不启用

把 skill 目录复制到 `core/` 下，但不加到任何 manifest。`asm list` 可见，但不会同步到 skills 目录。

### 给项目配置专属 skill

在项目根目录创建 `.asm/skills.toml`：
```toml
required = ["project-specific-skill"]
vendors = ["some-vendor"]
```
运行 `asm sync`，skill 会被 symlink 到 `<project>/.claude/skills/` 和 `<project>/.agents/skills/`。

### 自主发现 skill

当你需要某个能力但不确定有没有对应的 skill：
1. `asm list` — 看已安装的
2. `asm search <关键词>` — 搜索远程索引
3. `asm add <name> --url <git-url>` — 添加搜到的 vendor
4. 按需更新 manifest，`asm sync`

### 发现散装 skill

当用户想知道各项目中散落了哪些 skill，或者说"发现 skill"、"散装 skill"时：

```bash
# 从 home 目录递归扫描所有 .claude/skills/ 和 .agents/skills/
asm discover

# 限定搜索范围
asm discover --roots ~/Developer,~/Projects

# JSON 输出，方便脚本处理
asm discover --json
```

`discover` 与 `scan` 的区别：
- `scan` — 扫描 ASM 配置的 target 目录（如 `~/.claude/skills/`），找目录内未管理的 skill
- `discover` — 递归扫描整个文件系统，找散落在各个项目中的 skill

### 创建新 skill

当用户说"创建 skill"、"写个 skill"、"新建 skill"时：

1. **确定定位**：与用户确认做什么、何时触发、放哪里（用户级 vs 项目级）
2. **创建骨架**：`asm create <name>` 创建目录 + SKILL.md 模板
3. **编写内容**：读取 `references/writing-skills.md` 获取写作指导，填充 SKILL.md
4. **加到 manifest**：按需加到用户级或项目级 `skills.toml`
5. **同步**：`asm sync`

### 修复/审查 skill

当用户说"修复 skill"、"检查 skill"、"审查 skill"时：

1. 读取目标 skill 的所有文件
2. 按 `references/writing-skills.md` 中的 checklist 逐项审查
3. 输出诊断报告，等用户确认后再修改

---

## 参考文件

| 文件 | 内容 | 何时读取 |
|------|------|---------|
| `references/writing-skills.md` | Skill 写作指导：渐进式披露、frontmatter 规则、正文写法、checklist | 创建或修复 skill 时 |
