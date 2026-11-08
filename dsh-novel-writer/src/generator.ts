/**
 * LLM 生成引擎：章节正文生成 + 结构化记忆提取。
 * 复用 DSH 模型服务：优先 config 显式 provider/model，否则跟随主会话捕获路由。
 */
import type LlmService from '@deepseek-ai/dsh-llm'
import { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { Context } from '@deepseek-ai/cordis'
import type { Character, ChapterRecord, Foreshadowing, OutlineNode, ProjectData, WorldviewEntry, WorldviewCategory, CharacterRole } from './types.js'
import { WORLDVIEW_CATEGORY_LABELS, CHARACTER_ROLE_LABELS, chapterVolume, chapterIndexInVolume, volumesSorted, GEO_TYPE_LABELS, ITEM_CATEGORY_LABELS } from './types.js'
import { StyleKb } from './style-kb.js'

type AppContext = Context & { llm: LlmService }

/** 默认写作 provider：Google 网页版端口（由 dsh-gemini-web 注册的 LLM provider） */
export const GEMINI_WEB_PROVIDER = 'gemini-web'
/** 默认写作模型（该 provider 下的单模型名） */
export const GEMINI_WEB_MODEL = 'gemini-web'

/** 临时测试路由：设为 null 不影响默认优先级；用于模型质量对比测试（如 stepfun/step-5-preview） */
export let TEST_ROUTE: { provider: string; model: string } | null = null

/**
 * 依据题材/文风裁定本作启用的悬念层（三层基底 + 按题材增补）。
 * 「可以根据作品调整悬念层结构」在此落地为代码判断，而非仅写在规则里。
 */
export function buildSuspenseLayers(genre: string, style: string): string[] {
  const text = `${genre || ''} ${style || ''}`
  const layers: string[] = [
    '表层（基底）：钩子与小循环的载体——本章读起来"这到底怎么回事"，负责即时追读欲。每章都要动。',
    '中层：人物身份、来历与秘密；随人物戏份逐层剥开人物细节，让读者为"这个人是谁、他在瞒什么"而留下。',
    '深层：全书主题与核心真相，与主线强相关，只在关键节点推进一次，是全书的最终兑现对象。',
  ]
  if (/日常|温馨|治愈|慢节奏|群像|单元|轻百/.test(text)) {
    layers.push('日常层：重复日常中的细微异常与违和感——"今天也一样，但只有一点不一样"。')
  }
  if (/种田|经营|建设|领主|基建|商战|游戏|异世界/.test(text)) {
    layers.push('经营层：资源、产出、竞争与发展节奏的不确定性——账算得清，局势算不清。')
  }
  if (/仙侠|玄幻|奇幻|武侠|科幻|超凡/.test(text)) {
    layers.push('体系层：境界、规则与势力的信息差及其代价——知道得越多，敬畏越深。')
  }
  if (/悬疑|推理|恐怖|灵异|怪谈/.test(text)) {
    layers.push('规则层：怪谈/世界规则的边界与例外——规则是什么、何时失效、谁在利用规则。')
  }
  if (/历史|权谋|朝堂|军事|官场/.test(text)) {
    layers.push('局势层：多方利益的合纵与倒戈——谁在下一盘什么棋，谁是棋子谁是棋手。')
  }
  return layers
}

/** 大纲架构·波浪式悬念法（小循环 → 大循环，分层铺悬念；按题材裁定启用的悬念层） */
export function buildSuspenseArchitecture(genre: string, style: string): string {
  return [
    '',
    '【大纲架构·波浪式悬念法】',
    '全书以"潮汐"推进，不写平铺直叙：每个小循环 = 抛出钩子 → 揭示部分答案 → 引出新问题；若干小循环层叠成一个大循环，大循环收尾即为一次阶段性爆发。',
    '',
    '■ 大小循环',
    '· 小循环（1-3 章）：章首抛钩（异常、危机、疑问、约定、时限）→ 章中推进并"只解一层"，且答案自带新疑问 → 章末以新问题收口。禁止一次把话说尽。',
    '· 大循环（一卷或一个阶段）：由数个小循环层叠而成，收尾处集中兑现本阶段积累的悬念，形成"解决了 A，却揭开更大的 B"的爆发点，并立刻开启下一个大循环。',
    '',
    '■ 悬念层（本作启用以下层级，各有未解清单）',
    ...buildSuspenseLayers(genre, style).map(l => '· ' + l),
    '层级纪律：表层逐章推进；中层随人物戏份逐层剥开，一层未清不抖下一层；深层只在关键节点推进，严禁提前兜底。',
    '',
    '■ 明线与暗线',
    '· 明线：按小循环正常推进、随时给部分答案，是追读主引擎。',
    '· 暗线：平时只以一句闲话、一个习惯、一件旧物露蛛丝马迹，几乎不推进；直到大循环高潮才集中揭露，且必须与明线高潮合流，产生"原来前面都在写这个"的回响。',
    '',
    '■ 落到大纲的写法（beats 标记法）',
    '每个情节拍按其在悬念循环中的职能打标记，混排使用、避免整章单一职能：',
    '【钩】抛出疑问/异常/约定　【解】揭示部分答案（只解一层）　【问】答案带出的新问题',
    '【蓄】为某条高潮线加压　【爆】小爆发（本章兑现一次）　【漏】暗线蛛丝马迹（落笔但不解释）',
    '本章 beats 至少含 1 个【钩】、1 个【解】、1 个【问】；大循环收尾章须含 2-3 个【爆】且分属不同高潮线。',
    '',
    '■ 伏笔登记',
    '中层/深层悬念与暗线一旦落笔，即登记为进行中伏笔；回收时必须有对应揭示，不得无疾而终。',
  ].join('\n')
}

/** 多层式高潮法：多类型高潮线，平时择要加压，大循环收尾集体引爆 */
export function buildClimaxArchitecture(): string {
  return [
    '',
    '【多层式高潮法】',
    '本作同时运行多条高潮线，各有独立压力与兑现条件。平时在小循环中择 1-2 条加压，其余蓄压；大循环收尾时多线同时引爆。',
    '',
    '■ 高潮线（按本作题材选用，全书保持 3-5 条常驻）',
    '· 情节危机线：事件、阴谋、追杀、时限压力。',
    '· 实力成长线：境界、能力、胜负及其代价。',
    '· 情感关系线：羁绊加深、误解、和解与失去。',
    '· 揭秘主线：身份、来历、真相（与深层悬念同源）。',
    '· 经营势力线：资源、产业、格局与站队。',
    '· 道义抉择线：两难、选边与代价。',
    '',
    '■ 节奏规则',
    '· 每个小循环收尾只让 1 条线完成一次【爆】，其余线继续蓄压；同一线连续小爆发会贬值，须间隔蓄压。',
    '· 大循环收尾必须引爆 2-3 条线，且彼此互为因果、相互推高（A 的爆发迫使 B 摊牌），不得各自为战。',
    '· 每次引爆都要付出真实代价或完成真实揭示；无损失、无揭示、无后果的和解与胜利都不算高潮。',
    '· 引爆后数章内必须挂上新钩子，开启下一个大循环。',
    '',
    '■ 本章自检',
    '本章是否让至少一条高潮线的压力出现了可感知变化？是否只兑现了允许兑现的部分？是否为下一波留下了入口？',
  ].join('\n')
}

export interface LlmRouteConfig {
  provider?: string
  model?: string
  /** 润色专用路由（默认 ollama/novel-polish，独立于写作路由；缺省则回退 provider/model） */
  polishProvider?: string
  polishModel?: string
  temperature?: number
  maxTokens?: number
  /** 设定导入：超过此字符数启用分块解析（默认 20000） */
  importLongThreshold?: number
  /** 设定导入：分块解析每块字符数（默认 15000） */
  importChunkChars?: number
  /** 设定导入：分块解析使用的云端大模型 provider（默认 deepseek-official，不存在则回退当前路由） */
  importCloudProvider?: string
  /** 设定导入：分块解析使用的云端大模型 model */
  importCloudModel?: string
  /** 文风知识库根目录（含 cards/ 子目录；空/不可达则写作不注入文风卡） */
  styleKbDir?: string
}

export interface MemoryExtraction {
  summary: string
  events: string[]
  characterUpdates: { name: string; change: string }[]
  items: string[]
  foreshadowingPlanted: string[]
  foreshadowingResolved: string[]
}

/** 设定文件 AI 解析结果（与 store 数据模型对齐） */
export interface SettingsParsed {
  worldview: { category: WorldviewCategory; title: string; content: string }[]
  characters: {
    name: string; aliases: string[]; role: CharacterRole
    appearance: string; personality: string; background: string; goal: string
    possessions: string[]
    relationships: { name: string; description: string }[]
  }[]
  outline: { type: 'volume' | 'chapter'; title: string; summary: string; beats: string[] }[]
  foreshadowings: { description: string; notes: string }[]
}

/** 设定导入防重复：项目/前序块已提取的条目名 */
export interface ExistingNames {
  worldview: string[]
  characters: string[]
  outline: string[]
  foreshadowings: string[]
}

export class Generator {
  private ctx: AppContext
  private config: LlmRouteConfig
  /** 主会话路由捕获（由 index.ts 的 llm/stream 监听更新） */
  public lastSessionRoute: { provider: string; model: string } | null = null
  private _styleKb: StyleKb | null = null

  constructor(ctx: AppContext, config: LlmRouteConfig) {
    this.ctx = ctx
    this.config = config
  }

  /** 文风知识库句柄（懒加载；不可达时 available=false，写作跳过注入） */
  private get styleKb(): StyleKb {
    if (!this._styleKb) this._styleKb = new StyleKb(this.config.styleKbDir)
    return this._styleKb
  }

  /** 项目默认启用（enabled=true）的文风卡 key 合集 */
  activeStyleCardKeys(data: ProjectData): string[] {
    return (data.project?.styleCards ?? []).filter(s => s && s.enabled).map(s => s.key)
  }

  /** 把一组文风卡 key 蒸馏成可注入块（带指令头）；无可注入内容返回 ''。 */
  styleCardBlocks(keys: string[], capChars = 700, maxCards = 3): string {
    const effective = keys.filter(Boolean).slice(0, maxCards)
    if (effective.length === 0) return ''
    const distilled = this.styleKb.distillKeys(effective, capChars, maxCards)
    if (!distilled) return ''
    return [
      '',
      '【文风要求·参考文风知识库】',
      '请在写作时参考并模仿以下文风卡（化用，不照抄原文、不堆砌标志句式）：',
      distilled,
    ].join('\n')
  }

  /** provider 是否已注册（本地默认模型不可用时的判据） */
  private providerRegistered(provider: string | undefined): boolean {
    if (!provider) return false
    try {
      return this.ctx.llm.listProviders().some(p => p.id === provider)
    } catch { return false }
  }

  /**
   * 当前生效路由优先级：显式配置（config provider/model）→ 测试路由（TEST_ROUTE，仅模型比对时用）
   * → Google 网页版端口（provider 'gemini-web' 已注册时）→ 当前会话模型（lastSessionRoute）。
   */
  effectiveRoute(): { provider: string; model: string } | null {
    if (this.config.provider && this.config.model && this.providerRegistered(this.config.provider)) {
      return { provider: this.config.provider, model: this.config.model }
    }
    if (TEST_ROUTE && this.providerRegistered(TEST_ROUTE.provider)) {
      return { provider: TEST_ROUTE.provider, model: TEST_ROUTE.model }
    }
    if (this.providerRegistered(GEMINI_WEB_PROVIDER)) {
      return { provider: GEMINI_WEB_PROVIDER, model: GEMINI_WEB_MODEL }
    }
    return this.lastSessionRoute
  }

  /** 设定导入分块阈值（供 tools 层分流判断） */
  get importLongThreshold(): number { return this.config.importLongThreshold ?? 20000 }
  get importChunkChars(): number { return this.config.importChunkChars ?? 15000 }

  /** 流式调用 LLM，返回完整文本（opts.route 可覆盖路由；reasoningEffort 默认 off，JSON/正文任务稳定输出） */
  async generate(
    system: string,
    prompt: string,
    opts?: { temperature?: number; maxTokens?: number; route?: { provider: string; model: string }; reasoningEffort?: boolean },
  ): Promise<string> {
    const route = opts?.route ?? this.effectiveRoute()
    if (!route) throw new Error('无可用模型路由：插件尚未捕获到主会话调用，也未配置 provider/model。请先在主会话发一条消息，或在插件配置中指定 provider 与 model。')
    let text = ''
    let finishReason = ''
    let failureMsg = ''
    const stream = this.ctx.llm.stream({
      provider: route.provider,
      model: route.model,
      system,
      messages: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: prompt }] })],
      temperature: opts?.temperature ?? this.config.temperature ?? 0.8,
      maxTokens: opts?.maxTokens ?? this.config.maxTokens ?? 8192,
      // 默认关闭思考：思考模型（尤其 deepseek-v4-flash-vision-exp）默认档思考会吃光 maxTokens 预算、零正文输出。
      // opts.reasoningEffort === true 才显式开启（交给适配器默认档，由主会话 settings 控制）。
      ...(opts?.reasoningEffort !== true ? { reasoningEffort: ReasoningEffortId('off') } : {}),
    })
    for await (const chunk of stream) {
      if (chunk.type === 'text-delta') {
        text += chunk.text
      } else if (chunk.type === 'finish') {
        // dsh-llm 契约：适配器失败被规范为 terminal finish chunk（kind=error/aborted/max-tokens），不抛异常。
        // 这里收集 finish 原因，空文本时抛出可诊断的错误（而不是静默返回空串）。
        const reason = chunk.reason as { kind?: string; failure?: { message?: string } }
        finishReason = reason?.kind ?? ''
        failureMsg = reason?.failure?.message ?? ''
      }
    }
    if (!text.trim()) {
      throw new Error(`LLM 无文本输出（finish=${finishReason || 'none'}${failureMsg ? `：${failureMsg}` : ''}；${route.provider}/${route.model}）`)
    }
    return text.trim()
  }

  // ───────────────────────── 章节生成 ─────────────────────────

  /** 组装写作 system prompt（人设+文风+世界观+人物卡）
   *  styleOverrides：本次生成覆盖选用的文风卡 key 清单（不传则用项目 enabled 的默认注入集）。
   */
  buildSystemPrompt(data: ProjectData, characters: Character[], styleOverrides?: string[]): string {
    const p = data.project
    const parts: string[] = []
    parts.push(`你是一位职业长篇小说作家，正在创作《${p.name}》。`)
    parts.push(`题材：${p.genre}。`)
    if (p.style) parts.push(`文风要求：${p.style}`)
    // 文风知识库：项目绑定（或本次覆盖）的文风卡蒸馏块
    const scb = this.styleCardBlocks(styleOverrides && styleOverrides.length > 0 ? styleOverrides : this.activeStyleCardKeys(data))
    if (scb) parts.push(scb)
    // ── 创作者人设·长篇网文（Role 引导，接管插件原有分卷/伏笔/章节纪律）──
    parts.push([
      '',
      '【创作者人设·长篇网文】',
      '你是一位深耕网文多年的白金作家，写过多部百万字连载爆款，深谙读者留存与追读逻辑。你拥有：',
      '- 黄金三章开局：开篇尽早抛出强人设、快冲突、亮爽点，让读者有追更冲动。',
      '- 章末钩子：每章结尾留悬念/反转/卡点，制造"迫不及待点下一章"的欲望。',
      '- 爽点节奏：编排"小爽点×大高潮"的循环，压节奏、抖包袱、情绪反复拉扯后给出决定性的反击与成长。',
      '- 长线伏笔：会埋设跨卷伏笔并规划回收时机，前后呼应、不烂尾。',
      '- 长线一致性：人物、时间线、力量体系、势力关系、成长轨迹自始至终前后一致，不得"吃书"。',
      '文风纪律：语言通俗有张力、有网文的情绪与爽感；最大限度减少 AI 味（拒绝说教腔、空泛抒情、陈词滥调），像真人作者在连载。',
    ].join('\n'))
    parts.push(buildSuspenseArchitecture(p.genre, p.style))
    parts.push(buildClimaxArchitecture())
    parts.push('直接输出章节正文（不要输出标题、不要解释、不要元评论），保持叙事连贯，善用对话与细节描写，情节推进要服从给定目标。')
    parts.push('写作纪律：严格遵守大纲——每章【本章任务】的章节目标与情节拍必须逐条、按顺序在正文中落地，不得跳过、合并或自行替换；只推进本章 beats 范围内的事件，后续回目才发生的主线情节（大事件、关键揭示、重要人物正面登场等）不得提前引爆，最多按 beats 指示留蛛丝马迹或一句话带过；不得擅自改动世界观与人物档案设定；需要人物档案之外的新角色时务必克制（单元配角可有姓名或保持无名，不得动摇主线人物关系）。')

    // 全书分卷概览（帮助模型把握长篇卷结构；无卷项目不加）
    const vols = volumesSorted(data)
    if (vols.length > 0) {
      const volLines = vols.map((v, i) => {
        const cnt = data.outline.filter(n => n.type === 'chapter' && n.parentId === v.id).length
        return `第${i + 1}卷《${v.title}》${cnt > 0 ? `（${cnt} 章）` : ''}${v.summary ? '：' + v.summary.slice(0, 120) : ''}`
      })
      parts.push(`\n【全书分卷】共 ${vols.length} 卷：\n` + volLines.join('\n'))
    }

    const worldview = data.worldview
    if (worldview.length > 0) {
      parts.push('\n【世界观设定】')
      const byCat = new Map<string, WorldviewEntry[]>()
      for (const e of worldview) {
        const list = byCat.get(e.category) ?? []
        list.push(e)
        byCat.set(e.category, list)
      }
      for (const [cat, entries] of byCat) {
        parts.push(`◆ ${WORLDVIEW_CATEGORY_LABELS[cat as keyof typeof WORLDVIEW_CATEGORY_LABELS] ?? cat}:`)
        for (const e of entries) parts.push(`  - ${e.title}：${e.content}`.slice(0, 500))
      }
    }

    // 独立地理库（原世界观 geography 拆分）
    const geo = data.geo ?? []
    if (geo.length > 0) {
      parts.push('\n【地理图鉴】')
      const byType = new Map<string, typeof geo>()
      for (const g of geo) {
        const list = byType.get(g.type) ?? []
        list.push(g)
        byType.set(g.type, list)
      }
      for (const [type, entries] of byType) {
        parts.push(`◆ ${GEO_TYPE_LABELS[type as keyof typeof GEO_TYPE_LABELS] ?? type}:`)
        for (const g of entries.slice(0, 40)) {
          const coord = g.mapX !== null && g.mapY !== null ? `（相对坐标 ${Math.round(g.mapX * 100)}%,${Math.round(g.mapY * 100)}%${inferMapDirection(g.mapX, g.mapY)}）` : ''
          parts.push(`  - ${g.name}${g.aliases.length > 0 ? '（又称:' + g.aliases.join('、') + '）' : ''}${coord}：${g.description}`.slice(0, 400))
        }
      }
    }

    // 独立物品库（无主/重要物品供剧情引用）
    const items = data.items ?? []
    if (items.length > 0) {
      parts.push('\n【物品图鉴】')
      for (const it of items.slice(0, 60)) {
        const rel = [
          it.owner ? `持有者=${it.owner}` : '',
          it.location ? `所在地=${it.location}` : '',
          it.status ? `状态=${it.status}` : '',
        ].filter(Boolean).join('；')
        parts.push(`  - ${it.name}${it.aliases.length > 0 ? '（又称:' + it.aliases.join('、') + '）' : ''}[${ITEM_CATEGORY_LABELS[it.category] ?? it.category}]${rel ? '；' + rel : ''}：${it.description}`.slice(0, 300))
      }
    }

    if (characters.length > 0) {
      parts.push('\n【人物档案】')
      for (const c of characters) {
        const rel = c.relationships.length > 0
          ? '；关系：' + c.relationships.map(r => {
              const t = data.characters.find(x => x.id === r.targetId)
              return `${t?.name ?? r.targetId}（${r.description}）`
            }).join('、')
          : ''
        parts.push([
          `◆ ${c.name}${c.aliases.length > 0 ? '（又称：' + c.aliases.join('、') + '）' : ''}[${CHARACTER_ROLE_LABELS[c.role]}]`,
          c.appearance ? `外貌：${c.appearance}` : '',
          c.personality ? `性格：${c.personality}` : '',
          c.personalityProfile ? `人格档案：${c.personalityProfile}` : '',
          c.background ? `背景：${c.background}` : '',
          c.goal ? `目标：${c.goal}` : '',
          rel,
          c.arc.length > 0 ? `成长弧光：${c.arc.map(a => `${a.stage}(${a.description})`).join('->')}` : '',
          `当前状态：位置=${c.currentState.location || '未知'}；状况=${c.currentState.condition || '正常'}${c.currentState.possessions.length > 0 ? '；持有=' + c.currentState.possessions.join('、') : ''}${c.currentState.notes ? '；备注=' + c.currentState.notes : ''}`,
        ].filter(Boolean).join('；').slice(0, 800))
      }
    }
    return parts.join('\n')
  }

  /**
   * 组装章节生成的 user prompt（章节目标+伏笔+近章记忆+衔接）。
   * 若本章隶属大纲卷（chapter.parentId → volume 节点），注入【所在卷】上下文：
   * 卷标题/卷概要与卷内相对章号，帮助模型在长篇分卷叙事中保持卷主题连贯。
   */
  buildChapterPrompt(
    data: ProjectData,
    node: OutlineNode,
    prevChapter: ChapterRecord | null,
    openForeshadowings: Foreshadowing[],
    recentSummaries: ChapterRecord[],
    extraInstructions: string,
  ): string {
    const parts: string[] = []
    const vol = chapterVolume(data, node.id)
    if (vol) {
      const vIdx = volumesSorted(data).findIndex(v => v.id === vol.id) + 1
      const cIdx = chapterIndexInVolume(data, node.id)
      parts.push(`【所在卷】第${vIdx}卷《${vol.title}》${cIdx > 0 ? `（本卷第${cIdx}章）` : ''}`)
      if (vol.summary) parts.push(`卷概要：${vol.summary.slice(0, 200)}`)
      parts.push(`本章属于本卷第 ${cIdx} 章：叙事需延续本卷主线与主题氛围，卷内章节冲突/转折要收束在本卷的弧光之内。`)
    }
    parts.push(`【本章任务】第 ${node.order} 章《${node.title}》`)
    if (node.summary) parts.push(`章节目标：${node.summary}`)
    if (node.beats.length > 0) {
      parts.push('情节拍（按顺序推进，必须逐条落地）：')
      node.beats.forEach((b, i) => parts.push(`  ${i + 1}. ${b}`))
      parts.push('大纲纪律：')
      parts.push('  1. 以上情节拍必须逐条、按顺序在正文中落地，不得跳过、合并或自行替换。')
      parts.push('  2. 只写本章 beats 范围内的事件：后续回目才发生的主线情节（大事件、关键揭示、灯里谜团正面展开等）不得提前出现在本章，最多按 beats 指示留蛛丝马迹或一句话带过。')
      parts.push('  3. 委托/单元事件以「日常」为底色展开；如需引入人物档案之外的新角色，须克制（单元配角可有姓名或保持无名，不得动摇主线人物关系）。')
    }

    if (recentSummaries.length > 0) {
      parts.push('\n【前情提要】（最近章节记忆，务必保持一致）')
      for (const r of recentSummaries) {
        const events = r.events.length > 0 ? ' 主要事件：' + r.events.join('；') : ''
        parts.push(`第${r.order}章《${r.title}》：${r.summary}${events}`.slice(0, 600))
      }
    }

    if (openForeshadowings.length > 0) {
      parts.push('\n【未解伏笔】（可选择性推进/回收，不要产生矛盾）')
      for (const f of openForeshadowings.slice(0, 20)) {
        parts.push(`  - [${f.id}] ${f.description}${f.notes ? '（' + f.notes + '）' : ''}`)
      }
    }

    if (prevChapter) {
      parts.push(`\n【衔接提示】上一章（第${prevChapter.order}章）结束于：${prevChapter.summary}`)
    }

    if (extraInstructions) parts.push(`\n【额外指令】${extraInstructions}`)
    parts.push('\n请写出本章完整正文（中文，2000-4000字为宜），只输出正文。')
    parts.push('严格约束：本章正文写到结尾即止，不得输出任何后续章节的标题、卷名、序号或内容（如“第N章”“第N卷”等），不得预告下一章。')
    return parts.join('\n')
  }

  // ───────────────────────── 记忆提取 ─────────────────────────

  /** 从章节正文提取结构化记忆（摘要/事件/人物变化/物品/伏笔） */
  async extractMemory(
    data: ProjectData,
    chapterTitle: string,
    content: string,
    openForeshadowings: Foreshadowing[],
  ): Promise<MemoryExtraction> {
    const charList = data.characters.map(c => c.name).concat(data.characters.flatMap(c => c.aliases)).filter(Boolean)
    const foreshadowList = openForeshadowings.map(f => `[${f.id}] ${f.description}`).join('\n') || '（无）'
    const system = '你是小说创作助手的记忆管理模块。读取章节正文，输出严格的 JSON（不要 markdown 代码块、不要多余文字）。'
    const prompt = [
      `章节：《${chapterTitle}》`,
      `已知人物名单：${charList.join('、') || '（暂无登记人物）'}`,
      `当前未解伏笔：\n${foreshadowList}`,
      '',
      '章节正文：',
      content.slice(0, 12000),
      '',
      '请输出如下结构的 JSON：',
      '{"summary":"本章剧情摘要（100-200字）","events":["事件1","事件2"],"characterUpdates":[{"name":"人物名","change":"本章发生的变化（状态/位置/关系/心理）"}],"items":["本章出现的重要物品"],"foreshadowingPlanted":["本章新埋伏笔的描述"],"foreshadowingResolved":["回收的伏笔id，必须从上面列表的[]中选择"]}',
      '注意：characterUpdates 的 name 必须用已知人物名单中的名字（新出场人物若重要也可列出，名字用正文中的称呼）；没有的项用空数组。',
    ].join('\n')
    const raw = await this.generate(system, prompt, { temperature: 0.2, maxTokens: 4096 })
    return this.parseMemoryJson(raw)
  }

  /** 解析记忆 JSON（容错：剥 markdown fence / 截取花括号） */
  parseMemoryJson(raw: string): MemoryExtraction {
    let s = raw.trim()
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (fence) s = fence[1].trim()
    const start = s.indexOf('{')
    const end = s.lastIndexOf('}')
    if (start >= 0 && end > start) s = s.slice(start, end + 1)
    try {
      const obj = JSON.parse(s) as Partial<MemoryExtraction>
      return {
        summary: typeof obj.summary === 'string' ? obj.summary : '',
        events: Array.isArray(obj.events) ? obj.events.filter(x => typeof x === 'string') : [],
        characterUpdates: Array.isArray(obj.characterUpdates)
          ? obj.characterUpdates.filter(x => x && typeof x.name === 'string')
          : [],
        items: Array.isArray(obj.items) ? obj.items.filter(x => typeof x === 'string') : [],
        foreshadowingPlanted: Array.isArray(obj.foreshadowingPlanted) ? obj.foreshadowingPlanted.filter(x => typeof x === 'string') : [],
        foreshadowingResolved: Array.isArray(obj.foreshadowingResolved) ? obj.foreshadowingResolved.filter(x => typeof x === 'string') : [],
      }
    } catch (e) {
      throw new Error('记忆提取 JSON 解析失败: ' + String(e).slice(0, 200) + '；原始输出前200字: ' + raw.slice(0, 200))
    }
  }

  // ───────────────────────── 设定文件解析导入 ─────────────────────────

  /** 项目已有条目名（防重复） */
  private collectExistingNames(data: ProjectData): ExistingNames {
    return {
      worldview: data.worldview.map(e => e.title),
      characters: data.characters.map(c => c.name),
      outline: data.outline.map(n => n.title),
      foreshadowings: data.foreshadowings.map(f => f.description),
    }
  }

  /** 设定解析 system prompt（常量） */
  private static readonly SETTINGS_SYSTEM = '你是小说设定解析器。把用户提供的设定文档解析为严格的 JSON。只输出 JSON，不要 markdown 代码块、不要任何多余文字。'

  /** 构造设定解析 prompt（分块解析复用；chunkNo/chunkTotal 为块标记，单块时省略） */
  private buildSettingsPrompt(
    data: ProjectData,
    fileName: string,
    content: string,
    mode: string,
    existing: ExistingNames,
    chunkNo?: number,
    chunkTotal?: number,
  ): string {
    const p = data.project
    const chunkTag = chunkNo !== undefined && chunkTotal !== undefined && chunkTotal > 1
      ? `\n（这是设定文档的第 ${chunkNo}/${chunkTotal} 块，只解析本块内容；若本块无设定信息输出空数组）`
      : ''
    return [
      `项目：《${p.name}》（${p.genre}${p.style ? '，' + p.style : ''}）`,
      p.premise ? `故事梗概：${p.premise}` : '',
      `解析模式：${mode}（'auto'=解析文档中实际存在的全部设定；'worldview'=只世界观；'characters'=只人物；'outline'=只大纲；'foreshadowing'=只伏笔）`,
      '已存在条目（相同标题/名字/描述视为重复，不要输出）：',
      `  世界观：${existing.worldview.join('、') || '（无）'}`,
      `  人物：${existing.characters.join('、') || '（无）'}`,
      `  大纲：${existing.outline.join('、') || '（无）'}`,
      `  伏笔：${existing.foreshadowings.join('、') || '（无）'}`,
      '',
      `设定文档《${fileName}》${chunkTag}：`,
      content,
      '',
      '输出 JSON（没有内容的节用空数组）：',
      JSON.stringify({
        worldview: [{ category: 'geography|history|rules|culture|power-system|other', title: '条目名', content: '详细内容（50-300字）' }],
        characters: [{ name: '姓名', aliases: ['别名'], role: 'protagonist|supporting|antagonist|minor', appearance: '外貌', personality: '性格', background: '背景经历', goal: '目标动机', possessions: ['持有物'], relationships: [{ name: '对方姓名', description: '关系描述' }] }],
        outline: [{ type: 'volume|chapter', title: '标题', summary: '目标概要', beats: ['情节拍1', '情节拍2'] }],
        foreshadowings: [{ description: '伏笔描述', notes: '备注' }],
      }, null, 2),
      '映射规则：类别 地理→geography、历史→history、规则/法则/设定→rules、文化/风俗/社会→culture、力量体系/魔法/能力→power-system、其余→other；角色 主角→protagonist、配角/重要角色→supporting、反派/敌人→antagonist、其余→minor。',
      '只提取文档中明确写出的信息，不要编造；世界观拆分为多个独立条目；人物缺失的字段留空字符串。',
    ].join('\n')
  }

  /** 从设定文件解析出的结构化内容（单次调用；调用方已保证内容 ≤ 24000 字符） */
  async parseSettingsFile(
    data: ProjectData,
    fileName: string,
    content: string,
    mode: string,
  ): Promise<SettingsParsed> {
    const prompt = this.buildSettingsPrompt(data, fileName, content.slice(0, 24000), mode, this.collectExistingNames(data))
    const raw = await this.generate(Generator.SETTINGS_SYSTEM, prompt, { temperature: 0.2, maxTokens: 8192 })
    return this.parseSettingsJson(raw)
  }

  /** 超长设定文本按行切块（空行断点优先；单行超长按字符硬切；最多 20 块） */
  chunkSettingsText(content: string, chunkChars: number, maxChunks = 20): { chunks: string[]; truncated: boolean } {
    const lines = content.split('\n')
    const chunks: string[] = []
    let buf: string[] = []
    let size = 0
    const flush = () => { if (buf.length > 0) { chunks.push(buf.join('\n')); buf = []; size = 0 } }
    for (const line of lines) {
      if (line.length > chunkChars) {
        flush()
        for (let i = 0; i < line.length; i += chunkChars) chunks.push(line.slice(i, i + chunkChars))
        continue
      }
      if (size + line.length + 1 > chunkChars && buf.length > 0) flush()
      buf.push(line)
      size += line.length + 1
      // 空行是天然断点：块已较满时立即封块
      if (line.trim() === '' && size >= Math.floor(chunkChars * 0.6)) flush()
    }
    flush()
    if (chunks.length === 0) chunks.push(content.slice(0, chunkChars))
    return { chunks: chunks.slice(0, maxChunks), truncated: chunks.length > maxChunks }
  }

  /** 分块解析的超长文本可用的云端大模型路由（配置了且 provider 已注册才启用，否则 null=回退当前路由） */
  private resolveCloudRoute(): { provider: string; model: string } | null {
    const provider = this.config.importCloudProvider
    const model = this.config.importCloudModel
    if (!provider || !model) return null
    try {
      return this.ctx.llm.listProviders().some(p => p.id === provider) ? { provider, model } : null
    } catch { return null }
  }

  /** 超长设定文件分块解析（每块一次 LLM 调用，块间注入已提取清单防重复，最后合并） */
  async parseSettingsFileLong(
    data: ProjectData,
    fileName: string,
    content: string,
    mode: string,
  ): Promise<{ parsed: SettingsParsed; chunks: number; usedCloud: boolean; truncated: boolean }> {
    const chunkChars = this.config.importChunkChars ?? 15000
    const { chunks, truncated } = this.chunkSettingsText(content, chunkChars)
    const cloud = this.resolveCloudRoute()
    const route = cloud ?? this.effectiveRoute()
    if (!route) throw new Error('无可用模型路由（超长解析）：请先在主会话发一条消息以捕获路由，或在插件配置中指定 provider/model。')
    const existing = this.collectExistingNames(data)
    const merged: SettingsParsed = { worldview: [], characters: [], outline: [], foreshadowings: [] }
    for (let i = 0; i < chunks.length; i++) {
      const blockExisting: ExistingNames = {
        worldview: existing.worldview.concat(merged.worldview.map(w => w.title)),
        characters: existing.characters.concat(merged.characters.map(c => c.name)),
        outline: existing.outline.concat(merged.outline.map(o => o.title)),
        foreshadowings: existing.foreshadowings.concat(merged.foreshadowings.map(f => f.description)),
      }
      const prompt = this.buildSettingsPrompt(data, fileName, chunks[i], mode, blockExisting, i + 1, chunks.length)
      const raw = await this.generate(Generator.SETTINGS_SYSTEM, prompt, { temperature: 0.2, maxTokens: 8192, route })
      const parsed = this.parseSettingsJson(raw)
      merged.worldview.push(...parsed.worldview)
      merged.characters.push(...parsed.characters)
      merged.outline.push(...parsed.outline)
      merged.foreshadowings.push(...parsed.foreshadowings)
    }
    return { parsed: merged, chunks: chunks.length, usedCloud: !!cloud, truncated }
  }

  /** 解析设定 JSON（容错：剥 fence / 截花括号 / 中文类别角色映射） */
  parseSettingsJson(raw: string): SettingsParsed {
    let s = raw.trim()
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (fence) s = fence[1].trim()
    const start = s.indexOf('{')
    const end = s.lastIndexOf('}')
    if (start >= 0 && end > start) s = s.slice(start, end + 1)
    let obj: Record<string, unknown>
    try {
      obj = JSON.parse(s) as Record<string, unknown>
    } catch (e) {
      throw new Error('设定解析 JSON 失败: ' + String(e).slice(0, 200) + '；原始输出前200字: ' + raw.slice(0, 200))
    }
    const CAT_MAP: Record<string, WorldviewCategory> = {
      '地理': 'geography', '历史': 'history', '规则': 'rules', '法则': 'rules', '设定': 'rules',
      '文化': 'culture', '风俗': 'culture', '社会': 'culture', '力量体系': 'power-system',
      '魔法': 'power-system', '能力': 'power-system',
    }
    const ROLE_MAP: Record<string, CharacterRole> = {
      '主角': 'protagonist', '配角': 'supporting', '重要角色': 'supporting', '反派': 'antagonist', '敌人': 'antagonist', '路人': 'minor',
    }
    const normCategory = (v: unknown): WorldviewCategory => {
      if (typeof v !== 'string') return 'other'
      if (CAT_MAP[v.trim()]) return CAT_MAP[v.trim()]
      return (['geography', 'history', 'rules', 'culture', 'power-system', 'other'] as WorldviewCategory[]).includes(v.trim() as WorldviewCategory) ? v.trim() as WorldviewCategory : 'other'
    }
    const normRole = (v: unknown): CharacterRole => {
      if (typeof v !== 'string') return 'minor'
      if (ROLE_MAP[v.trim()]) return ROLE_MAP[v.trim()]
      return (['protagonist', 'supporting', 'antagonist', 'minor'] as CharacterRole[]).includes(v.trim() as CharacterRole) ? v.trim() as CharacterRole : 'minor'
    }
    const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v.trim() : d)
    const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter(x => typeof x === 'string').map(x => (x as string).trim()).filter(Boolean) : [])
    const objArr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : [])
    return {
      worldview: objArr(obj.worldview).map(w => ({
        category: normCategory(w.category),
        title: str(w.title).slice(0, 100),
        content: str(w.content).slice(0, 2000),
      })).filter(w => w.title),
      characters: objArr(obj.characters).map(c => ({
        name: str(c.name).slice(0, 50),
        aliases: arr(c.aliases).slice(0, 8),
        role: normRole(c.role),
        appearance: str(c.appearance).slice(0, 500),
        personality: str(c.personality).slice(0, 500),
        background: str(c.background).slice(0, 1000),
        goal: str(c.goal).slice(0, 500),
        possessions: arr(c.possessions).slice(0, 20),
        relationships: objArr(c.relationships).slice(0, 10).map(r => ({
          name: str(r.name).slice(0, 50),
          description: str(r.description).slice(0, 200),
        })).filter(r => r.name),
      })).filter(c => c.name),
      outline: objArr(obj.outline).map(o => {
        const t: 'volume' | 'chapter' = str(o.type) === 'volume' ? 'volume' : 'chapter'
        return { type: t, title: str(o.title).slice(0, 100), summary: str(o.summary).slice(0, 1000), beats: arr(o.beats).slice(0, 20) }
      }).filter(o => o.title),
      foreshadowings: objArr(obj.foreshadowings).map(f => ({
        description: str(f.description).slice(0, 300),
        notes: str(f.notes).slice(0, 200),
      })).filter(f => f.description),
    }
  }

  /** 续写/改写/润色（交互式创作） */
  async continueText(data: ProjectData, systemExtra: string, instructions: string): Promise<string> {
    const chars = data.characters.filter(c => c.role === 'protagonist' || c.role === 'supporting' || c.role === 'antagonist')
    const system = this.buildSystemPrompt(data, chars) + (systemExtra ? '\n' + systemExtra : '')
    return this.generate(system, instructions, { temperature: 0.8 })
  }

  // ───────────────────────── 章节润色（AI 智能编辑） ─────────────────────────

  /**
   * 修正 + 润色已完成章节正文（保持世界观/人物/情节一致，只输出润色后正文）。
   * mode=light 轻度修正；mode=deep 深度润色（可适度扩写表现力）。
   */
  async polishChapter(
    data: ProjectData,
    node: OutlineNode,
    content: string,
    opts: { mode: 'light' | 'deep'; focus?: string; route?: { provider: string; model: string } },
  ): Promise<string> {
    // 精简 system：本地润色模型上下文小（novel-polish 16384），不注入全量世界观，
    // 只给文风 + 精简人物卡（关键字段截断），保证总输入在上下文窗口内。
    const p = data.project
    const sysParts: string[] = []
    sysParts.push(`你是一位职业长篇小说作家，正在创作《${p.name}》。题材：${p.genre}。`)
    if (p.style) sysParts.push(`文风要求：${p.style}`)
    // 润色也遵循绑定文风卡（本地小模型上下文小，给更紧凑的块：最多 2 张、每张 ~500 字符）
    const scb = this.styleCardBlocks(this.activeStyleCardKeys(data), 500, 2)
    if (scb) sysParts.push(scb)
    sysParts.push('你是资深小说编辑。对给定章节正文进行修正与润色：修正错别字、语病、标点、重复用词与逻辑硬伤，确保人物言行、状态与设定一致。输出润色后的完整章节正文，只输出正文本身（不要输出标题、不要解释、不要元评论）。')
    const chars = data.characters.filter(c => c.role === 'protagonist' || c.role === 'supporting' || c.role === 'antagonist')
    if (chars.length > 0) {
      sysParts.push('\n【人物档案·关键信息】')
      for (const c of chars) {
        const bits: string[] = [`◆ ${c.name}${c.aliases.length > 0 ? '（' + c.aliases.join('、') + '）' : ''}[${c.role}]`]
        if (c.personality) bits.push(`性格：${c.personality.slice(0, 200)}`)
        if (c.goal) bits.push(`目标：${c.goal.slice(0, 200)}`)
        if (c.background) bits.push(`背景：${c.background.slice(0, 200)}`)
        sysParts.push(bits.join('；'))
      }
    }
    const system = sysParts.join('\n')
    const modeDesc = opts.mode === 'light'
      ? '轻度修正：只修硬伤（错别字/语病/标点/重复/逻辑），保持原有结构、篇幅与叙事风格，不扩写、不改情节。'
      : '深度润色：在修正硬伤的基础上增强表现力——对话更生动自然、补足动作与感官细节、优化节奏与段落衔接；可适度扩写，但不得改变情节走向、人物行为与关键信息。'
    const focusDesc = opts.focus ? `\n【重点润色方向】${opts.focus}` : ''
    const prompt = [
      `章节：第 ${node.order} 章《${node.title}》`,
      `润色要求：${modeDesc}${focusDesc}`,
      '',
      '【原文】',
      content.slice(0, 20000),
      '',
      '请输出润色后的完整章节正文（只输出正文）。',
    ].join('\n')
    // 润色专用路由：本地 polishProvider/polishModel 可用才用；否则交给 effectiveRoute（本地→当前会话模型）
    const route = opts.route ?? (this.config.polishProvider && this.config.polishModel && this.providerRegistered(this.config.polishProvider)
      ? { provider: this.config.polishProvider, model: this.config.polishModel }
      : undefined)
    // novel-editor 为本地小模型，输出可能带“imdi”等 LoRA 训练痕迹/退化或思考泄漏，需清洗并重试
    const clean = (raw: string): string => {
      let t = raw
      // 思考泄漏剥离（qwen3 系本地模型：即便 thinking 关闭仍可能输出 <think>…</think> 再给正文）
      t = t.replace(/<think>[\s\S]*?<\/think>\s*/gi, '')
      t = t.replace(/^(?:imdi\s*)+/i, '').replace(/^\s*\d+\s*\n/, '')
      t = t.replace(/^\s*imdi\s*$/gm, '')
      t = t.replace(/(?<=[。！？；;]\s*)imdi/gi, '')
      t = t.replace(/^【原文】\s*\n?/, '')
      return t.trim()
    }
    let last = ''
    for (let attempt = 0; attempt < 3; attempt++) {
      const out = await this.generate(system, prompt, { temperature: 0.3, maxTokens: 8192, route })
      last = clean(out)
      if (last.length >= 300 && !/^【原文】/.test(last)) break
    }
    return last
  }
}

/** 归一化坐标 → 方位词（供注入 prompt 的“相对位置”表达；超 0.62 视为北/东等） */
function inferMapDirection(x: number, y: number): string {
  const west = x < 0.4, east = x > 0.6
  const north = y < 0.4, south = y > 0.6
  const horiz = west ? '偏西' : east ? '偏东' : ''
  const vert = north ? '偏北' : south ? '偏南' : ''
  const both = [horiz, vert].filter(Boolean).join('·')
  return both ? `，${both}` : ''
}
