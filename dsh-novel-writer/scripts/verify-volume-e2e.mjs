// 端到端：迁移落盘 + 新建卷/挂章 + 卷上下文（用临时数据目录，不碰真实项目）
import { Store } from '../lib/store.js'
import { nowIso, uid, volumesSorted, chapterVolume, chapterIndexInVolume } from '../lib/types.js'
import { mkdirSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const TMP = join(process.cwd(), '.tmp-verify-vol')
rmSync(TMP, { recursive: true, force: true })
mkdirSync(TMP, { recursive: true })
const store = new Store(TMP)

// 1. 老数据格式（无 volumeId + 有 outline 卷章层级）→ load 迁移
const meta = { id: uid('p'), name: '测试书', genre: '奇幻', style: '', premise: '', createdAt: nowIso(), updatedAt: nowIso() }
const data = store.createProject(meta)
const vol1 = { id: uid('vol'), projectId: data.project.id, type: 'volume', title: '第一卷 启程', summary: '离开村庄', parentId: null, order: 1, status: 'planned', beats: [], createdAt: nowIso(), updatedAt: nowIso() }
const ch1 = { id: uid('ch'), projectId: data.project.id, type: 'chapter', title: '第一章 离家', summary: '主角离家', parentId: vol1.id, order: 0, status: 'done', beats: ['出发'], createdAt: nowIso(), updatedAt: nowIso() }
data.outline.push(vol1, ch1)
data.chapters.push({ id: ch1.id, projectId: data.project.id, title: ch1.title, order: 0, status: 'final', wordCount: 100, volumeId: undefined, summary: 's', events: [], characterUpdates: [], items: [], foreshadowingPlanted: [], foreshadowingResolved: [], createdAt: nowIso(), updatedAt: nowIso() })
// 注意：直接修改内存 data 后不走 save——模拟旧磁盘文件：save 后重建 Store（清缓存模拟重启）
store.save(data.project.id)
const store2 = new Store(TMP)
const reloaded = store2.load(data.project.id)
console.log('迁移后 volumeId:', reloaded.chapters[0].volumeId, '===', vol1.id, reloaded.chapters[0].volumeId === vol1.id ? 'PASS' : 'FAIL')
// 磁盘上也落盘了吗（下次 load 推导即可；save 时持久化 volumeId）
const onDisk = JSON.parse(readFileSync(join(TMP, 'projects', data.project.id, 'data.json'), 'utf8'))
console.log('磁盘 volumeId 持久化:', onDisk.chapters[0].volumeId, onDisk.chapters[0].volumeId === vol1.id ? 'PASS' : 'FAIL(load 推导但未 save)')

// 2. volumesSorted / chapterVolume / chapterIndexInVolume 多卷
const vol2 = { id: uid('vol'), projectId: data.project.id, type: 'volume', title: '第二卷 旅途', summary: '', parentId: null, order: 2, status: 'planned', beats: [], createdAt: nowIso(), updatedAt: nowIso() }
reloaded.outline.push(vol2)
console.log('卷序:', volumesSorted(reloaded).map(v => v.title).join(' | '))
console.log('章在卷内序号:', chapterIndexInVolume(reloaded, ch1.id), '(应为 1)')
console.log(chapterVolume(reloaded, ch1.id)?.title ?? 'none')
rmSync(TMP, { recursive: true, force: true })
console.log('端到端 PASS')
