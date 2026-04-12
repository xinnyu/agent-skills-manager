# Skill 写作指导

## 核心设计原则：渐进式披露

Skill 的灵魂是**三级渐进式加载**：

| 层级 | 加载时机 | 放什么 | 对应文件 |
|------|---------|--------|---------|
| 1. YAML frontmatter | **始终**在上下文中 | 仅"何时使用"的判断信息（~100 words） | `SKILL.md` 顶部 `---` 块 |
| 2. SKILL.md 正文 | Claude 认为相关时加载 | 核心指令，< 500 行 | `SKILL.md` |
| 3. 支持文件 | Claude **按需读取** | 详细参考、示例、脚本（无限制，脚本可以不加载直接执行） | `references/`, `scripts/`, `assets/` |

**实践要点**：
- SKILL.md 只放"做事需要的最少信息"，详细文档放 `references/`
- 引用支持文件时说明**是什么** + **什么时候该读**
- 超过 500 行 → 拆分到支持文件
- 大的 reference 文件（>300 行）加目录（TOC），方便定位

## 目录结构

```
<skill-name>/           # kebab-case，不含空格/大写
├── SKILL.md            # 必需，大小写敏感
├── scripts/            # 可选，放可执行脚本
├── references/         # 可选，放详细参考文档
└── assets/             # 可选，放模板等资源
```

关键规则：
- 文件名必须是 `SKILL.md`（不是 `skill.md`）
- 文件夹和 name 字段都用 kebab-case
- **不要**放 `README.md`

**多领域/多框架 skill** 按 variant 拆分 references，SKILL.md 只放路由逻辑：
```
cloud-deploy/
├── SKILL.md           # 工作流 + 根据上下文选择读哪个
└── references/
    ├── aws.md
    ├── gcp.md
    └── azure.md
```
Claude 只读相关的那个文件，不浪费上下文。

## 创建流程

### 1. 捕获意图

先从当前对话中提取答案 — 用户用了什么工具、什么步骤、做了什么修正、输入输出长什么样。然后让用户补缺口：

1. 这个 skill 让 Claude 做什么？
2. 什么时候该触发？（用户会说什么话）
3. 预期的输出格式是什么？
4. 有没有边界情况、依赖、特殊约束？

### 2. 编写 YAML Frontmatter

```yaml
---
name: <kebab-case-name>
description: <做什么>. Use when <触发条件和用户常说的短语>.
---
```

**description 规则**（最关键的部分）：
- 必须同时包含：**做什么** + **何时用**
- 不超过 1024 字符，不含 XML 标签（`<` 或 `>`）
- 包含用户可能说的具体短语（中英文）
- 不要描述 skill 内部流程步骤

**description 要"pushy"**：Claude 倾向于不触发 skill（undertrigger），所以 description 要主动覆盖更多场景。

差的例子：
> "How to build a simple fast dashboard to display internal data."

好的例子：
> "How to build a simple fast dashboard to display internal data. Make sure to use this skill whenever the user mentions dashboards, data visualization, internal metrics, or wants to display any kind of data, even if they don't explicitly ask for a 'dashboard.'"

**理解触发机制**：Claude 只对自己不能轻松搞定的任务触发 skill。简单的一步操作（如"读一下这个文件"）即使 description 完美匹配也不会触发，因为 Claude 自己就能做。eval 的测试用例要足够复杂，才能真实反映触发行为。

### 3. 编写 SKILL.md 正文

**写作风格**：
- 用祈使句写指令
- 指令要具体可执行（给命令，不要说"验证一下"）
- 关键指令放前面，不要被埋
- 脚本放 `scripts/`，在指令中引用路径

**解释 why，而非堆砌 MUST**：今天的 LLM 很聪明，有理论心智。与其用全大写的 ALWAYS/NEVER 强制行为，不如解释为什么这么做重要。让模型理解原因，它能举一反三处理 edge case，而死板指令只能覆盖你想到的场景。如果发现自己在写全大写指令，停下来想想能不能换成解释原因。

**示例格式**：
```markdown
## Commit message format
**Example 1:**
Input: Added user authentication with JWT tokens
Output: feat(auth): implement JWT-based authentication
```

**定义输出格式**：
```markdown
## Report structure
ALWAYS use this exact template:
# [Title]
## Executive summary
## Key findings
## Recommendations
```

### 4. 验证

创建完成后执行以下检查：

```bash
# 1. 文件名正确
ls -la <skill-path>/SKILL.md

# 2. frontmatter 格式正确
head -5 <skill-path>/SKILL.md

# 3. name 是 kebab-case
grep "^name:" <skill-path>/SKILL.md

# 4. description 包含触发条件
grep "^description:" <skill-path>/SKILL.md

# 5. 无 README.md
test ! -f <skill-path>/README.md && echo "OK: no README.md"
```

## 改进已有 Skill

### 改进原则

1. **泛化，不过拟合**：skill 会被无数次使用，不要为几个测试用例做窄优化。遇到顽固问题，试试换个比喻、换个工作模式，而不是加更多限制性指令。

2. **保持精简**：去掉没效果的内容。读 transcript 找浪费时间的步骤，砍掉导致它们的 skill 指令。

3. **解释 why**：理解用户真正想要什么，把这个理解传递到指令中。如果用户反馈简短或沮丧，深入理解任务本身，而非机械地打补丁。

4. **提取重复脚本**：如果多个测试用例都独立写了类似的 helper 脚本（比如都写了 `create_chart.py`），说明 skill 应该自带这个脚本。写一次，放 `scripts/`，让所有调用复用。

## Checklist

创建或审查 skill 时逐项检查：

- [ ] 文件夹 kebab-case
- [ ] `SKILL.md` 大小写正确
- [ ] YAML `---` 分隔符完整
- [ ] name 是 kebab-case，与文件夹名匹配
- [ ] description 包含做什么 + 何时用 + 触发短语
- [ ] description 足够 "pushy"，覆盖近义表达
- [ ] description < 1024 字符，无 XML 标签
- [ ] 无 `README.md`
- [ ] 指令用祈使句，具体可执行
- [ ] 解释 why 而非堆砌 MUST
- [ ] SKILL.md < 500 行
- [ ] 脚本在 `scripts/` 且可执行
- [ ] 渐进式披露：核心流程在 SKILL.md，详细内容在支持文件
- [ ] 大 reference 文件有 TOC

## 诊断报告格式（修复/审查时使用）

```
## [skill-name] 诊断报告

通过: X/Y 项
问题: Z 项

### 问题列表
1. [严重程度: 高/中/低] 问题描述
   位置: 文件:行号
   修复建议: 具体怎么改

### 建议优化（非必须）
- 优化建议...
```

严重程度：
- **高**：skill 不工作（frontmatter 错误、文件名错误）
- **中**：影响触发准确性或可维护性
- **低**：可改进但不影响功能
