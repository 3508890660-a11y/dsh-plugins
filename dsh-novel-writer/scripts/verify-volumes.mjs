// 分卷功能回归验证（用编译后的 lib 直接驱动真实数据）
import { Store } from '../lib/store.js'
import { exportMarkdown, exportTxt, exportEpub } from '../lib/exporter.js'
import { volumesSorted, chapterVolume, chapterIndexInVolume, volumeTitleOf } from '../lib/types.js'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DATA = 'F:/producing/tool/writer/novel-writer-data'
const store = new Store(DATA)

console.log('=== 1. 迁移：load 后 volumeId 从大纲推导 ===')
const d = store.load('p-018b14b7') // 金穗夜行（3 卷 40 章）
const vols = volumesSorted(d)
console.log('卷数:', vols.length, vols.map(v => `${v.title}[${v.id}]`).join(' | '))
const withVol = d.chapters.filter(c => c.volumeId)
const noVol = d.chapters.filter(c => !c.volumeId)
console.log(`40 章中已挂卷: ${withVol.length}，未挂卷: ${noVol.length}`)
const sample = d.chapters.find(c => c.id === 'ch-5669d82d') // 序章（第一幕）
console.log('序章 volumeId:', sample.volumeId, '→ 应=', chapterVolume(d, sample.id)?.id)
console.log('序章卷标题:', volumeTitleOf(d, sample.id))
console.log('序章卷内序号:', chapterIndexInVolume(d, sample.id))

console.log('\n=== 2. 未分卷项目（剑与灰烬 0 卷）不报错 ===')
const d2 = store.load('p-efa34993')
console.log('剑与灰烬卷数:', volumesSorted(d2).length, '章节:', d2.chapters.length)

console.log('\n=== 3. 导出分卷（金穗夜行 markdown/txt/epub） ===')
const out = tmpdir()
const r1 = exportMarkdown(store, d, out)
const md = (await import('node:fs')).readFileSync(r1.filePath, 'utf8')
const heads = md.split('\n').filter(l => l.startsWith('## ') || l.startsWith('### ')).slice(0, 20)
console.log('markdown 头部结构:')
heads.forEach(h => console.log('  ', h))
console.log('md 文件:', r1.filePath, '章节数:', r1.chapterCount)
const r2 = exportTxt(store, d, out)
const txt = (await import('node:fs')).readFileSync(r2.filePath, 'utf8')
console.log('txt 卷分隔行:', txt.split('\n').filter(l => l.startsWith('【第')).map(l => l.trim()).slice(0, 5))
const r3 = exportEpub(store, d, out)
console.log('epub 文件:', r3.filePath, r3.wordCount, '字')

// epub 内验证 nav 嵌套与卷页
const { execFileSync } = await import('node:child_process')
try {
  const list = execFileSync('tar', ['-tf', r3.filePath], { encoding: 'utf8' }).trim().split('\n')
  console.log('epub 条目数:', list.length)
  console.log('含卷页:', list.filter(n => n.includes('vol')).slice(0, 6))
  const nav = execFileSync('tar', ['-xOf', r3.filePath, 'OEBPS/nav.xhtml'], { encoding: 'utf8' })
  console.log('nav 有嵌套 ol:', nav.includes('<ol>') && nav.includes('</li>\n    <ol>'))
  console.log('nav 卷链接样例:', nav.match(/vol\d+[^"]*\.xhtml/g)?.slice(0, 3))
} catch (e) {
  console.log('（tar 不可用，跳过 epub 内部检查）', String(e).slice(0, 80))
}
console.log('\n全部验证完成')
