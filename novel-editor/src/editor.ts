/**
 * novel-editor 编辑引擎：调用本地 Ollama novel-editor 模型（QLoRA 微调 Qwen3-4B）。
 * Prompt 模板与训练一致（03b_train_polish.py 的 ChatML 模板，assistant-only loss）：
 *   system: 你是资深中文小说编辑。…（训练 SYSTEM 原文，见 EDITOR_SYSTEM）
 *   user:   {instruction}\n\n【原文】\n{text}\n\n【润色后】
 * 因此推理格式与训练分布一致，模型只需续写【润色后】之后的正文。
 * 输出清洗：剥离 <think> 思考、imdi 等 LoRA 退化痕迹；最多 3 次重试。
 */
import type LlmService from '@deepseek-ai/dsh-llm'
import { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { Context } from '@deepseek-ai/cordis'
import { analyzeAiTraces } from './analyze.js'

export const EDITOR_SYSTEM =
  '你是资深中文小说编辑。对用户给出的【原文】执行润色指令，直接输出润色后的完整段落。' +
  '严格要求：人名、地名、道具、数字、对话内容必须原样保留，不得添加原文不存在的信息；' +
  '禁止使用任何 markdown 标记（如 ** 加粗）；禁止输出注释、说明或编号列表；只输出正文。'

/** AI 痕迹诊断（只诊断不改写）专用 system */
export const AISCAN_SYSTEM =
  '你是资深文学编辑与文字质检专家。对【原文】执行"AI 痕迹诊断"，只输出一份诊断报告，绝不改写原文。' +
  '报告结构：【总体判断】AI 可能度(低/中/高)+一句话理由；【统计特征】逐项给出证据(引用原文)+量化(句长平均值/标准差、连接词每千字密度、对称并列处数、绝对化词处数、词汇多样性)；【节奏指纹】句长是否均匀、段内句子数模式、标点节拍、是否缺留白残缺断句；【最刺眼的3点】按破坏力排序。' +
  '不加 markdown 代码块，直接输出报告正文。'

export type EditMode = 'proofread' | 'light' | 'deep' | 'consistency' | 'detrace'

/** 模式描述（与 dsh-novel-writer polishChapter 的 modeDesc 措辞对齐，proofread/consistency 为 novel-editor 新档） */
export const MODE_DESC: Record<EditMode, string> = {
  proofread: '校对：只修正错别字、错误标点、明显语病与常识性硬伤；不改变词语、不调整语序、不扩写不改写，保持原文风格与篇幅。',
  light: '轻度修正：只修硬伤（错别字/语病/标点/重复/逻辑），保持原有结构、篇幅与叙事风格，不扩写、不改情节。',
  deep: '深度润色：在修正硬伤的基础上增强表现力——对话更生动自然、补足动作与感官细节、优化节奏与段落衔接；可适度扩写，但不得改变情节走向、人物行为与关键信息。',
  consistency: '一致性审查：对照人物档案与设定，修正人物言行、状态、称谓与设定矛盾；不改情节、不扩写。',
  detrace: '去 AI 痕：先诊断再改写，目的是让文字回归"人手写、有气口"的味道。诊断(A)统计特征——句长是否过于均匀(标准差小)、书面连接词(然而/此外/值得注意的是/综上所述/因此等)是否过密、是否满是对称并列(不仅…而且/既…又)、是否绝对化用词(无疑/彻底/极其)过多、是否每段都是"首句观点+末句总结"的总分总骨架；(B)节奏指纹——句长是否缺乏起伏(应有长短错落与气口，而非规律均匀交替)、段内句子数是否过于均匀、是否缺少碎片短句与残缺留白、标点节拍(破折号/省略号/感叹号)是否单调。改写——必须破坏对称结构、打散均匀句长制造长短错落、删减书面连接词改口语化随意连接、去掉总分总骨架、降频绝对化词、允许留白与残缺断句，让文字像人快速写下的(有侧重、偏斜、疏漏感、节奏起伏)。硬性要求：只输出改写后的完整正文，绝不输出分析；不改动事实、观点、信息量、人名地名与对话内容；不是换同义词，而是改变文章气口与骨架。改写后自检：句长仍均匀或残留≥3个上述连接词则重新改写。',
}

export interface EditOpts {
  mode?: EditMode
  /** 自由指令（追加在模式描述之后，作为最终编辑要求） */
  instruction?: string
  /** 重点方向（如：对话更口语化、动作描写更细致） */
  focus?: string
  /** 附加 system 上下文（书名/题材/文风/人物档案），拼在训练 SYSTEM 之后 */
  systemExtra?: string
  temperature?: number
  maxTokens?: number
}

export interface EditorConfig {
  provider: string
  model: string
  temperature: number
  maxTokens: number
  maxChars: number
  /** 本地编辑模型离线时是否回退到当前捕获的主会话模型（默认 true） */
  fallbackToSession?: boolean
}

export class EditorEngine {
  private ctx: Context & { llm: LlmService }
  private config: EditorConfig
  /** 主会话模型路由捕获（由 index.ts 的 llm/stream 监听更新）；本地模型离线时的回退路由 */
  public sessionRoute: { provider: string; model: string } | null = null
  /** 显式配置路由是否已注册可用 */
  private get configuredRoute(): { provider: string; model: string } | null {
    if (this.config.provider && this.config.model && this.providerRegistered(this.config.provider)) {
      return { provider: this.config.provider, model: this.config.model }
    }
    return null
  }

  constructor(ctx: Context & { llm: LlmService }, config: EditorConfig) {
    this.ctx = ctx
    this.config = config
  }

  /** 更新捕获的主会话路由（本地模型离线时用于回退） */
  setSessionRoute(route: { provider: string; model: string } | null): void {
    this.sessionRoute = route
  }

  /** provider 是否已注册（复用 DSH 模型服务，ollama 为 dsh-llm-ollama 标准 provider） */
  providerRegistered(provider: string | undefined): boolean {
    if (!provider) return false
    try {
      return this.ctx.llm.listProviders().some(p => p.id === provider)
    } catch { return false }
  }

  /** 当前生效路由：显式配置（editorProvider/model）已注册 → 本地模型优先；否则若开启回退且捕获了主会话路由 → 用当前会话模型；否则 null（不可用） */
  route(): { provider: string; model: string } | null {
    const explicit = this.configuredRoute
    if (explicit) return explicit
    if (this.config.fallbackToSession !== false && this.sessionRoute && this.providerRegistered(this.sessionRoute.provider)) {
      return { provider: this.sessionRoute.provider, model: this.sessionRoute.model }
    }
    return null
  }

  /** 路由 + 来源（status 工具展示用） */
  routeInfo(): { route: { provider: string; model: string } | null; source: 'explicit' | 'session' | 'none' } {
    if (this.configuredRoute) return { route: this.configuredRoute, source: 'explicit' }
    if (this.config.fallbackToSession !== false && this.sessionRoute && this.providerRegistered(this.sessionRoute.provider)) {
      return { route: { provider: this.sessionRoute.provider, model: this.sessionRoute.model }, source: 'session' }
    }
    return { route: null, source: 'none' }
  }

  /** 用户 prompt：与训练模板一致（指令直接接【原文】，无标题前缀） */
  buildUserPrompt(text: string, opts: EditOpts): string {
    const parts: string[] = []
    if (opts.mode) parts.push(MODE_DESC[opts.mode])
    if (opts.instruction?.trim()) parts.push(opts.instruction.trim())
    if (opts.focus?.trim()) parts.push(`【重点方向】${opts.focus.trim()}`)
    const instr = parts.join('\n') || '对下面的【原文】进行编辑润色，直接输出编辑后的完整段落。'
    const sliced = text.length > this.config.maxChars ? text.slice(0, this.config.maxChars) : text
    return `${instr}\n\n【原文】\n${sliced}\n\n【润色后】`
  }

  /** 单次调用 LLM，返回原始文本（含可能的 think/imdi 残留） */
  private async generateOnce(system: string, prompt: string, route: { provider: string; model: string }, opts: EditOpts): Promise<string> {
    let text = ''
    let finishReason = ''
    let failureMsg = ''
    // 仅当跑本地显式编辑模型时强制关思考（Qwen3 思考会吃光 token 预算且训练数据无思考内容）。
    // 回退主会话模型时交由其默认档（多数云端/网关模型不支持 reasoningEffort 'off'）。
    const isExplicitRoute = this.configuredRoute?.provider === route.provider && this.configuredRoute?.model === route.model
    const stream = this.ctx.llm.stream({
      provider: route.provider,
      model: route.model,
      system,
      messages: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: prompt }] })],
      temperature: opts.temperature ?? this.config.temperature,
      maxTokens: opts.maxTokens ?? this.config.maxTokens,
      ...(isExplicitRoute ? { reasoningEffort: ReasoningEffortId('off') } : {}),
    })
    for await (const chunk of stream) {
      if (chunk.type === 'text-delta') {
        text += chunk.text
      } else if (chunk.type === 'finish') {
        const reason = chunk.reason as { kind?: string; failure?: { message?: string } }
        finishReason = reason?.kind ?? ''
        failureMsg = reason?.failure?.message ?? ''
      }
    }
    if (!text.trim()) {
      throw new Error(`LLM 无文本输出（finish=${finishReason || 'none'}${failureMsg ? `：${failureMsg}` : ''}；${route.provider}/${route.model}）`)
    }
    return text
  }

  /** 输出清洗：think 剥离 + imdi 退化 + 【润色后】/【原文】标记 */
  cleanOutput(raw: string): string {
    let t = raw
    t = t.replace(/<think>[\s\S]*?<\/think>\s*/gi, '')
    t = t.replace(/^(?:imdi\s*)+/i, '').replace(/^\s*\d+\s*\n/, '')
    t = t.replace(/^\s*imdi\s*$/gm, '')
    t = t.replace(/(?<=[。！？；;]\s*)imdi/gi, '')
    t = t.replace(/^【润色后】\s*\n?/, '')
    t = t.replace(/^【原文】\s*\n?/, '')
    return t.trim()
  }

  /** 编辑主流程：调用 -> 清洗 -> 重试（输出过短/含【原文】标记时重试，最多 3 次） */
  async edit(text: string, opts: EditOpts): Promise<string> {
    const route = this.route()
    if (!route) {
      throw new Error('无可用模型路由：本地编辑模型(ollama/novel-editor)不可用，且尚未捕获到主会话模型(回退路由为空)。请启动 Ollama 并 create novel-editor 模型，或在主会话发一条消息后再重试。')
    }
    const system = [EDITOR_SYSTEM, opts.systemExtra].filter(Boolean).join('\n')
    const prompt = this.buildUserPrompt(text, opts)
    let last = ''
    for (let attempt = 0; attempt < 3; attempt++) {
      const raw = await this.generateOnce(system, prompt, route, opts)
      last = this.cleanOutput(raw)
      if (last.length >= 100 && !/^【原文】/.test(last) && !/<think>/i.test(last)) break
    }
    if (!last) throw new Error('LLM 无文本输出（重试 3 次仍为空）')
    return last
  }

  /** AI 痕迹诊断（只诊断不改写）：返回模型叙述的诊断报告；统计特征由调用方用 analyzeAiTraces 客观计算 */
  async scanAi(text: string, opts: EditOpts): Promise<string> {
    const route = this.route()
    if (!route) {
      throw new Error('无可用模型路由：本地编辑模型(ollama/novel-editor)不可用，且尚未捕获到主会话模型。请先启动 Ollama，或让主会话调用一次模型后再重试。')
    }
    const system = [AISCAN_SYSTEM, opts.systemExtra].filter(Boolean).join('\n')
    const sliced = text.length > this.config.maxChars ? text.slice(0, this.config.maxChars) : text
    const prompt = `对下面的【原文】执行 AI 痕迹诊断，只输出诊断报告，不改写原文。\n\n【原文】\n${sliced}`
    const raw = await this.generateOnce(system, prompt, route, opts)
    return this.cleanOutput(raw)
  }
}
