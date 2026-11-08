/**
 * dsh-llm-ollama 真实连通性验证：直调编译产物 OllamaAdapter，
 * 对本机 Ollama 发起流式生成，检查 StreamChunk 协议输出。
 * 运行：node mock-stream.mjs（须在包内，junction 解析依赖）
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { OllamaAdapter } from './lib/adapter.js'

const adapter = new OllamaAdapter({
  baseUrl: 'http://127.0.0.1:11434',
  apiKey: '',
  contextWindow: 32768,
  maxTokens: 2048,
})

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`)
}

// 1. listModels
const models = await adapter.listModels('ollama')
const modelNames = models.map((m) => m.id)
check('listModels', modelNames.includes('qwen3:4b'), `models=[${modelNames.join(', ')}]`)

// 2. resolveModel
const resolved = await adapter.resolveModel('ollama', 'qwen3:4b')
check('resolveModel', resolved.id === 'qwen3:4b' && resolved.context.contextWindow === 32768,
  `context=${resolved.context.contextWindow}`)

// 3. 流式生成（qwen3:4b，中文短句，开思考）
const text = []
const reasoning = []
let finishKind = 'none'
let usageSeen = false
let blocks = 0
const chunks = []
try {
  const stream = adapter.stream({
    provider: 'ollama',
    model: 'qwen3:4b',
    system: '你是测试助手。用一句话回答。',
    messages: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '请用中文写一句关于秋天的短句。' }] })],
    temperature: 0.7,
    maxTokens: 2048,
  })
  for await (const chunk of stream) {
    chunks.push(chunk.type)
    switch (chunk.type) {
      case 'block-start': blocks += 1; break
      case 'text-delta': text.push(chunk.text); break
      case 'reasoning-delta': reasoning.push(chunk.text); break
      case 'usage': usageSeen = true; break
      case 'finish': finishKind = chunk.reason.kind; break
      default: break
    }
  }
} catch (e) {
  check('stream-throw', false, String(e))
}

const fullText = text.join('')
const fullReasoning = reasoning.join('')
check('stream-has-text', fullText.trim().length > 0, `len=${fullText.length} reasoningLen=${fullReasoning.length}`)
check('stream-finish', finishKind === 'stop', `finish=${finishKind}`)
check('stream-usage', usageSeen)
check('stream-order', chunks[0] === 'block-start' && chunks[chunks.length - 1] === 'finish', `first=${chunks[0]} last=${chunks[chunks.length - 1]}`)
check('stream-no-finish-then-chunks', chunks.indexOf('finish') === chunks.length - 1)

console.log('\n--- 生成内容 ---')
if (fullReasoning) console.log('【思考】' + fullReasoning.slice(0, 300))
console.log('【回答】' + fullText)

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} PASS`)
process.exit(failed.length > 0 ? 1 : 0)
