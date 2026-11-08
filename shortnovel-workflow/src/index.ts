/**
 * @dsh-external/shortnovel-workflow - 墨安式爆款短篇创作工作流（DSH 插件）。
 *
 * 工作流：主题/脑洞 -> 脑洞(5个) -> 导语(5条爆款导语) -> 大纲(10章×10剧情点, 按题材公式)
 * -> 正文(强去AI味, 一句一行, ~1.2万字) -> 审稿(付费点+修改方案+改后全文)。
 * 严格分步：每阶段生成内容后由 AI 助手询问用户是否满意；满意 advance 推进，不满意 revise 重生成。
 * 模型层：复用 DSH 模型服务（ctx.llm.stream，捕获主会话路由），可经 Config 覆盖 provider/model。
 * 文风卡：可经 `shortnovel_style_kb` 给项目绑定/启用 style-kb 文风卡，生成时自动注入各阶段。
 * 工具链：shortnovel_* 系列 8 个工具（start/generate/advance/revise/status/list/delete/style_kb）。
 */
import type { Context } from '@deepseek-ai/cordis'
import type LlmService from '@deepseek-ai/dsh-llm'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { mkdirSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import z from '@deepseek-ai/schemastery'
import { ShortNovelStore } from './store.js'
import { WorkflowGenerator } from './generator.js'
import { StyleKb } from './style-kb.js'
import { buildTools } from './tools.js'

type AppContext = Context & {
  llm: LlmService
}

export const name = '@dsh-external/shortnovel-workflow'
export const inject = ['tools', 'llm']

export interface Config {
  /** 数据目录（空=自动解析，优先级：SHORTNOVEL_DATA_DIR env -> 插件工作目录/shortnovel-data -> DSH_HOME 兜底） */
  dataDir: string
  /** 显式模型路由（空=跟随主会话捕获的路由） */
  provider: string
  model: string
  temperature: number
  maxTokens: number
  /** 思考档位（默认 off=关闭思考）。若当前路由模型不支持，会自动降级为省略该参数。 */
  reasoningEffort: string
  /** 目标字数（每个新项目的默认目标） */
  targetChars: number
  /** 文风知识库根目录（含 cards/ 子目录；空=自动解析：STYLE_KB_DIR env -> 插件工作目录 + style-kb） */
  styleKbDir: string
}

export const Config = z.object({
  dataDir: z.string().default(''),
  provider: z.string().default(''),
  model: z.string().default(''),
  temperature: z.number().min(0).max(2).default(0.8),
  maxTokens: z.number().min(256).max(65536).default(8192),
  reasoningEffort: z.string().default('off'),
  targetChars: z.number().min(5000).max(100000).default(15000),
  styleKbDir: z.string().default(''),
})

/** 数据目录解析：config -> SHORTNOVEL_DATA_DIR env -> 插件工作目录（realpath 推导）-> DSH_HOME 兜底 */
function resolveDataDir(configDataDir: string): string {
  if (configDataDir) return configDataDir
  const envDir = process.env.SHORTNOVEL_DATA_DIR
  if (envDir) return envDir
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    const pkgRoot = realpathSync(join(here, '..'))
    return join(dirname(pkgRoot), 'shortnovel-data')
  } catch { /* realpath 失败（非 junction/拷贝部署）走兜底 */ }
  return join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'shortnovel-data')
}

/** 文风知识库根目录解析：config -> STYLE_KB_DIR env -> 插件工作目录 + style-kb */
function resolveStyleKbDir(configStyleKbDir: string): string {
  if (configStyleKbDir) return configStyleKbDir
  const envDir = process.env.STYLE_KB_DIR
  if (envDir) return envDir
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    const pkgRoot = realpathSync(join(here, '..'))
    return join(dirname(pkgRoot), 'style-kb')
  } catch { /* 兜底 */ }
  return join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'style-kb')
}

export function apply(ctx: AppContext, config: Config): void {
  // 数据目录解析（C 盘紧张：默认落在工作目录）
  const dataDir = resolveDataDir(config.dataDir)
  mkdirSync(dataDir, { recursive: true })

  // 文风知识库（文风卡/手法卡）适配
  const styleKb = new StyleKb(resolveStyleKbDir(config.styleKbDir))

  const store = new ShortNovelStore(dataDir)
  const generator = new WorkflowGenerator(ctx, {
    provider: config.provider || undefined,
    model: config.model || undefined,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    reasoningEffort: config.reasoningEffort,
    styleKb,
  })

  // 观察主会话模型路由（waterfall 必须 next() 委托）--复用 DSH 模型服务的关键
  ctx.on('llm/stream', (options, next) => {
    generator.lastSessionRoute = { provider: options.provider, model: options.model }
    return next()
  })

  // 注册 shortnovel_* 工具链
  const disposers: (() => void)[] = []
  for (const tool of buildTools({ store, generator, dataDir })) {
    // 同名工具冲突护栏：若某工具名已被其它插件注册，本插件跳过该条以避免 apply 抛错
    if (ctx.tools.get(tool.name)) continue
    disposers.push(ctx.tools.register(tool))
  }

  ctx.effect(() => () => {
    for (const d of disposers.splice(0)) {
      try { d() } catch { /* 卸载容错 */ }
    }
  })

  ctx.logger?.info?.(`[${name}] 墨安式爆款短篇创作工作流就绪（数据目录: ${dataDir}，文风知识库: ${styleKb.available ? styleKb.rootDir : '不可达(未注入文风卡)'}，工具 ${disposers.length} 已注册）`)
}
