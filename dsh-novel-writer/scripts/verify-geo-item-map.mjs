// 物品/地理/地图联动 回归验证（真实数据只读迁移检查 + 临时项目工具执行）
import { Store } from '../lib/store.js'
import { buildTools } from '../lib/tools.js'
import { nowIso, uid } from '../lib/types.js'
import { mkdirSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// ── 1. 真实数据：金穗夜行迁移（geography→geo） ──
const REAL = 'F:/producing/tool/writer/novel-writer-data'
if (existsSync(REAL)) {
  const store = new Store(REAL)
  const d = store.load('p-018b14b7')
  const geo = d.geo ?? []
  const wv = d.worldview ?? []
  console.log('=== 1. 真实项目迁移检查（金穗夜行） ===')
  console.log('geo 条数:', geo.length, '| worldview 剩余（应无 geography）:', wv.filter(w => w.category === 'geography').length)
  console.log('geo 样例:', geo.slice(0, 3).map(g => `${g.name}[${g.type}](${g.mapX ?? ''},${g.mapY ?? ''})`).join(' | '))
  console.log('items 条数:', (d.items ?? []).length)
}

// ── 2. 临时项目：工具执行（geo_edit/list、item_edit/list、map_list 不可达） ──
const TMP = join(process.cwd(), '.tmp-verify-gi')
rmSync(TMP, { recursive: true, force: true })
mkdirSync(TMP, { recursive: true })
const store2 = new Store(TMP)
const generator = { buildSystemPrompt: () => '', buildChapterPrompt: () => '', generate: async () => '', extractMemory: async () => ({ summary: '', events: [], characterUpdates: [], items: [], foreshadowingPlanted: [], foreshadowingResolved: [] }) }
const tools = buildTools({ store: store2, generator, dataDir: TMP, mapForgeDataDir: '' })
const byName = new Map(tools.map(t => [t.name, t]))

const p = store2.createProject({ id: uid('p'), name: '测试书', genre: '奇幻', style: '', premise: '', createdAt: nowIso(), updatedAt: nowIso() })
console.log('\n=== 2. 地理工具 ===')
const g1 = await byName.get('novel_geo_edit').execute({ projectId: p.project.id, name: '北境长城', type: 'terrain', description: '横贯北方的巨大城墙', mapX: 0.2, mapY: 0.1 })
console.log('创建地理:', g1.message)
const g2 = await byName.get('novel_geo_edit').execute({ projectId: p.project.id, name: '卡莎城', type: 'city', description: '南方港口', mapX: 0.8, mapY: 0.85 })
console.log('创建城市:', g2.message)
const glist = await byName.get('novel_geo_list').execute({ projectId: p.project.id })
console.log(glist.geo)

console.log('\n=== 3. 物品工具 ===')
const i1 = await byName.get('novel_item_edit').execute({ projectId: p.project.id, name: '龙晶匕首', category: 'weapon', description: '龙牙锻造', owner: '卡伦', location: '卡莎城', status: '正常' })
console.log('创建物品:', i1.message)
const i2 = await byName.get('novel_item_edit').execute({ projectId: p.project.id, name: '旧地图', category: 'document', description: '残缺的海图', location: '北境长城' })
console.log('创建物品2:', i2.message)
const ilist = await byName.get('novel_item_list').execute({ projectId: p.project.id })
console.log(ilist.items)

console.log('\n=== 4. 地图联动（不可达路径） ===')
const ml = await byName.get('novel_map_list').execute({ projectId: p.project.id })
console.log(ml.maps)

console.log('\n=== 5. 地图联动（可达路径：临时 mapforge-data） ===')
const MAPDIR = join(TMP, 'mapforge-data')
mkdirSync(MAPDIR, { recursive: true })
writeFileSync(join(MAPDIR, 'maps.json'), JSON.stringify([
  { id: 'map_1', projectId: p.project.id, title: '世界地图', style: 'fantasy', size: '1536x1024', quality: 'medium', files: [join(MAPDIR, 'x.png')], promptFile: '', status: 'done', error: '', createdAt: nowIso() },
  { id: 'map_2', projectId: 'other-p', title: '别人的地图', style: 'pirate', size: '1', quality: 'm', files: [], promptFile: '', status: 'done', error: '', createdAt: nowIso() },
], null, 2))
const tools2 = buildTools({ store: store2, generator, dataDir: TMP, mapForgeDataDir: MAPDIR })
const byName2 = new Map(tools2.map(t => [t.name, t]))
const ml2 = await byName2.get('novel_map_list').execute({ projectId: p.project.id })
console.log(ml2.maps)

rmSync(TMP, { recursive: true, force: true })
console.log('\n全部验证完成')
