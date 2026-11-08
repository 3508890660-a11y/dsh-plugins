/**
 * dsh-llm-probe — 一次性诊断：把 llm 服务的 provider 拓扑写到日志文件。
 */
import type { Context } from '@deepseek-ai/cordis'
import type LlmService from '@deepseek-ai/dsh-llm'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'

type AppContext = Context & {
  llm: LlmService
}

export const name = '@dsh-external/dsh-llm-probe'
export const inject = ['llm']

export function apply(ctx: AppContext): void {
  const logFile = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'super-injector', 'llm-probe.log')
  const log = (msg: string): void => {
    try {
      mkdirSync(dirname(logFile), { recursive: true })
      appendFileSync(logFile, '[' + new Date().toISOString() + '] ' + msg + '\n')
    } catch { /* 静默 */ }
  }
  try {
    const providers = ctx.llm.listProviders()
    log('listProviders: ' + JSON.stringify(providers))
    const runtime = ctx.llm as unknown as {
      listConfigurableProviders?: () => unknown
      listModels?: (p: string) => Promise<unknown>
    }
    if (typeof runtime.listConfigurableProviders === 'function') {
      log('configurableProviders: ' + JSON.stringify(runtime.listConfigurableProviders()))
    }
    void (runtime.listModels?.('ollama') ?? Promise.resolve([])).then(
      (models) => log('ollama models: ' + JSON.stringify(models)),
      (e) => log('ollama models ERR: ' + String(e)),
    )
  } catch (e) {
    log('probe error: ' + String(e))
  }
}
