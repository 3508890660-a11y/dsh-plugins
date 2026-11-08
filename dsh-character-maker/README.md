# @dsh-external/dsh-character-maker

角色设定工作坊：以九型人格（Riso-Hudson 精简版）为主干、MBTI 与大五（BFI-2 / IPIP-NEO-120）为补充，
外加 8 个 Likert 维度量表（HEXACO / SD3 / 依恋 / 控制点 / 道德 / 价值观 / DISC / 同理心），
为小说创作产出结构化角色卡 + LLM 六节深度人格画像；可与姊妹插件 dsh-novel-writer 双向联动。

## 能力总览

**工具（15 个）**

| 工具 | 用途 |
|---|---|
| `character_new` | 新建角色（九型 / MBTI / 大五 / 外貌 / 背景 / 目标） |
| `character_questionnaire` | 跑 15 种问卷之一并计分写回（缺题 >10% 拒绝，可用 `allowPartial` 强制） |
| `character_quiz_history` | 作答历史与完整明细（原始作答 + 计分明细，可复盘 / 重算） |
| `character_profile` | 完善角色模型 + LLM 六节深度画像（支持 novel 联动与 overrides） |
| `character_trait_writer` | LLM 深度特质稿（standard / deep） |
| `character_voice` | 声音五件套：气质 / 口头禅 / 雷区 / 压力反应 / 成长反应 |
| `character_list` / `character_delete` | 角色库管理 |
| `character_subtypes` | 九型 27 亚型速查 |
| `character_relation_add` / `_list` / `_delete` | 角色互动（关系网边）管理 |
| `character_interaction_analyze` | LLM 深度分析两角色互动并登记为关系网边 |
| `character_selftest` | 插件自检（58 项：全部计分器 + 派生逻辑 + 存储迁移） |
| `novel_characters_link` | novel-writer 项目与人物联动清单 |

**client UI（4 个 tab）**

1. **本地角色** — 角色卡列表，展开看完整框线角色卡
2. **📝 问卷作答** — 在 UI 内直接跑问卷：选题 → 逐题作答（是/否、二选一、李克特量表）→ 提交计分 → 查历史与明细
3. **novel-writer 联动** — 拉项目人物，一键生成角色详析并写回 `personalityProfile`
4. **🌐 关系网** — SVG 力导向关系图：节点按定位着色、边按立场配色、点节点/边看详情、登记互动、一键全项目分析

**HTTP API**（前缀 `/@dsh-external/dsh-character-maker/api`）

- GET：`status` `revision` `characters` `character?id` `card?id` `banks` `novel-projects` `novel-characters?projectId` `novel-status?projectId`
- GET（问卷）：`quiz-banks` `quiz-questions?kind&from&to` `quiz-history` `quiz-record?id`
- GET（关系网）：`interactions?projectId` `interaction?id` `relationship-graph?projectId`
- POST：`analyze` `interactions` `interactions/analyze` `interactions/analyze-all` `quiz-score`
- POST/DELETE：`interactions/delete?id`（**不接受 GET**，删除是写操作）

## 数据与迁移

- 单文件 `<dataDir>/characters.json`，原子写（tmp + rename），每次落盘 `revision + 1`。
- `schemaVersion` 当前为 **3**；旧版数据（v1/v2）在首次读取时自动迁移：
  - 按当前知识库**重推导**九型派生文案（virtue / wingNick / subtypeLabel …）
  - 保留用户自由文本与实测数据；`persona` / `keywords` 等遗留字段移入 `library.legacy`
  - 迁移前留档 `characters.pre-v3.bak`
  - 另有**幂等自愈**：补齐后续新增的派生字段（如 `levelName`），与版本无关
- 读损坏时先备份 `characters.corrupt-<ts>.json` 再返回空结构，不静默丢数据。
- 问卷作答记录存**完整结果**（`answers` 原始作答 + `scores` 计分明细 + `characterId` + `missing`），上限 500 条。

## 数据同步

server 端任何写操作都会递增 `revision`；UI 每 3s 轮询 `/revision`，
发现版本变化即整体刷新——保证 agent 在对话里用工具产生的更新（角色 / 详析 / 互动 / 问卷）
自动同步进 UI，无需手动刷新。

## 构建与注入

```bash
DSH_CHECKOUT=<checkout> bash scripts/build.sh
# 注入器环境内：dev_inject_plugin <本目录>
```

> 环境无 npm 时可直接调用 `tsc` 与 `node node_modules/tsdown/dist/run.mjs` 完成编译与客户端打包。

## 自检

改完代码先跑 `character_selftest`：它用合成作答覆盖 15 种计分器、九型/大五派生逻辑、
作答校验、JSON 提取、store 读写与 schema 迁移（全部在临时目录，不触碰真实数据）。
