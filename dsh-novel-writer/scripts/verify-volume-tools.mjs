// 验证 novel_volume_list / novel_volume_assign 真实 execute（临时数据目录）
import { Store } from '../lib/store.js'
import { buildTools } from '../lib/tools.js'
import { nowIso, uid } from '../lib/types.js'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const TMP = join(process.cwd(), '.tmp-verify-tools')
rmSync(TMP, { recursive: true, force: true })
mkdirSync(TMP, { recursive: true })
const store = new Store(TMP)
// mock generator：vol 工具不调用它
const generator = { buildSystemPrompt: () => '', buildChapterPrompt: () => '', generate: async () => '', extractMemory: async () => ({ summary: '', events: [], characterUpdates: [], items: [], foreshadowingPlanted: [], foreshadowingResolved: [] }) }
const tools = buildTools({ store, generator, dataDir: TMP })
const byName = new Map(tools.map(t => [t.name, t]))

const data = store.createProject({ id: uid('p'), name: '分卷测试', genre: '', style: '', premise: '', createdAt: nowIso(), updatedAt: nowIso() })
// 建 2 卷 + 2 章（一挂卷一未挂）
const v1 = { id: uid('vol'), projectId: data.project.id, type: 'volume', title: '第一卷', summary: '开篇', parentId: null, order: 1, status: 'planned', beats: [], createdAt: nowIso(), updatedAt: nowIso() }
const v2 = { id: uid('vol'), projectId: data.project.id, type: 'volume', title: '第二卷', summary: '', parentId: null, order: 2, status: 'planned', beats: [], createdAt: nowIso(), updatedAt: nowIso() }
const c1 = { id: uid('ch'), projectId: data.project.id, type: 'chapter', title: '第一章', summary: '', parentId: v1.id, order: 1, status: 'planned', beats: ['a'], createdAt: nowIso(), updatedAt: nowIso() }
const c2 = { id: uid('ch'), projectId: data.project.id, type: 'chapter', title: '第二章', summary: '', parentId: null, order: 2, status: 'done', beats: ['b'], createdAt: nowIso(), updatedAt: nowIso() }
data.outline.push(v1, v2, c1, c2)
data.chapters.push({ id: c2.id, projectId: data.project.id, title: c2.title, order: 2, status: 'final', wordCount: 500, volumeId: null, summary: 's', events: [], characterUpdates: [], items: [], foreshadowingPlanted: [], foreshadowingResolved: [], createdAt: nowIso(), updatedAt: nowIso() })
store.save(data.project.id)

// 1. volume_list
const list = await byName.get('novel_volume_list').execute({ projectId: data.project.id })
console.log('--- novel_volume_list ---')
console.log(list.volumes)
console.log('count:', list.count)

// 2. volume_assign：把 c2 划入 v2
const r1 = await byName.get('novel_volume_assign').execute({ projectId: data.project.id, chapterId: c2.id, volumeId: v2.id })
console.log('--- assign c2→v2 ---')
console.log(r1.message)
const d = store.load(data.project.id)
console.log('outline parentId:', d.outline.find(n => n.id === c2.id)?.parentId === v2.id ? 'PASS' : 'FAIL')
console.log('record volumeId:', d.chapters[0].volumeId === v2.id ? 'PASS' : 'FAIL')

// 3. 移出卷
const r2 = await byName.get('novel_volume_assign').execute({ projectId: data.project.id, chapterId: c2.id, volumeId: 'none' })
console.log('--- assign c2 none ---')
console.log(r2.message)
const d2 = store.load(data.project.id)
console.log('record volumeId 移出:', d2.chapters[0].volumeId === null ? 'PASS' : 'FAIL')

// 4. 错误路径：挂到不存在卷
try {
  await byName.get('novel_volume_assign').execute({ projectId: data.project.id, chapterId: c2.id, volumeId: 'vol-404' })
  console.log('错误路径 FAIL（未抛错）')
} catch (e) {
  console.log('错误路径 PASS:', String(e.message).slice(0, 50))
}

rmSync(TMP, { recursive: true, force: true })
console.log('工具验证完成')
