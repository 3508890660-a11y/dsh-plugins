// 临时构建辅助：link deps + tsc（一次性，用后即弃）
import { mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { resolve } from 'node:path'

const CHECKOUT = 'F:/deepseek/DSH Desktop/dsh-desktop/node_modules/@deepseek-ai'
for (const n of ['cordis', 'cosmokit', 'schemastery', 'dsh-llm']) {
  const link = resolve('node_modules/@deepseek-ai/' + n)
  rmSync(link, { recursive: true, force: true })
  mkdirSync('node_modules/@deepseek-ai', { recursive: true })
  symlinkSync(CHECKOUT + '/' + n, link, 'junction')
  console.log('linked', n)
}
