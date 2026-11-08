# novel-polish 润色模型使用指南

本地训练的润色模型（Qwen2.5-1.5B QLoRA，微调自日轻语料润色指令数据集）。当前版本 **v4**（v1 数据 30 对 + 强化 SYSTEM，12 steps，eval 1.42）。三种使用方式，按推荐顺序：

## ⚠️ 完整性保护（v4 起，重点）

novel-polish 为 1.5B 量化小模型，重写 5-8K 字长文时可能出现**截断、段落重复、杂讯、顺序颠倒、编辑元话语**（如「纠错：…」）。系统已内置**落盘前完整性自检**（`detectPolishDamage`）：

- **检测规则**：字符数比（<0.5 截断 / >2.5 膨胀）、长段重复（相邻行相同 ≥20 字 / 40 字窗口子串）、替换符 `\uFFFD`、字符堆叠（≥8 连）、编辑元话语（「纠错：/注：/说明：」等原文没有的回应式行）
- **save=true 时**：检测未通过 → **不落盘**，返回 `blocked` + 完整润色稿，由你确认或手动修正后再保存；通过才落盘（原文自动备份到 `chapters/backup/`）
- **save=false / UI 预览**：检测提示以黄色警告条展示（不阻止进入编辑态，保存前人工核对全文）
- 顺序颠倒无法可靠自动检测 → 靠「预览核对 + 原文备份」兜底
- 已真实验证：novel-polish 输出 1125/4763 字（截断）时 save=true 被拦截，正文零改动

## 方式一：DSH Desktop 对话直接润色（推荐）

1. **切换模型**：DSH Desktop 会话顶部的模型选择器 → 展开「Ollama 本地」→ 选 **novel-polish**（适配器动态读取 Ollama 模型列表，无需重启）。
2. **让 AI 调润色工具**，直接说，例如：

   > 用 novel_chapter_polish 把《剑与灰烬》第一章轻度润色一下，mode=light，不落盘先预览

   或指定方向（focus）：

   > 深度润色第一章，focus=动作描写更细致、更有节奏感，直接保存

3. **工具参数**（novel_chapter_polish）：
   | 参数 | 说明 | 默认 |
   |---|---|---|
   | projectId | 项目 id | 必填 |
   | chapterId | 章节 id | 必填 |
   | mode | `light` 轻度修正（错别字/语病/标点/逻辑，不扩写）／`deep` 深度润色（增强表现力，可适度扩写） | `deep` |
   | focus | 重点方向（对话口语化 / 动作细致 / 节奏更快 / 氛围感 / 心理细腻 / 悬念感 …） | 无 |
   | save | `true` 覆盖正文（原文自动备份到 `chapters/backup/`）／`false` 只返回预览 | `true` |

> ⚠️ 注意：novel_chapter_polish 跟随**当前会话主模型路由**——想用本地润色模型，就必须在模型选择器里先选中 novel-polish；不切换则走当前模型（如 deepseek）。

## 方式二：小说工坊 UI 按钮

1. 打开小说工坊 →「章节阅读」tab → 选中章节。
2. 点「AI 润色」→ 选模式（轻度/深度）+ 填润色方向 → 点生成。
3. 润色稿进入编辑态，**可人工再改**，确认后保存（原文自动备份）。

## 方式三：Ollama CLI 直用（不经 DSH）

```powershell
ollama run novel-polish
```

然后粘贴：

```
请润色以下小说段落：增强画面感与感官描写，让叙述更生动立体，可适度扩写，不改变情节走向。

【原文】
<粘贴正文>

【润色后】
```

或用 API（脚本场景）：

```powershell
$body = @{ model='novel-polish'; messages=@(@{role='user'; content='请轻度修正以下小说段落：修正错别字、语病、标点与逻辑硬伤，保持原意、结构与篇幅，不扩写。

【原文】
<正文>

【润色后】'}); stream=$false } | ConvertTo-Json -Depth 5
Invoke-RestMethod -Uri http://127.0.0.1:11434/api/chat -Method Post -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes($body)).message.content
```

## 模型规格与建议

| 项 | 值 |
|---|---|
| 模型名 | `novel-polish:latest`（986MB，q4_k_m） |
| 上下文 | num_ctx 16384（32K 提示词内安全） |
| 参数 | temperature 0.7 / top_p 0.9 / repeat_penalty 1.15 / stop `<|im_start|>` `<|im_end|>` |
| 速度 | 3060 Laptop 本地 ~40-50 t/s，千字章节约 1-2 分钟 |
| 显存 | 峰值约 5GB（6GB 卡可用，建议关闭其他显存大户） |

**使用建议**
- **日常校订用 `light`**：只修硬伤，最稳，不会动剧情与人设。
- **`deep` 适合推敲名场面**：画面感/节奏提升明显，但**实体保真有限**（1.5B 能力上限）：角色名/关键道具可能漂移（「印」→「手镯」、「烬语」→「烬」），也可能输出过短丢掉段落——**务必先预览核对全文再保存**，或 focus 里点名「保持所有角色名、道具、地名不变」。
- 数据层已做半角→全角标点清洗，输出标点规范；v4 已修复循环/markdown/注释类结构性污染，但实体保真仍需人工把关——**完整性检测 + 原文备份是最后防线**。

## 训练数据与再训练

- 数据集：`lora-pipeline/polish-dataset/{train,val}.jsonl`（(指令, 原文, 润色稿) 对，qwen3:4b 生成 + 质量过滤 + 标点清洗）。
- 训练：`lora-pipeline/03b_train_polish.py`（Qwen2.5-1.5B QLoRA）；导出部署：`04_export.py --name novel-polish --num-ctx 16384 --ollama-bin F:\Ollama\ollama.exe`。
- 想提升某类润色（如更口语化），可扩充指令池后重跑 `05_build_polish_dataset.py --pairs N` 补数据 → 重训 → 重部署。
