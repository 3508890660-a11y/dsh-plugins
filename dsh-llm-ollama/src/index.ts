/**
 * @dsh-external/dsh-llm-ollama — Ollama LLM 适配器插件。
 * 向 DSH 注册 provider 路由 'ollama'（OpenAI 兼容 API），并声明为可配置 provider：
 * - registerConfigurableProviders → 出现在模型设置页/模型选择器（displayName 'Ollama 本地'）
 * - 设置页表单由内核从本插件导出的 Config schema 自动派生（DSH 1.0.3+ 的 SettingsForms）
 * - adapter 以 getter 读配置：配置保存触发 profile 重载，本插件被重新 apply 并拿到新 config
 *
 * 迁移记录（2026-10-12）：DSH Desktop 1.0.3 / 内核 @deepseek-ai/dsh 0.2.0-rc.2 移除了
 * `@deepseek-ai/dsh-settings` 的 `installSettingsSection` 与 `settingsNamespace`
 * （该包现在只导出 SettingsConflictError / SettingsForms / redactSecrets）。
 * 新契约下插件只需「导出 Config schema + registerConfigurableProviders」，
 * 设置页 section 由内核 SettingsForms 自动收集生成；`settingsNs` 也从 Symbol 变回普通字符串。
 */
import type { Context } from '@deepseek-ai/cordis'
import type LlmService from '@deepseek-ai/dsh-llm'
import z from '@deepseek-ai/schemastery'
import { OllamaAdapter } from './adapter.js'

type AppContext = Context & {
  llm: LlmService
}

export const name = '@dsh-external/dsh-llm-ollama'
export const inject = ['llm']

export interface Config {
  /** Ollama 服务地址（含协议与端口）。 */
  baseUrl: string
  /** 可选 API key（Ollama 0.5+ OLLAMA_API_KEY 场景）；本地默认空。 */
  apiKey: string
  /** 本地模型默认上下文窗口（token）。 */
  contextWindow: number
  /** 本地模型默认单次输出上限（token）。 */
  maxTokens: number
}

export const Config = z.object({
  baseUrl: z.string().default('http://127.0.0.1:11434'),
  apiKey: z.string().default(''),
  contextWindow: z.number().default(32768),
  maxTokens: z.number().default(8192),
})

/** 设置命名空间（模型设置页的 section 归属）。DSH 1.0.3+ 起为普通字符串。 */
const NS = 'llm-ollama'

export function apply(ctx: AppContext, config: Config): void {
  // 配置以 getter 交给 adapter。设置页保存后内核重载 profile（app-boot/config-reload），
  // 本条目重新 apply，闭包捕获到的就是新的 config —— 因此不需要旧的 setSource 间接层。
  const adapter = new OllamaAdapter(() => config)
  const registration = ctx.llm.registerAdapter(['ollama'], adapter)

  // 声明为可配置 provider → UI 模型选择器/模型设置页可见
  ctx.llm.registerConfigurableProviders([{
    provider: 'ollama',
    displayName: 'Ollama 本地',
    settingsNs: NS,
    settingsPath: [],
  }])

  ctx.effect(() => () => {
    try { registration() } catch { /* 卸载容错 */ }
  })

  ctx.logger?.info?.(
    `[dsh-llm-ollama] provider 'ollama' configurable (baseUrl=${config.baseUrl}, contextWindow=${config.contextWindow})`,
  )
}
