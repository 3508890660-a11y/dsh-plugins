/**
 * shortnovel_* 工具集：墨安式爆款短篇创作工作流（脑洞→导语→大纲→正文→审稿）。
 * 严格分步：每个阶段生成内容后，须由 AI 助手向用户确认"是否满意"；
 * 满意 -> shortnovel_advance 进入下一步；不满意 -> shortnovel_revise 携反馈重生成。
 * 正文阶段为「目标制」：大纲阶段产出"正文目标清单(JSON)"，正文按目标逐段完成；
 * 未解析到目标时回退为字数制（按目标字数分块续写），写够后再推进到审稿。
 * 本质是状态机（store.stage 指针），禁止跳过阶段或一次性写完。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { ShortNovelStore } from './store.js'
import type { WorkflowGenerator } from './generator.js'
import type { ShortNovelProject, StageKey, ProjectGoal } from './types.js'
import { STAGE_LABEL, STAGE_GUIDE, nextStage, stageIndex, wordCountOf, projectId } from './types.js'

const text = (t: string) => [{ type: 'text' as const, text: t }]
const unk = <T>(v: unknown): T => v as unknown as T

export interface ToolDeps {
  store: ShortNovelStore
  generator: WorkflowGenerator
  dataDir: string
}

const DEFAULT_TARGET = 12000

/** 各阶段产物入库，并推进/保持 stage */
function commitStage(p: ShortNovelProject, stage: StageKey, content: string): ShortNovelProject {
  p.content[stage] = content
  return p
}

/**
 * 从大纲产物中解析「正文目标清单(JSON)」：取最后一个 fenced json 块，解析为 ProjectGoal[]。
 * 解析成功则把它从展示用正文里剔除（clean）；解析失败返回空 goals（正文回退到字数制）。
 */
function extractGoals(raw: string): { clean: string; goals: ProjectGoal[] } {
  const goals: ProjectGoal[] = []
  const m = /```(?:json)?[ \t]*\r?\n([\s\S]*?)```/.exec(raw)
  let clean = raw
  if (!m) return { clean, goals }
  try {
    const parsed: unknown = JSON.parse(m[1])
    const arr = Array.isArray(parsed) ? parsed : (parsed && typeof parsed === 'object' && Array.isArray((parsed as { goals?: unknown[] }).goals) ? (parsed as { goals: unknown[] }).goals : null)
    if (arr) {
      arr.forEach((g, i) => {
        if (!g || typeof g !== 'object') return
        const o = g as Record<string, unknown>
        const title = String(o.title ?? `第${i + 1}段`).trim() || `第${i + 1}段`
        const targetChars = Math.max(200, Math.min(6000, Number(o.targetChars) || 1000))
        const beats = Array.isArray(o.beats) ? o.beats.map(String).filter(Boolean) : (o.beats ? [String(o.beats)] : [])
        const hook = o.hook ? String(o.hook) : undefined
        goals.push({ index: i + 1, title, targetChars, beats, hook, done: false })
      })
    }
  } catch { /* JSON 解析失败：goals 留空，正文走字数制兜底 */ }
  if (goals.length > 0) clean = raw.replace(m[0], '').replace(/\n{3,}/g, '\n\n').trim()
  return { clean, goals }
}

/** 项目是否处于「正文目标制」（有大纲定下的目标清单） */
function inGoalMode(p: ShortNovelProject): boolean {
  return Array.isArray(p.goals) && p.goals.length > 0
}

/** 已写出的正文段数（非空 novelParts 数） */
function writtenParts(p: ShortNovelProject): number {
  return p.novelParts.filter(x => x && x.trim()).length
}

/** 主流程：对指定阶段生成内容（生成后写库，不自动推进 stage）。feedback 用于 revise 重写当前阶段；styleKeys 覆盖本次文风卡 */
async function doGenerate(deps: ToolDeps, id: string, feedback?: string, styleKeys?: string[]): Promise<{ stage: StageKey; content: string; guide: string }> {
  const p = deps.store.load(id)
  const stage = p.stage
  let content: string
  switch (stage) {
    case 'brainstorm': content = await deps.generator.genBrainstorm(p, feedback, styleKeys); break
    case 'leadin': content = await deps.generator.genLeadin(p, feedback, styleKeys); break
    case 'outline': {
      const raw = await deps.generator.genOutline(p, feedback, styleKeys)
      const { clean, goals } = extractGoals(raw)
      content = clean
      p.goals = goals
      // 大纲（重）生成 -> 正文目标与正文进度一并重置
      p.novelParts = []
      p.content.novel = ''
      break
    }
    case 'review': content = await deps.generator.genReview(p, feedback, styleKeys); break
    case 'novel': {
      if (p.novelParts.length === 0) p.novelParts = ['']
      const goals = inGoalMode(p) ? p.goals : null
      const target = p.targetChars || DEFAULT_TARGET
      const total = goals ? goals.length : Math.max(3, Math.ceil(target / 3200))
      const idx = p.novelParts.length - 1
      const prevTail = idx > 0 ? p.novelParts[idx - 1].slice(-800) : ''
      const goal = goals ? goals[Math.min(idx, goals.length - 1)] : undefined
      content = await deps.generator.genNovelPart(p, idx, total, prevTail, feedback, styleKeys, goal)
      p.novelParts[idx] = content
      p.content.novel = p.novelParts.filter(Boolean).join('\n\n')
      // 同步目标完成态
      if (goals) {
        const written = writtenParts(p)
        goals.forEach((g, i) => { g.done = i < written })
      }
      deps.store.save(id)
      const cur = wordCountOf(p)
      const guide = goals
        ? `正文目标 ${Math.min(idx + 1, goals.length)}/${goals.length}「${goal?.title ?? ''}」· 本段约 ${goal?.targetChars ?? '?'} 字 · 全书已写约 ${cur} 字。`
        : `正文进行中：已写约 ${cur} 字（目标约 ${target} 字）。`
      return { stage, content, guide }
    }
  }
  commitStage(p, stage, content)
  deps.store.save(id)
  return { stage, content, guide: STAGE_GUIDE[stage] }
}

export function buildTools(deps: ToolDeps): ToolDefinition[] {
  const { store, generator, dataDir } = deps
  const tools: ToolDefinition[] = []

  // ── 0. 建项目 / 输入主题 ──
  tools.push(defineTool({
    name: 'shortnovel_start',
    description: '启动一本爆款短篇小说创作项目，登记主题/脑洞与题材。返回项目 id 与当前阶段（brainstorm）。随后用 shortnovel_generate 生成脑洞。',
    parameters: {
      topic: { type: 'string', required: true, description: '主题/脑洞/例文导语等输入素材，如：一个被家族背叛的天才剑客重生的故事' },
      genre: { type: 'string', description: '题材（决定大纲公式）：追妻虐爽/世情爽/言情甜宠/惊悚悬疑 或 其它类型' },
      style: { type: 'string', description: '文风要求，如：强冲突快节奏、情绪宣泄、含蓄克制' },
      title: { type: 'string', description: '可选书名；不填则待后续阶段自动起名' },
      targetChars: { type: 'integer', description: '目标字数，默认 12000（约 1–1.2 万字）' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          title: { type: 'string', required: true },
          stage: { type: 'string', required: true },
          message: { type: 'string', required: true },
        },
      },
      render: (_a, v) => {
        const r = unk<{ id: string; title: string; stage: string; message: string }>(v)
        return text(`爆款短篇小说项目已创建：《${r.title}》(id=${r.id})，当前阶段：${r.stage}\n${r.message}`)
      },
    },
    async execute(args) {
      const a = unk<{ topic: string; genre?: string; style?: string; title?: string; targetChars?: number }>(args)
      if (!a.topic?.trim()) throw new Error('必须提供 topic（主题/脑洞/例文等输入）')
      const id = projectId()
      const title = a.title?.trim() || (a.topic.trim().slice(0, 12) || '未命名短篇')
      const p = store.createProject({
        id, topic: a.topic.trim(), genre: a.genre ?? '', style: a.style ?? '',
        title, targetChars: a.targetChars ?? DEFAULT_TARGET,
      })
      return { id, title, stage: p.stage, message: `请调用 shortnovel_generate 生成【脑洞】。` }
    },
  }))

  // ── 1. 生成当前阶段内容 ──
  tools.push(defineTool({
    name: 'shortnovel_generate',
    description: '生成当前阶段的内容（brainstorm脑洞→leadin导语→outline大纲→novel正文→review审稿）。生成后向用户展示并询问是否满意。',
    parameters: {
      projectId: { type: 'string', required: true, description: '项目 id' },
      styleCards: { type: 'array', items: { type: 'string' }, description: '可选：本次生成临时覆盖的文风卡 key 清单（不传则用项目启用的默认集；例：["c085-yonezawa-honobu","hands02-setting-detective"]）' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          projectId: { type: 'string', required: true },
          stage: { type: 'string', required: true },
          stageLabel: { type: 'string', required: true },
          content: { type: 'string', required: true },
          guide: { type: 'string', required: true },
          done: { type: 'boolean', required: true },
          wordCount: { type: 'integer', required: true },
        },
      },
      render: (_a, v) => {
        const r = unk<{ stage: string; stageLabel: string; content: string; guide: string; done: boolean; wordCount: number }>(v)
        if (r.stage === 'novel' && !r.done) {
          return text(`【${r.stageLabel}】进行中（已 ${r.wordCount} 字）\n${r.guide}\n\n${r.content.slice(0, 1200)}`)
        }
        return text(`【${r.stageLabel}】\n${r.content}\n\n📌 本阶段要点：${r.guide}\n\n是否满意？满意请 shortnovel_advance，不满意请 shortnovel_revise。`)
      },
    },
    async execute(args) {
      const a = unk<{ projectId: string; styleCards?: string[] }>(args)
      const r = await doGenerate(deps, a.projectId, undefined, a.styleCards)
      const p = store.load(a.projectId)
      return {
        projectId: a.projectId, stage: r.stage, stageLabel: STAGE_LABEL[r.stage],
        content: r.content, guide: r.guide, done: p.done, wordCount: wordCountOf(p),
      }
    },
    timeoutMs: 600_000,
  }))

  // ── 2. 确认满意并进入下一步 ──
  tools.push(defineTool({
    name: 'shortnovel_advance',
    description: '用户对当前阶段内容"满意"。正文未写够目标字数时继续续写下一段；正文写够后推进到审稿；审稿满意后标记整本完成。',
    parameters: {
      projectId: { type: 'string', required: true, description: '项目 id' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          projectId: { type: 'string', required: true },
          prevStage: { type: 'string', required: true },
          stage: { type: 'string', required: true },
          stageLabel: { type: 'string', required: true },
          content: { type: 'string', required: true },
          guide: { type: 'string', required: true },
          done: { type: 'boolean', required: true },
          wordCount: { type: 'integer', required: true },
          message: { type: 'string', required: true },
        },
      },
      render: (_a, v) => {
        const r = unk<{ prevStage: string; stage: string; stageLabel: string; content: string; guide: string; done: boolean; wordCount: number; message: string }>(v)
        if (r.done) {
          return text(`🎉 已完成整本爆款短篇小说（约 ${r.wordCount} 字，含审稿）。\n${r.content.slice(0, 800)}`)
        }
        return text(`✅ 已确认【${r.prevStage}】，进入下一步。\n\n【${r.stageLabel}】\n${r.content}\n\n📌 本阶段要点：${r.guide}\n\n${r.message}`)
      },
    },
    async execute(args) {
      const a = unk<{ projectId: string }>(args)
      const p = store.load(a.projectId)
      const prevStage = p.stage
      if (p.done) throw new Error('项目已完成（done=true），无需再推进。')

      // 正文阶段：目标制按「大纲定下的正文目标」逐段完成；无目标则按目标字数兜底
      if (prevStage === 'novel') {
        const goals = inGoalMode(p) ? p.goals : null
        const cur = wordCountOf(p)
        const target = p.targetChars || DEFAULT_TARGET
        const written = writtenParts(p)
        const complete = goals ? written >= goals.length : cur >= target
        if (!complete) {
          p.novelParts.push('')
          store.save(a.projectId)
          const r = await doGenerate(deps, a.projectId)
          const nxtGoal = goals ? goals[Math.min(written, goals.length - 1)] : null
          return {
            projectId: a.projectId, prevStage, stage: r.stage, stageLabel: STAGE_LABEL[r.stage],
            content: r.content, guide: r.guide, done: p.done, wordCount: wordCountOf(p),
            message: goals
              ? `正文目标制：已完成 ${written}/${goals.length}，正在写第 ${written + 1} 段「${nxtGoal?.title ?? ''}」。满意请再次 shortnovel_advance 继续，或 shortnovel_revise 重写本段。`
              : `正文续写中。是否满意？满意请再次 shortnovel_advance 继续写（写够目标字数后将自动进入审稿），或改 shortnovel_revise。`,
          }
        }
        // 全部正文目标完成 -> 推进到审稿
        const nxt = nextStage(prevStage)
        if (!nxt) throw new Error('内部错误：novel 后无下一阶段')
        p.stage = nxt
        store.save(a.projectId)
        const r = await doGenerate(deps, a.projectId)
        return {
          projectId: a.projectId, prevStage, stage: r.stage, stageLabel: STAGE_LABEL[r.stage],
          content: r.content, guide: r.guide, done: p.done, wordCount: wordCountOf(p),
          message: goals
            ? `全部 ${goals.length} 个正文目标已完成，进入【审稿】。请确认是否满意；满意继续 shortnovel_advance 完成整本，不满意 shortnovel_revise。`
            : `正文已写够目标字数，进入【审稿】。请确认是否满意；满意继续 shortnovel_advance 完成整本，不满意 shortnovel_revise。`,
        }
      }

      // 其它阶段：正常推进
      const nxt = nextStage(prevStage)
      if (!nxt) {
        // 已是最后一个阶段（review）：满意 -> 完成整本
        if (prevStage === 'review' && p.content.review) {
          p.done = true
          store.save(a.projectId)
          return {
            projectId: a.projectId, prevStage, stage: 'review', stageLabel: STAGE_LABEL.review,
            content: p.content.review || '', guide: STAGE_GUIDE.review, done: true,
            wordCount: wordCountOf(p), message: `审稿完成，整本小说已定稿。`,
          }
        }
        throw new Error('当前阶段已是最后一步（审稿），无法再推进；如已满意请确认完成。')
      }
      p.stage = nxt
      store.save(a.projectId)
      const r = await doGenerate(deps, a.projectId)
      const np = store.load(a.projectId)
      return {
        projectId: a.projectId, prevStage, stage: r.stage, stageLabel: STAGE_LABEL[r.stage],
        content: r.content, guide: r.guide, done: np.done, wordCount: wordCountOf(np),
        message: `请确认是否满意。满意继续 shortnovel_advance，不满意 shortnovel_revise。`,
      }
    },
    timeoutMs: 600_000,
  }))

  // ── 3. 不满意，携反馈重生成当前阶段 ──
  tools.push(defineTool({
    name: 'shortnovel_revise',
    description: '用户对当前阶段内容"不满意"，携具体反馈重新生成当前阶段内容。仅重写当前阶段，不改其它已确认阶段。',
    parameters: {
      projectId: { type: 'string', required: true, description: '项目 id' },
      feedback: { type: 'string', required: true, description: '修改反馈/方向，如：主角改成女性、冲突更激烈、反转再狠一点；或在脑洞/导语阶段"选第 3 个"定稿' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          projectId: { type: 'string', required: true },
          stage: { type: 'string', required: true },
          stageLabel: { type: 'string', required: true },
          content: { type: 'string', required: true },
          guide: { type: 'string', required: true },
          message: { type: 'string', required: true },
        },
      },
      render: (_a, v) => {
        const r = unk<{ stageLabel: string; content: string; guide: string; message: string }>(v)
        return text(`🔄 已按反馈重新生成【${r.stageLabel}】。\n\n${r.content}\n\n📌 本阶段要点：${r.guide}\n\n${r.message}`)
      },
    },
    async execute(args) {
      const a = unk<{ projectId: string; feedback: string }>(args)
      if (!a.feedback?.trim()) throw new Error('必须提供 feedback（修改反馈/方向）')
      const p = store.load(a.projectId)
      if (p.done) throw new Error('项目已完成，无法修正；如需改动可直接向作者反馈。')
      // 对当前阶段重生成，携反馈（doGenerate 自动按当前 stage 分派）
      let r: { stage: StageKey; content: string; guide: string }
      if (p.stage === 'novel') {
        // 目标制：只重写当前段（不清空已完成的目标段）；字数制：重写当前块
        if (p.novelParts.length > 0) p.novelParts[p.novelParts.length - 1] = ''
        else p.novelParts = ['']
        store.save(a.projectId)
        r = await doGenerate(deps, a.projectId, a.feedback.trim())
      } else {
        r = await doGenerate(deps, a.projectId, a.feedback.trim())
      }
      return {
        projectId: a.projectId, stage: r.stage, stageLabel: STAGE_LABEL[r.stage],
        content: r.content, guide: r.guide, message: `是否满意？满意 shortnovel_advance，反之继续 shortnovel_revise。`,
      }
    },
    timeoutMs: 600_000,
  }))

  // ── 4. 状态 ──
  tools.push(defineTool({
    name: 'shortnovel_status',
    description: '查看短篇小说项目当前阶段、各已确认阶段内容与进度。',
    parameters: {
      projectId: { type: 'string', required: true, description: '项目 id' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          title: { type: 'string', required: true },
          topic: { type: 'string', required: true },
          genre: { type: 'string', required: true },
          stage: { type: 'string', required: true },
          stageLabel: { type: 'string', required: true },
          done: { type: 'boolean', required: true },
          wordCount: { type: 'integer', required: true },
          targetChars: { type: 'integer', required: true },
          goalProgress: { type: 'string', required: true },
          stages: { type: 'array', items: { type: 'json' }, required: true },
        },
      },
      render: (_a, v) => {
        const r = unk<{ title: string; topic: string; genre: string; stage: string; stageLabel: string; done: boolean; wordCount: number; targetChars: number; goalProgress: string; stages: { label: string; confirmed: boolean; current: boolean }[] }>(v)
        const bar = r.stages.map(s => (s.current ? `▶${s.label}` : s.confirmed ? `✓${s.label}` : `·${s.label}`)).join(' → ')
        return text(`《${r.title}》（主题：${r.topic}${r.genre ? `｜题材：${r.genre}` : ''}）\n进度：${r.done ? '已完成' : '进行中'}｜当前阶段：${r.stageLabel}｜已写 ${r.wordCount}/${r.targetChars} 字${r.goalProgress ? `｜${r.goalProgress}` : ''}\n流程：${bar}`)
      },
    },
    async execute(args) {
      const a = unk<{ projectId: string }>(args)
      const p = store.load(a.projectId)
      const order: StageKey[] = ['brainstorm', 'leadin', 'outline', 'novel', 'review']
      const cur = stageIndex(p.stage)
      const stages = order.map((s, i) => ({
        label: STAGE_LABEL[s],
        confirmed: i < cur || (i === cur && !!p.content[s] && s !== 'novel'),
        current: i === cur,
      }))
      const goals = inGoalMode(p) ? p.goals : []
      const written = writtenParts(p)
      const goalProgress = goals.length
        ? `正文目标 ${Math.min(written, goals.length)}/${goals.length}${goals[Math.min(written, goals.length - 1)] ? `（当前：${goals[Math.min(written, goals.length - 1)].title}）` : ''}`
        : ''
      return {
        title: p.title, topic: p.topic, genre: p.genre, stage: p.stage, stageLabel: STAGE_LABEL[p.stage],
        done: p.done, wordCount: wordCountOf(p), targetChars: p.targetChars, goalProgress, stages,
      }
    },
  }))

  // ── 5. 列表 / 删除 ──
  tools.push(defineTool({
    name: 'shortnovel_list',
    description: '列出全部短篇小说项目（id/书名/题材/阶段/字数/完成度）。',
    parameters: {},
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          projects: { type: 'array', items: { type: 'json' }, required: true },
          count: { type: 'integer', required: true },
        },
      },
      render: (_a, v) => text(`共 ${(v as { count: number }).count} 个项目`),
    },
    async execute() {
      const projects = store.listProjects().map(m => ({
        id: m.id, title: m.title, topic: m.topic, genre: m.genre,
        stage: m.stage, done: m.done, wordCount: m.wordCount, updatedAt: m.updatedAt,
      }))
      return { projects, count: projects.length }
    },
  }))

  tools.push(defineTool({
    name: 'shortnovel_delete',
    description: '删除一个短篇小说项目。',
    parameters: {
      projectId: { type: 'string', required: true, description: '项目 id' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          message: { type: 'string', required: true },
        },
      },
      render: (_a, v) => text(`已删除项目 ${(v as { id: string }).id}`),
    },
    async execute(args) {
      const a = unk<{ projectId: string }>(args)
      store.delete(a.projectId)
      return { id: a.projectId, message: '已删除' }
    },
  }))

  // ── 6. 文风知识库（文风卡/手法卡）适配 ──
  tools.push(defineTool({
    name: 'shortnovel_style_kb',
    description: '文风知识库（style-kb/cards）适配：给短篇项目绑定/启用/停用/移除文风卡，生成时自动把启用的卡片蒸馏成「文风指引块」注入脑洞/导语/大纲/正文/审稿各阶段。action=list（检索全部卡，q/tag 过滤）；get（查看项目已绑定卡片与启用状态）；bind（绑定，cards 可传 key 或标题/作品名柔性匹配）；unbind（解除）；set_enabled（切换启用）；preview（预览将注入的文风指引块）。也可在 shortnovel_generate 传 styleCards 本次临时选用。',
    parameters: {
      action: { type: 'string', required: true, description: 'list / get / bind / unbind / set_enabled / preview' },
      projectId: { type: 'string', description: '项目 id（bind/unbind/set_enabled/get/preview 需要）' },
      cards: { type: 'array', items: { type: 'string' }, description: '卡片引用 list（接受 key 或标题/作品名柔性匹配；bind/unbind/set_enabled 用）' },
      enabled: { type: 'boolean', description: 'set_enabled 用：是否启用（true/false）' },
      q: { type: 'string', description: 'list 检索：标题/作者/作品/关键分子串' },
      tag: { type: 'string', description: 'list 过滤：体裁标签，如 推理-本格 / 异世界 / 恋爱喜剧' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          action: { type: 'string', required: true },
          available: { type: 'boolean', required: true },
          message: { type: 'string', required: true },
          cards: { type: 'array', items: { type: 'json' }, required: true },
        },
      },
      render: (_a, v) => {
        const r = unk<{ action: string; available: boolean; message: string; cards: { key: string; title: string; tags?: string[]; kind?: string }[] }>(v)
        if (!r.available) return text(`⚠️ 文风知识库不可达：请在插件配置 styleKbDir 指向 style-kb 根目录（含 cards/ 子目录）。${r.message || ''}`)
        let out = `【文风知识库】${r.message}\n`
        if (r.cards && r.cards.length) {
          out += r.cards.map(c => `- ${c.key} ｜ ${c.title}${c.tags && c.tags.length ? `（${c.tags.join('、')}）` : ''}`).join('\n')
        }
        return text(out.trimEnd())
      },
    },
    async execute(args) {
      const a = unk<{ action: string; projectId?: string; cards?: string[]; enabled?: boolean; q?: string; tag?: string }>(args)
      const kb = generator.styleKb
      const action = a.action || 'list'
      if (!kb || !kb.available) {
        return { action, available: false, message: '文风知识库不可达（styleKbDir 未指向 style-kb）。', cards: [] }
      }
      const empty = { action, available: true, message: '', cards: [] as { key: string; title: string; tags?: string[]; kind?: string }[] }

      if (action === 'list') {
        const items = kb.list({ q: a.q, tag: a.tag })
        return {
          action, available: true,
          message: `共 ${kb.count} 张文风卡；检索命中 ${items.length} 张${a.q ? `（q=${a.q}）` : ''}${a.tag ? `（tag=${a.tag}）` : ''}。`,
          cards: items.map(c => ({ key: c.key, title: c.title, tags: c.tags, kind: c.kind })),
        }
      }

      if (!a.projectId) return { ...empty, message: 'bind/unbind/set_enabled/get/preview 需要 projectId。' }
      const p = store.load(a.projectId)

      if (action === 'get') {
        const bound = (p.styleCards || []).map(sc => ({ key: sc.key, title: kb.read(sc.key)?.title ?? sc.key, enabled: sc.enabled }))
        return {
          action, available: true,
          message: `《${p.title}》已绑定文风卡 ${bound.length} 张；启用 ${bound.filter(b => b.enabled).length} 张（生成时默认注入）。`,
          cards: bound,
        }
      }

      if (action === 'preview') {
        const block = generator.styleBlock(p)
        if (!block) return { ...empty, message: `《${p.title}》当前没有启用的文风卡，或知识库不可达（可用 bind 绑定后 set_enabled 启用）。`, cards: [] }
        return { action, available: true, message: `即将注入的文风指引块（单次最多 3 张，每张约 700 字符）：\n${block}`, cards: [] }
      }

      const refs = (a.cards || []).filter(Boolean)
      if (refs.length === 0) return { ...empty, message: `${action} 需要提供 cards（卡片引用）。` }
      // 解析引用 -> keys
      const resolved: string[] = []
      const missed: { ref: string; hint?: string }[] = []
      for (const ref of refs) {
        const r = kb.resolve(ref)
        if (r.matched) resolved.push(r.key)
        else missed.push({ ref, hint: r.hint })
      }

      if (action === 'bind') {
        for (const key of resolved) {
          const ex = (p.styleCards || []).find(c => c.key === key)
          if (ex) ex.enabled = true
          else p.styleCards.push({ key, enabled: true })
        }
        store.save(a.projectId)
        return { ...empty, message: `已绑定 ${resolved.length} 张并默认启用：${resolved.join('、')}${missed.length ? `；未匹配 ${missed.length}：${missed.map(m => `${m.ref}${m.hint ? `（${m.hint}）` : ''}`).join('；')}` : ''}` }
      }

      if (action === 'unbind') {
        p.styleCards = (p.styleCards || []).filter(c => !resolved.includes(c.key))
        store.save(a.projectId)
        return { ...empty, message: `已解除 ${resolved.length} 张：${resolved.join('、')}${missed.length ? `；未匹配 ${missed.length}` : ''}` }
      }

      if (action === 'set_enabled') {
        const en = !!a.enabled
        for (const key of resolved) {
          const ex = (p.styleCards || []).find(c => c.key === key)
          if (ex) ex.enabled = en
        }
        store.save(a.projectId)
        const on = (p.styleCards || []).filter(c => c.enabled).map(c => c.key)
        return { ...empty, message: `已将 ${resolved.join('、')} 设为「${en ? '启用' : '停用'}」；当前启用 ${on.length} 张：${on.join('、') || '（无，生成将不注入文风卡）'}` }
      }

      return { ...empty, message: `未知 action：${action}（可用 list/get/bind/unbind/set_enabled/preview）` }
    },
  }))

  return tools
}