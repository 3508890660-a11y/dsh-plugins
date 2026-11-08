# DSH Plugins

DeepSeek Harness (DSH) 自研插件集合，monorepo 结构，每个子目录一个插件。

## 目录

| 插件 | 说明 |
| --- | --- |
| [dsh-novel-writer](dsh-novel-writer/) | 小说写作助手：句式/情感/意象分析、伏笔设定管理、本地语义检索、氛围光谱、风格画像报告、文笔六维基线带、原创模式与创作资料、写作哨兵（衔接/OOC/大纲） |
| [dsh-character-maker](dsh-character-maker/) | 角色设定工作坊：以九型人格为主干、MBTI / 大五为补充，外加 8 个 Likert 量表；15 种问卷计分、结构化角色卡、LLM 六节深度人格画像、关系网图，可与 dsh-novel-writer 双向联动 |
| [novel-editor](novel-editor/) | 小说编辑引擎（本地 novel-editor 模型，QLoRA 微调 Qwen3-4B）：校对/轻度修正/深度润色/一致性审查/去 AI 痕，经 Ollama 推理 |
| [shortnovel-workflow](shortnovel-workflow/) | 爆款短篇创作工作流：主题 → 脑洞(5) → 导语(5) → 大纲(10章×30情节点) → 正文(~1.2万字) → 审稿，严格分阶段 |
| [dsh-llm-ollama](dsh-llm-ollama/) | Ollama LLM 适配器，为 novel-editor / shortnovel-workflow 提供本地推理后端 |
| [dsh-ollama-probe](dsh-ollama-probe/) | Ollama 服务探针 |
| [dsh-llm-probe](dsh-llm-probe/) | LLM 通用探针 |

## 关于模型文件

`dsh-novel-writer` 的本地语义检索依赖一个 bge ONNX 模型
（`src/legacy/models/onnx/model_quantized.onnx`，约 311 MB）。
该文件超过 GitHub 单文件 100 MB 上限，未包含在本仓库中。
克隆后请把模型放到上述路径，或设置 `NOVEL_WRITER_MODEL_DIR` 指向模型所在目录。

## 构建

每个插件目录下均有 `scripts/build.sh`：

```bash
cd dsh-novel-writer && npm install && bash scripts/build.sh
```

## License

MIT
