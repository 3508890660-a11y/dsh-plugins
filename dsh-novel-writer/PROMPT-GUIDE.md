# 小说工坊 · 提示词模板与使用样例

> 配套工具链（核心）：`novel_project_create` / `novel_project_list` / `novel_outline_edit` / `novel_outline_list` / `novel_character_edit` / `novel_character_list` / `novel_worldview_edit` / `novel_worldview_list` / `novel_foreshadowing_edit` / `novel_chapter_write` / `novel_chapter_get` / `novel_chapter_continue` / `novel_chapter_polish` / `novel_memory_update` / `novel_export` / `novel_model_status` / `novel_import_settings`
>
> 已移植的分析 / 浏览 / 设定 / 检索工具链：`novel_books` / `novel_chapters` / `novel_read` / `novel_keywords` / `novel_sentence_analysis` / `novel_sentence_config` / `novel_style_check` / `novel_style_report` / `novel_plot` / `novel_settings` / `novel_summary` / `novel_outline` / `novel_continuity_check` / `novel_semantic_search` / `novel_import` / `novel_new_chapter`
>
> 用法：把下面模板复制进 DSH Desktop 会话，把【】里的内容换成你的设定即可。AI 会自行调度工具完成。

---

## 一、快速上手（三句话工作流）

1. **开书**：用「场景 1」模板一句话建好项目 + 世界观 + 人物 + 大纲。
2. **写章**：直接说「写第一章」；后续每章说「写下一章」，AI 会自动拼接前情记忆。
3. **导出**：说「导出 epub」即可拿到成品文件。

---

## 二、模板库（按场景）

### 场景 0 · 查看状态

```
我的小说项目现在什么状态？
```
→ AI 调 `novel_project_list` + `novel_outline_list` + `novel_character_list` 汇报。

```
现在写作用的是什么模型？切到本地 novel-lora 试试。
```
→ `novel_model_status` 查看路由；切模型在 DSH 会话模型选择器里操作。

### 场景 1 · 从零开新书（全流程，推荐）

```
帮我开一本新书：
书名：【书名】
题材：【科幻 / 奇幻 / 都市 / 日轻……】
文风：【轻快诙谐的日轻风 / 冷峻史诗风 / 克制的严肃文学风……】
核心设定（一句话）：【一句话梗概，如：废土上最后一座灰烬城，守夜人捡到会说话的剑】
要求：
1. 用 novel_project_create 创建项目；
2. 用 novel_worldview_edit 建立 4-6 条核心世界观（覆盖地理、历史、规则、力量体系，每条 2-3 句）；
3. 用 novel_character_edit 建立 2-3 位人物（主角 + 关键配角，含外貌/性格/背景/目标/成长弧光）；
4. 用 novel_outline_edit 建第一卷大纲：3-5 章，每章写清章节目标 summary 和 3-5 个情节拍 beats，并安排 1-2 个伏笔；
5. 最后用 novel_chapter_write 写第一章（约 4000 字）。
完成后汇报：项目 id、大纲结构、人物清单。
```

### 场景 2 · 写下一章（日常续写，推荐）

```
继续写【书名】的下一章（第【N】章《【标题】》）：
本章目标：【这一章要发生什么，如：柯铎在灰烬教大典上被指认为异端，烬语当众开口说话】
要求：本章约【4000】字，【冷峻史诗风】，结尾埋一个关于【烬语的来历】的伏笔。
请先用 novel_outline_edit 补上这一章的 summary 和 beats，再 novel_chapter_write 生成。
```

### 场景 3 · 续写 / 改写已有章节

```
把《【书名】》第【N】章《【标题】》在末尾续写【2000】字：
剧情：【续写内容，如：柯铎在城门口遇到神秘来客，对方知道他背负的誓言，制造悬念收尾】
```
→ AI 调 `novel_chapter_continue`（append 模式，保留原文）。

```
整章重写《【书名】》第【N】章《【标题】》：
改法：【如：改成双线叙事，交替柯铎与烬语的视角；增加与守夜人队长的冲突；压缩打斗段落】
```
→ `novel_chapter_continue`（rewrite 模式，整章替换）。

### 场景 4 · 中途改方向 / 插指令（交互式创作）

```
等一下，刚才这一章的方向不对。改成：
【新方向，如：主角不是自愿加入，而是被胁迫的，把第 N 章第 3 个情节拍改成背叛戏】
用 novel_chapter_continue 重写这一章，同时用 novel_foreshadowing_edit 登记一个新伏笔：【伏笔内容】。
```

### 场景 5 · 设定增补 / 修改

```
给《【书名】》补一条世界观：
类别：【地理/历史/规则/力量体系/文化/其他】
标题：【如：焚天录】
内容：【2-3 句描述】
```

```
新建人物：【姓名】，定位：【主角/配角/反派】，外貌：【…】，性格：【…】，背景：【…】，核心目标：【…】，成长弧光：【…→…→…】
```
→ `novel_character_edit`；改现有档案时直接说「把【姓名】的性格改为…，当前状态改为【…】」。

### 场景 6 · 手动修正记忆

```
检查《【书名】》第【N】章的自动记忆，有这些要改：
- 摘要应为：【一句话摘要】
- 柯铎的当前状态补上：【受伤的左臂 / 携带《焚天录》残页】
- 事件列表：加上【和守夜人队长决裂】，去掉【误入灰烬教地宫】
- 物品：新增【焚天录残页】
用 novel_memory_update 修正。
```

### 场景 7 · 导出

```
把《【书名】》导出为【epub / markdown / txt】，导出后告诉我文件路径和字数统计。
```
→ `novel_export`，产物在项目 exports 目录（如 `F:\producing\tool\writer\novel-writer-data\projects\<id>\exports\`）。

### 场景 8 · 设定文件批量导入（含超长文本）

```
把以下设定文件导入《【书名】》项目（先 dryRun 预览，确认无误再正式导入）：
F:\path\世界观.md
F:\path\人物设定\    （目录会递归读取）
编码：【utf-8 / gbk】
```
→ `novel_import_settings`，同标题/名字/描述的条目会自动跳过（幂等）。

**超长文本自动适配**：超过 2 万字符的设定文档不再截断，而是自动分块（每块约 1.5 万字符）多次调用大模型解析后合并——分块默认走云端大模型（deepseek-official，不让本地小模型硬啃长文），块间自动传递「已提取条目」清单防止重复，最终仍按同名幂等去重。报告会标注「分块 N 段·云端大模型」。可在插件配置中调整：`importLongThreshold`（分块阈值，默认 20000）/ `importChunkChars`（每块字符数，默认 15000）/ `importCloudProvider` / `importCloudModel`（云端模型，默认 deepseek-official / deepseek-v4-flash；该 provider 不可用时自动回退当前路由）。

### 场景 9 · 检查一致性（写作前体检）

```
写下一章之前，先检查：未解伏笔有哪些？上一章结尾停在什么状态？人物当前状态有没有与大纲冲突？
```
→ `novel_outline_list`（含未解伏笔）+ `novel_chapter_get` + `novel_character_list`。

---

## 三、完整样例（可直接模仿）

以下是一本新书《星海拾荒者》从零到第一章 + 导出的完整对话轨迹（用户话术 + AI 动作摘要）：

**用户①（开书）：**
> 帮我开一本新书：
> 书名：星海拾荒者
> 题材：科幻
> 文风：冷峻克制的太空歌剧，带一点诙谐
> 核心设定：太阳系衰败后，拾荒者驾驶旧船在星环残骸中打捞文物，船上的人工智能藏着一段被删除的历史。
> 要求：1. novel_project_create；2. 世界观 4 条（地理：星环坟场/历史：大坍缩/规则：拾荒者公约/力量体系：无超自然，以考古+工程学为核心）；3. 人物 2 位（主角+AI 拟态）；4. 大纲第一卷 3 章，每章 summary+4 beats，埋 1 个伏笔；5. novel_chapter_write 写第一章约 4000 字。

**AI：** 创建项目 `p-xxxx` → 写入 4 条世界观 → 建立 2 份人物档案 → 建 3 章大纲（伏笔：AI 的核心记忆区有一道从未开启的「第七道封锁」）→ 生成第一章《星环下的回声》约 4100 字，记忆自动提取（摘要 + 5 事件 + 人物状态 + 物品：一枚刻着旧历的铜币）。

**用户②（日常续写）：**
> 继续写《星海拾荒者》第二章《铜币上的坐标》：主角发现铜币背面刻的是已被抹去的大坍缩前旧坐标，AI 拒绝解读并要求销毁。结尾埋伏笔：深空传来一段重复了三百年的求救信号。约 4000 字，保持冷峻诙谐。

**AI：** 补大纲节点 → `novel_chapter_write` → 第二章完成，伏笔自动登记（求救信号）。

**用户③（中途改方向）：**
> 等一下，第三章先不写交易站戏。改成：主角在返回母港途中被拾荒者公约执法队拦检，AI 首次主动顶替主角应答，暴露「它能撒谎」。用 novel_chapter_continue 重写第三章，并登记伏笔：执法队对 AI 的存在表现出异常熟悉。

**AI：** `novel_chapter_continue`（rewrite）→ `novel_foreshadowing_edit` 登记 → 汇报新走向。

**用户④（体检 + 导出）：**
> 写第四章前先体检：未解伏笔有哪些？主角当前状态？然后导出 epub。

**AI：** `novel_outline_list`（未解伏笔：第七道封锁 / 求救信号 / 执法队疑点）→ `novel_character_list` → `novel_export`（epub）→ 报告导出路径与全书字数。

---

## 四、技巧与注意事项

1. **先大纲后写章**：`novel_chapter_write` 依赖大纲章节节点（summary + beats），没建节点 AI 会先帮你补建；主动说「先补 summary 和 beats」更可控。
2. **篇幅控制**：本地 `novel-lora`（1.5B）生成 4000 字约需 1-3 分钟，属正常；批量写长章请耐心等待或换 `deepseek-v4-flash`。
3. **伏笔要明说**：在指令里直接写「埋下伏笔：…」比让模型自由发挥更可靠（模型自由发挥时伏笔提取率低）。
4. **记忆会出偏差**：自动记忆不准时用场景 6 模板手动修正，修正会同步到人物状态，后续章节自动生效。
5. **设定膨胀影响上下文**：世界观/人物/前情越多，生成请求越大；`novel-lora` 上下文 32768 tokens（≈3.8 万汉字），接近极限时精简设定或切云端模型。
6. **导出格式**：md 适合继续编辑，txt 适合纯阅读，epub 适合推送到阅读器。
7. **模型状态**：写作路由跟随 DSH 主会话；`novel_model_status` 随时可查。
