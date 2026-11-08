/**
 * @dsh-external/dsh-ollama-probe — Ollama 适配器集成自检。
 * apply 时异步执行：listProviders → stream 真实调用，结果写入日志文件。
 * 注入即验证；不注册任何工具/路由。
 */
import type { Context } from '@deepseek-ai/cordis'
import type LlmService from '@deepseek-ai/dsh-llm'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

type AppContext = Context & {
  llm: LlmService
}

export const name = '@dsh-external/dsh-ollama-probe'
export const inject = ['llm']

export const Config = null as never

const LOG = process.env.OLLAMA_PROBE_LOG
  || join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'super-injector', 'ollama-probe.log')

function log(msg: string): void {
  try {
    mkdirSync(join(LOG, '..'), { recursive: true })
    appendFileSync(LOG, `[${new Date().toISOString()}] ${msg}\n`)
  } catch { /* 静默 */ }
}

export function apply(ctx: AppContext): void {
  void (async () => {
    try {
      const providers = ctx.llm.listProviders().map((p) => p.id)
      log(`providers=[${providers.join(', ')}]`)
      if (!providers.includes('ollama')) {
        log('FAIL: provider "ollama" 未注册')
        return
      }
      const models = await ctx.llm.listModels('ollama')
      log(`ollama models=[${models.map((m) => m.id).join(', ')}]`)
      let text = ''
      let finish = 'none'
      const stream = ctx.llm.stream({
        provider: 'ollama',
        model: 'qwen3:4b',
        system: '你是测试助手。',
        messages: [
          createUserMessage({
            source: { kind: 'user' },
            content: [{ type: 'text', text: '用一句中文回答：本地模型已接通，请确认。' }],
          }),
        ],
        temperature: 0.5,
        maxTokens: 2048,
      })
      for await (const chunk of stream) {
        if (chunk.type === 'text-delta') text += chunk.text
        if (chunk.type === 'finish') finish = chunk.reason.kind
      }
      log(`stream finish=${finish} text=${JSON.stringify(text.slice(0, 120))}`)
      log(finish === 'stop' && text.trim().length > 0 ? 'PROBE PASS' : 'PROBE FAIL')
    } catch (e) {
      log('PROBE ERROR: ' + String(e).slice(0, 500))
    }
  })()
  ctx.logger?.info?.('[dsh-ollama-probe] 自检已启动（结果见 ' + LOG + '）')
}
