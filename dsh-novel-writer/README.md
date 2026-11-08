# @dsh-external/dsh-novel-writer

> 自动化长篇小说写作系统（小说工坊）：统一模型网关、故事管理、记忆引擎、章节生成流水线、句式与文笔分析、连贯性审计、语义检索、导出、UI 面板。

由 dsh-super-injector 注入。既有基于项目的下一代模型（project 制），也完整移植了旧版 dsh-novel-writer 的**分析句库 / 章节浏览 / 设定 / 伏笔 / 连贯性审计 / 语义检索 / 导入排稿**功能，全部适配到项目数据模型上。

---

## 一、构建与注入

```bash
DSH_CHECKOUT=<dsh-desktop 绝对路径> node node_modules/typescript/bin/tsc -p tsconfig.json   # 宿主编译
npm run build:client                                 # 客户端 UI bundle（tsdown）
# 注入器环境内：dev_inject_plugin <本目录>           # 注入即生效（host + client）
# 改动后热重载：dev_reload_package @dsh-external/dsh-novel-writer
```

数据占位依赖：宿主脚本逐条注入到的 `src/legacy/` 提供了零依赖引擎（句式分析、文笔六维、语义嵌入的四七个模块），构建时需注意：
- `lib/legacy/lexicons/dutir_seven.json`、`lib/legacy/models/**`（onnx 嵌入模型）等资产需在 `tsc` 后同步复制进 `lib/legacy/`。
- 语义检索用到的 `onnxruntime-web`、`@huggingface/tokenizers` 为运行时依赖，需在插件 `node_modules` 中可解析（本地可能以 junction 链接到旧插件目录）。
- 宿主旧版 `dsh-novel-writer`（unscoped）与本插件（`@dsh-external/` 前缀）并存；不注销旧插件时重复工具名由 `index.ts` 里的 `ctx.tools.get(name)` 守卫跳过。若要让新插件独占总共 33 个 `novel_*` 名，请在配置文件里禁用旧插件并重启。

---

## 二、配置（插件配置面板 / Config Schema）

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `dataDir` | `''`（自动推导） | 数据目录。为空时按 `NOVEL_DATA_DIR` → 包根上级 `+ novel-writer-data` → DSH_HOME 依次推导 |
| `provider` | `ollama` | 正文生成默认 provider |
| `model` | `novel-lora` | 正文生成默认 model |
| `polishProvider` / `polishModel` | `ollama` / `novel-polish` | 润色默认模型 |
| `temperature` | `0.8` | 生成采样温度（0–2） |
| `maxTokens` | `8192` | 单次生成上限（256–65536） |
| `importLongThreshold` | `20000` | 设定文档超长分块阈值 |
| `importChunkChars` | `15000` | 超长文档每块字符数 |
| `importCloudProvider` / `importCloudModel` | `deepseek-official` / `deepseek-v4-flash` | 设定导入分块解析用的云端大模型（provider 不可用自动回退当前会话路由） |
| `styleKbDir` | `''`（自动推导） | 文风知识库根目录（含 `cards/` 子目录）。为空时按 `STYLE_KB_DIR` env → 插件工作目录 `+ style-kb`。指向后 `novel_style_kb` 可检索/绑定文风卡，写作/续写/润色自动注入对应文风 |

**模型回退**：默认本地 `ollama/novel-lora`；当该 provider/model 未注册（本地模型不可用）时，自动回退到 DSH 主会话当前路由（`ctx.llm` 捕获），保证随时可写。

---

## 三、数据模型（projects）

每个项目一个目录：`<dataDir>/projects/<projectId>/`

```
projects/<id>/
├─ data.json                 # 项目主数据（大纲/伏笔/人物/世界观/章节元数据 + styleCards 文风卡绑定）
├─ chapters/<chapterId>.md   # 章节正文
├─ chapters/backup/          # 润色覆盖前的原文备份
├─ exports/                  # novel_export 导出产物（md/txt/epub）
├─ 创作资料/                  # novel_outline：创作设定/人物/大纲/钩子/状态卡（md）
├─ plots.json                # novel_plot：伏笔登记表
├─ settings.json             # novel_settings：五张设定表
├─ summaries.json            # novel_summary：章节摘要
└─ audits/                   # novel_continuity_check 审计产物
```

示例数据目录：`F:\producing\tool\writer\novel-writer-data\`。

---

## 四、工具总览（33 个 novel_* 工具）

### A. 项目管理与章节生成（项目模型核心，16 个）

| 工具 | 说明 |
| --- | --- |
| `novel_project_create` / `novel_project_list` | 创建 / 列出项目（含进度） |
| `novel_outline_edit` / `novel_outline_list` | 创建/更新大纲节点（卷/章/拍），查看大纲树与未解伏笔 |
| `novel_volume_list` / `novel_volume_assign` | 分卷管理：列卷（章数/字数/卷内章节）/ 把章节划入卷或移出卷 |
| `novel_character_edit` / `novel_character_list` | 人物档案（外貌/性格/背景/目标/成长弧光/当前状态） |
| `novel_worldview_edit` / `novel_worldview_list` | 世界观条目（地理/历史/规则/文化/力量体系/其他） |
| `novel_foreshadowing_edit` | 手动管理伏笔（open/resolved/abandoned） |
| `novel_chapter_write` | 依大纲节点（summary+beats）生成一章，自动提取记忆 |
| `novel_chapter_get` / `novel_chapter_continue` | 读取章节 / 交互式续写或改写（append/rewrite） |
| `novel_chapter_polish` | AI 智能编辑（light 轻度修 / deep 深度润色，save 前可预览） |
| `novel_memory_update` | 手动修正章节记忆（摘要/事件/人物变化/物品） |
| `novel_export` | 导出 markdown / txt / epub |
| `novel_model_status` | 查看当前写作模型路由 |
| `novel_import_settings` | 批量导入设定文件（.md/.txt/.json/.yaml，超长自动分块+幂等） |

### B. 已移植 · 分析句库 + 章节浏览（8 个）

| 工具 | 说明 |
| --- | --- |
| `novel_books` | 列出全部作品（项目）：书名/id/题材/章节数/字数概况 |
| `novel_chapters` | 列出某作品的章节清单：章号/标题/状态/字数/摘要 |
| `novel_read` | 阅读章节正文（chapter 可用章号/标题子串/章节 id） |
| `novel_keywords` | 高频关键词统计（中文二字/三字词组 + 英文词，不含单字；可单章或全书） |
| `novel_sentence_analysis` | 九类句式分布、排列规律/模板/段首段尾/压缩节奏、句长、情感曲线、风格指纹与节奏建议（受 `novel_sentence_config` 开关控制；结果缓存落盘，`fresh=true` 重算） |
| `novel_sentence_config` | 查看/设置分析总开关 `enabled`、`autoAnalyze`、各工具独立开关 `tools`、功能开关 `features` |
| `novel_style_check` | 风格自检：对比某章与全书其他章节的风格指纹（句式/句长/情绪/文笔六维基线），输出相似度与偏差 |
| `novel_style_report` | 风格画像报告：聚合统计测量维度（句式指纹/高频词汇/情感/文笔六维基线带） |

> 说明：`novel_style_report` 中的文化基准/题材流派/氛围光谱/语义距离等维度的完整版见 C 组工具（`novel_settings detect`、`novel_sentence_analysis` 等），未接入项目模型的历史别名保持项目化参数 `projectId + chapter`。

### C. 已移植 · 综合管理 / 检索 / 导入（8 个）

| 工具 | 说明 |
| --- | --- |
| `novel_plot` | 伏笔/剧情线登记表：list/add/update/done/delete/scan 按项目维护 |
| `novel_settings` | 五张设定表（人物/地点/道具/时间线/世界观用语规范）；`detect` 自动判断文化基准（western/eastern/modern） |
| `novel_summary` | 章节摘要（模型生成、插件存储）：add/get/list/update/delete，避免重读 |
| `novel_outline` | 维护原创创作资料（创作设定/主次人物/剧情大纲/钩子记录/状态卡）于 `创作资料/` 目录 |
| `novel_continuity_check` | 连贯性审计：对照设定表扫描全书矛盾候选；`chapter` 衔接检查 / `outline` 大纲对照 / `ooc` 情绪哨兵模式 |
| `novel_semantic_search` | 语义检索（本地 onnx embedding，0 token）：自然语言检索语义相关段落 |
| `novel_import` | 批量导入原稿件：scan 预览分组 / apply 按组建并入项目；`book` 强制归并异名同书、`move` 移动原稿 |
| `novel_new_chapter` | 为项目创建新章节文件（默认取下一个章号，可指定显式章号/标题） |

> 工具合计 35 个；A 组 18 + B 组 8 + C 组 8 + 1（`novel_project_list` 同时列于 A）。

### D. 文风知识库适配（1 个）

| 工具 | 说明 |
| --- | --- |
| `novel_style_kb` | 文风知识库（style-kb/cards）适配：`list` 检索全部文风卡/手法卡（`tag`/`q` 过滤）；`get` 查看项目已绑定卡片与启用状态；`bind`/`unbind` 绑定/解除（可多张并存，cards 接受 key 或标题/作品名柔性匹配）；`set_enabled` 切换某卡启用（启用集合=项目默认注入集）；`preview` 预览注入 system prompt 的文风块。绑定后 `novel_chapter_write` / `novel_chapter_continue` 默认注入启用的卡，也可传 `styleCards` 临时按本章选用 |

> 工具合计 36 个（含 D 组 `novel_style_kb`）。

---

## 五、使用方法（给 DSH 会话 / Agent）

**快速上手（三句话）：**
1. 开书：让 AI 用 `novel_project_create` 建项目 + `novel_worldview_edit` 建世界观 + `novel_character_edit` 建人物 + `novel_outline_edit` 建大纲。
2. 写章：说「写第一章」；每次续写用 `novel_chapter_write` / `novel_chapter_continue`，AI 自动拼接前情记忆。
3. 导出：说「导出 epub」→ `novel_export` → 产物在 `exports/`。

**分卷（正文按卷组织）：** 卷就是大纲里的 `type=volume` 节点——先 `novel_outline_edit`（type=volume）建卷，再建章节时把 `parentId` 指向卷（或事后用 `novel_volume_assign` 把已有章节划入/移出卷）。生成时模型自动获得【所在卷】上下文（卷序+卷概要+本卷第 N 章），导出时 md/txt/epub 按卷分组（epub 目录为卷→章嵌套，每卷有卷首页）。旧项目的大纲卷结构会在加载时自动同步到正文记录的 `volumeId`，无需迁移。

**分析 / 审阅类话术样例：**
```
把《【书名】》整个分析一遍：剧情脉络、写作手法、高频关键词（novel_keywords）。
```
```
看《【书名】》第【N】章的句式分布和情感曲线，跟全书比风格有没有跑偏（novel_sentence_analysis + novel_style_check）。
```
```
给《【书名】》做个连贯性体检（novel_continuity_check）：有没有设定矛盾、人物缺场、数字口径问题；再查未回收伏笔（novel_plot）。
```
```
检索《【书名】》里"主角心底对血统秘密的压抑"相关的段落（novel_semantic_search）。
```
```
把 F:\path\原稿\ 导入为《【书名】》的章节，先 scan 看分组再 apply（novel_import）。
```

**文风卡（拟真对应作者的文风 / 手法）：**
```
给《【书名】》绑上米泽穗信和设定系反推理这两张文风卡（novel_style_kb action=list q=米泽 / q=设定系 看 key，
再 action=bind projectId=<id> cards=["c085-yonezawa-honobu","hands02-setting-detective"]）。
之后写每一章都自动按它俩的文风来。
```
- 多张并存：`bind` 可一次绑多张；`set_enabled` 逐张开/关，启用集合即默认注入集。
- 按需选用：生成/续写时给 `styleCards` 传本次要用的 key（不必覆盖项目绑定）——`novel_chapter_write(chapterId=…, styleCards=["hands02-setting-detective"])`。
- 预览注入：`novel_style_kb action=preview projectId=<id>` 看会把什么文风块注入 system prompt（每张 ≤700 字符、默认最多 3 张）。
- 卡片不落项目正文：绑定只存卡片 key；蒸馏发生在生成时，卡片文件缺了会静默跳过且不影响其它卡。
- UI：小说工坊面板新增「文风」tab，可检索、绑定、启用/停用、移除并预览注入文风。

详细分场景模板、完整样例与技巧见 **[PROMPT-GUIDE.md](./PROMPT-GUIDE.md)**、润色指南见 **[POLISH-GUIDE.md](./POLISH-GUIDE.md)**。

> 注意：新插件是**项目制**，所有带章节参数的工具都用 `projectId` + `chapter`（章号/标题子串/章节 id），不再是旧版全局的 `root` + `book` 目录式。旧版已有的同名工具若未禁用会优先命中旧实现，重启并禁用旧插件后新版独占全部 `novel_*`。

---

## 六、移植自旧 dsh-novel-writer 的功能

本插件在项目模型之上完整迁移了旧版以下能力：
- 句式模式分析（九类句式、转移、模板、段首段尾、压缩节奏序列、句长、情感曲线、风格指纹、节奏建议）
- 高频关键词提取、被动作品/章节浏览（books/chapters/read）
- 风格自检与风格画像报告（文笔六维基线带）
- 全球设定五表 + 文化基准自动检测（western/eastern/modern）、语用扫描
- 章节摘要、连续性审计（数字口径/人物缺场/衔接/大纲对照/OOC 哨兵）、伏笔登记表（scan 更新提及）
- 语义检索（本地 onnx embedding，bge-large-zh-v1.5 量化模型，1024 维降采样至 256 维，zstd + 指纹增量索引缓存）
- 批量导入原稿件（scan/apply、异名同书强制归并、GBK 兼容）

> 语义检索与题材/氛围检测依赖本地嵌入引擎（onnxruntime-web + @huggingface/tokenizers）与 `lib/legacy/models/` 模型文件；该 onnx 模型（约 311 MB）**不随 npm 包分发**，需单独放置到 `lib/legacy/models/onnx/model_quantized.onnx`。若资源缺失，`novel_semantic_search` 会返回「不可用」提示，其余功能不受影响。