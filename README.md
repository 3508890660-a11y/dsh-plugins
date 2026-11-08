# DSH Plugins

DeepSeek Harness (DSH) 自研插件集合。每个子目录一个独立插件，仓库根**没有** workspace / package.json 配置，只是目录聚合（不是真正的 monorepo）。

全部插件 `license` 均为 **BSD-3-Clause**，但仓库内**尚未包含任何 LICENSE 文件**（见文末「已知缺口」）。

## 目录

| 插件 | 版本 | 许可 | 工具数 | 说明 |
| --- | --- | --- | --- | --- |
| [dsh-novel-writer](dsh-novel-writer/) | 0.0.1 | BSD-3-Clause | 41 | 长篇小说写作系统：统一模型网关、故事/章节管理、记忆引擎、生成流水线、句式/情感/意象分析、本地语义检索、风格画像、创作资料、写作哨兵（衔接/OOC/大纲）、导出 |
| [dsh-character-maker](dsh-character-maker/) | 0.0.1 | BSD-3-Clause | 18 | 角色设定工作坊：以九型人格为主干，MBTI / 大五（BFI-2、IPIP-NEO-120）为补充，外加 8 个 Likert 量表（HEXACO / SD3 / 依恋 / 控制点 / 道德 / 价值观 / DISC / 同理心）；15 种问卷计分、结构化角色卡、LLM 六节深度人格画像、SVG 关系网；可与 dsh-novel-writer 双向联动 |
| [novel-editor](novel-editor/) | 0.1.0 | BSD-3-Clause | 4 | 小说编辑引擎（本地 QLoRA 微调 Qwen3-4B，经 Ollama 推理）：`proofread` / `light` / `deep` / `consistency` / `detrace` 五档编辑 + AI 痕诊断 + 编辑引擎状态 |
| [shortnovel-workflow](shortnovel-workflow/) | 0.1.0 | BSD-3-Clause | 8 | 墨安式爆款短篇创作工作流：主题 → 脑洞(5) → 导语(5) → 大纲(**10 章 × 10 剧情点**) → 正文(强去 AI 味，一句一行，~1.2 万字) → 审稿；严格分阶段、逐阶段确认 |
| [dsh-llm-ollama](dsh-llm-ollama/) | 0.0.1 | BSD-3-Clause | — | Ollama LLM 适配器：经 OpenAI 兼容 chat completions API 注册 `ollama` provider 路由；为 novel-editor / shortnovel-workflow 提供本地推理后端 |
| [dsh-ollama-probe](dsh-ollama-probe/) | 0.0.1 | BSD-3-Clause | — | Ollama 适配器集成探针：apply 时跑自检并记日志 |
| [dsh-llm-probe](dsh-llm-probe/) | 0.0.1 | BSD-3-Clause | — | LLM 通用探针（最小插件，6 个文件） |

> 「工具数」= 该插件通过 `defineTool` 注册、对 agent 可见的工具数量。`—` 表示不注册工具（注册的是 LLM provider 或自检逻辑）。

## 关于模型文件

`dsh-novel-writer` 的本地语义检索（`novel_semantic_search`）依赖一个 bge ONNX 嵌入模型，超过 GitHub 单文件 100 MB 上限，未包含在本仓库中。

**放置路径是硬编码的**，源码 `lib/legacy/embedding.js`：

```js
const MODEL_DIR = path.join(__dirname, "models");
```

运行时 `__dirname` 为 `lib/legacy`，因此模型需放到：

```
dsh-novel-writer/lib/legacy/models/onnx/model_quantized.onnx   # 约 311 MB
```

同目录下还需 `tokenizer.json`（约 450 KB，**已在仓库中**）。`model_quantized.onnx` 与 `model.onnx` 两个文件名都会被识别，优先用前者。

仓库里保留了一份空目录结构说明：`src/legacy/models/` 有 `config.json`、`tokenizer.json`、`tokenizer_config.json`、`special_tokens_map.json`，唯独缺 `onnx/`。

## 构建

除 `dsh-llm-probe` 外，每个插件都有 `scripts/build.sh`：

```bash
cd dsh-novel-writer && npm install && bash scripts/build.sh
```

`dsh-character-maker` 额外提供 `scripts/build.ps1`。

**`dsh-llm-probe` 没有构建脚本**——它只发布 `lib/`，没有独立的构建步骤；本地依赖用 `link-deps.mjs` 链接。

## 仓库结构说明

- 每个插件同时包含 `src/`（TypeScript 源码）和 `lib/`（构建产物）。
  `lib/` 之所以纳入版本管理，是因为 DSH 按 `package.json` 的 `main` 字段加载 `./lib/index.js`；但 `dsh-character-maker` 自身的 `.gitignore` 排除了 `lib/`，该目录是用 `git add -f` 强制纳入的。
- 根 `.gitignore` 排除：`node_modules/`、`dist/`、`*.log`、`.DS_Store`、`*.onnx`、`%SystemDrive%/`。
- 上传时另有意排除了：各插件的 `node_modules/`（其中多为 DSH peer 依赖的类型存根）、`%SystemDrive%` 误建缓存目录，以及 `charactor setting maker/plugins/character-maker-data/`（角色库运行时数据，非插件源码）。

## 已知缺口

按实际检查结果记录，未在本次提交中修复：

| # | 问题 | 详情 |
| --- | --- | --- |
| 1 | 缺少 LICENSE 文件 | 7 个插件的 `package.json` 都声明 `BSD-3-Clause`，但仓库内一个 `LICENSE` 文件都没有 |
| 2 | 只有 2/7 插件带 README | 仅 `dsh-novel-writer` 与 `dsh-character-maker` 有；其余 5 个无任何文档 |
| 3 | `dsh-character-maker/README.md` 工具数过时 | 自称「工具（15 个）」，实际注册 18 个——漏列 `character_dynamics`、`character_triads`、`character_essentials` |
| 4 | `novel-editor/package.json` 描述过时 | description 未提及 `detrace`（去 AI 痕）档，但源码 `EditMode` 确有 5 档 |
| 5 | `dsh-llm-probe` 缺 description | `package.json` 无 `description` 字段 |
| 6 | 只有 `dsh-character-maker` 带 cordis patch | `dsh-novel-writer` 等 6 个插件的 `dsh.bundle` 均为 `{}` 且不带 `cordis.patch.yml`——这与它们的 `package.json` 自洽，但是否为有意设计（还是漏了 patch）无法从仓库本身判断 |
| 7 | `dsh-novel-writer` 的 `src/legacy/` 与 `lib/legacy/` 不同版本 | 5 个共有文件（`analysis.js` / `embedding.js` / `markers.js` / `vibe.js` / `style-metrics.js`）SHA256 全部不一致，`src/legacy/` 下的 JS 与 `lib/legacy/` 的构建产物并非同一版本 |

## License

BSD-3-Clause（依据各插件 `package.json` 的 `license` 字段；LICENSE 文件待补）。
