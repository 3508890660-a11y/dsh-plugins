/**
 * novel_* 工具集：项目管理 / 大纲 / 人物 / 世界观 / 伏笔 / 章节生成 / 记忆 / 导出。
 * 全部经 ctx.tools.register(defineTool(...)) 注册，AI 助手直接交互式创作。
 * ⚠️ defineTool 的 output.schema 走 value schema DSL：顶层不能有 required 数组，
 *    必填性在每个属性上标 required: true。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { Store } from './store.js'
import type { Generator, MemoryExtraction, SettingsParsed } from './generator.js'
import type {
  Character, CharacterRole, ChapterRecord, Foreshadowing, ItemCategory, ItemRecord,
  GeoEntry, GeoType, OutlineNode, ProjectData, WorldviewCategory, StyleCardBinding,
} from './types.js'
import { nowIso, uid, WORLDVIEW_CATEGORY_LABELS, CHARACTER_ROLE_LABELS, chapterVolume, chapterIndexInVolume, volumesSorted, volumeTitleOf, GEO_TYPES, GEO_TYPE_LABELS, ITEM_CATEGORIES, ITEM_CATEGORY_LABELS, geoGrouped, geoCoordLabel } from './types.js'
import { exportEpub, exportMarkdown, exportTxt } from './exporter.js'
import { buildAnalysisTools } from './analysis-tools.js'
import { buildPortTools } from './port-tools.js'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, resolve, extname } from 'node:path'
import { StyleKb } from './style-kb.js'

export interface ToolDeps {
  store: Store
  generator: Generator
  dataDir: string
  /** 地图插件（dsh-map-forge）记录索引目录（maps.json 所在；空=不可达，novel_map_list 返回提示） */
  mapForgeDataDir: string
  /** 文风知识库根目录（含 cards/ 子目录；空=不可达，novel_style_kb 返回提示） */
  styleKbDir: string
}

/** 上下文组装：取最近已写章节、未解伏笔。
 * 注意：章节 order 是卷内序号（多卷项目）→ 阅读顺序按 卷序→卷内序。 */
function readingRank(data: ProjectData, recordId: string): number {
  const node = data.outline.find(n => n.id === recordId && n.type === 'chapter')
  if (node) {
    const rel = chapterVolume(data, node.id)
    if (rel) {
      const vi = volumesSorted(data).findIndex(v => v.id === rel.id)
      return vi * 100000 + node.order
    }
  }
  // 未挂卷：按记录 order 排在最后（以防有同名卷内序冲突，+1000000 兜底）
  return 1000000 + (data.chapters.find(c => c.id === recordId)?.order ?? 0)
}

/** 全书第几章（阅读顺序，1 起；用于人物备注等全局序号） */
function globalChapterNumber(data: ProjectData, recordId: string): number {
  const sorted = data.chapters.slice().sort((a, b) => readingRank(data, a.id) - readingRank(data, b.id))
  return sorted.findIndex(c => c.id === recordId) + 1
}

function chapterContext(data: ProjectData, count = 3, anchorChapterId?: string): { recent: ChapterRecord[]; prev: ChapterRecord | null } {
  const written = data.chapters.slice().sort((a, b) => readingRank(data, a.id) - readingRank(data, b.id))
  // 入参为待写章节时：只取它在阅读顺序之前的章节（多卷项目避免"前情提要"包含它自身/后续章节）
  const anchor = anchorChapterId
    ? written.findIndex(c => c.id === anchorChapterId)
    : written.length - 1
  const before = anchor >= 0 ? written.slice(0, anchor) : written
  return { recent: before.slice(-count), prev: before.length > 0 ? before[before.length - 1] : null }
}

function openForeshadowings(data: ProjectData): Foreshadowing[] {
  return data.foreshadowings.filter(f => f.status === 'open')
}

function findChapterNode(data: ProjectData, chapterId: string): OutlineNode {
  const node = data.outline.find(n => n.id === chapterId && n.type === 'chapter')
  if (!node) throw new Error(`章节不存在（需要大纲中 type=chapter 的节点 id）: ${chapterId}`)
  return node
}

/** 已写章节记录（无则建） */
function ensureChapterRecord(data: ProjectData, node: OutlineNode): ChapterRecord {
  let rec = data.chapters.find(c => c.id === node.id)
  if (!rec) {
    rec = {
      id: node.id, projectId: data.project.id, title: node.title, order: node.order,
      status: 'draft', wordCount: 0, volumeId: chapterVolume(data, node.id)?.id ?? null,
      summary: '', events: [], characterUpdates: [],
      items: [], foreshadowingPlanted: [], foreshadowingResolved: [],
      createdAt: nowIso(), updatedAt: nowIso(),
    }
    data.chapters.push(rec)
  } else {
    // 卷归属以大纲为准：正文记录与大纲节点保持同步
    const vid = chapterVolume(data, node.id)?.id ?? null
    if (rec.volumeId !== vid) rec.volumeId = vid
    if (rec.title !== node.title) rec.title = node.title
    if (rec.order !== node.order) rec.order = node.order
  }
  return rec
}

/** 应用记忆提取结果到项目数据 */
function applyMemory(data: ProjectData, node: OutlineNode, content: string, mem: MemoryExtraction): number {
  const rec = ensureChapterRecord(data, node)
  rec.status = 'final'
  rec.summary = mem.summary
  rec.events = mem.events
  rec.items = mem.items
  rec.characterUpdates = mem.characterUpdates
  rec.wordCount = content.replace(/\s/g, '').length
  rec.updatedAt = nowIso()
  node.status = 'done'

  // 人物状态更新（按名字/别名匹配，notes 前插最新）；章号用全书全局序号（多卷项目 order 是卷内序）
  const gNum = globalChapterNumber(data, node.id)
  for (const cu of mem.characterUpdates) {
    const ch = data.characters.find(c => c.name === cu.name || c.aliases.includes(cu.name))
    if (ch) {
      const note = `[第${gNum}章] ${cu.change}`
      // 去重：续写/重写同一章会重复提取记忆，避免 notes 累积相同条目
      if (!ch.currentState.notes.includes(note)) {
        ch.currentState.notes = ch.currentState.notes ? note + '；' + ch.currentState.notes : note
      }
      ch.updatedAt = nowIso()
    }
  }

  // 物品自动登记：章节记忆中出现的重要物品 → 独立物品库（同名幂等，保留既有档案）
  if (!Array.isArray(data.items)) data.items = []
  for (const name of mem.items) {
    const existing = data.items.find(it => it.name === name || it.aliases.includes(name))
    if (existing) continue
    const it: ItemRecord = {
      id: uid('it'), projectId: data.project.id, name, aliases: [], category: 'other',
      description: `（首次出现于第${gNum}章，待完善）`, owner: '', location: '', status: '正常',
      createdAt: nowIso(), updatedAt: nowIso(),
    }
    data.items.push(it)
  }

  // 新伏笔
  const plantedIds: string[] = []
  for (const desc of mem.foreshadowingPlanted) {
    const f: Foreshadowing = {
      id: uid('f'), projectId: data.project.id, description: desc,
      plantedChapterId: node.id, resolvedChapterId: null, status: 'open',
      notes: '', createdAt: nowIso(), updatedAt: nowIso(),
    }
    data.foreshadowings.push(f)
    plantedIds.push(f.id)
  }
  rec.foreshadowingPlanted = plantedIds

  // 伏笔回收（按 id）
  const resolvedIds: string[] = []
  for (const fid of mem.foreshadowingResolved) {
    const f = data.foreshadowings.find(x => x.id === fid && x.status === 'open')
    if (f) {
      f.status = 'resolved'
      f.resolvedChapterId = node.id
      f.updatedAt = nowIso()
      resolvedIds.push(f.id)
    }
  }
  rec.foreshadowingResolved = resolvedIds
  return plantedIds.length
}

/** 记忆概览（工具返回用，精简） */
function memoryBrief(rec: ChapterRecord, planted: number, resolved: number): string {
  const parts = [`摘要: ${rec.summary.slice(0, 120)}`]
  if (rec.events.length > 0) parts.push(`事件(${rec.events.length}): ` + rec.events.slice(0, 3).join('；').slice(0, 150))
  if (rec.characterUpdates.length > 0) parts.push('人物变化: ' + rec.characterUpdates.map(c => `${c.name}-${c.change.slice(0, 30)}`).join('；').slice(0, 200))
  if (planted > 0) parts.push(`新伏笔 ${planted} 个`)
  if (resolved > 0) parts.push(`回收伏笔 ${resolved} 个`)
  return parts.join('\n')
}

const text = (t: string) => [{ type: 'text' as const, text: t }]

// ═══════════════════════ 设定文件导入辅助 ═══════════════════════

/** 读取设定文件（单文件或目录递归，返回 utf-8 内容列表） */
function readSettingFileList(target: string, encoding: string): { path: string; name: string; content: string }[] {
  const abs = resolve(target)
  if (!existsSync(abs)) throw new Error(`文件/目录不存在: ${abs}`)
  const MAX = 400 * 1024
  const readOne = (full: string, name: string): { path: string; name: string; content: string } => {
    let content: string
    try {
      content = readFileSync(full, encoding as BufferEncoding)
    } catch {
      throw new Error(`读取失败（Windows 老文件可能是 GBK 编码，请加 encoding='gbk'）：${full}`)
    }
    if (content.length > MAX) content = content.slice(0, MAX) + '\n…（文件过大已截断）'
    return { path: full, name, content }
  }
  const stat = statSync(abs)
  if (stat.isFile()) return [readOne(abs, abs.split(/[\\/]/).pop() ?? abs)]
  if (!stat.isDirectory()) throw new Error(`不是文件也不是目录: ${abs}`)
  const files: { path: string; name: string; content: string }[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) { walk(full); continue }
      if (['.md', '.txt', '.json', '.yaml', '.yml'].includes(extname(entry.name).toLowerCase())) {
        files.push(readOne(full, entry.name))
      }
    }
  }
  walk(abs)
  if (files.length === 0) throw new Error(`目录中未找到 .md/.txt/.json/.yaml 设定文件: ${abs}`)
  return files
}

interface ImportCounts {
  worldview: number
  characters: number
  outline: number
  foreshadowings: number
}

/** 把 AI 解析结果写入项目数据（同标题/名字/描述跳过，幂等）；skipped 记录被跳过的条目 */
function importSettingsInto(data: ProjectData, parsed: SettingsParsed, skipped: string[]): ImportCounts {
  const counts: ImportCounts = { worldview: 0, characters: 0, outline: 0, foreshadowings: 0 }
  const now = nowIso()
  for (const w of parsed.worldview) {
    if (data.worldview.some(e => e.category === w.category && e.title === w.title)) { skipped.push(`世界观:${w.title}`); continue }
    data.worldview.push({ id: uid('w'), projectId: data.project.id, category: w.category, title: w.title, content: w.content, createdAt: now, updatedAt: now })
    counts.worldview++
  }
  for (const c of parsed.characters) {
    if (data.characters.some(x => x.name === c.name)) { skipped.push(`人物:${c.name}`); continue }
    data.characters.push({
      id: uid('c'), projectId: data.project.id, name: c.name, aliases: c.aliases, role: c.role,
      appearance: c.appearance, personality: c.personality, background: c.background, goal: c.goal,
      personalityProfile: '', relationships: [], arc: [],
      currentState: { location: '', condition: '', possessions: c.possessions, notes: '' },
      createdAt: now, updatedAt: now,
    })
    counts.characters++
  }
  // 人物关系二次解析：解析结果按名字引用 → 映射为 targetId
  for (const c of parsed.characters) {
    const ch = data.characters.find(x => x.name === c.name)
    if (!ch || c.relationships.length === 0) continue
    const rels = c.relationships
      .map(r => {
        const t = data.characters.find(x => x.name === r.name)
        return t ? { targetId: t.id, description: r.description } : null
      })
      .filter((r): r is { targetId: string; description: string } => r !== null)
    if (rels.length > 0) ch.relationships = rels
  }
  const topOrders = data.outline.filter(n => !n.parentId).map(n => n.order)
  let nextOrder = topOrders.length > 0 ? Math.max(...topOrders) + 1 : 1
  // 大纲层级修复：AI 解析出的 outline 是无 parentId 的平铺序列（type=volume/chapter），
  // 按序导入时把 chapter 挂到最近一个 volume 下（尚未新建卷且已有卷节点时也复用），否则留在顶层。
  let lastVolumeId: string | null = null
  for (const o of parsed.outline) {
    if (data.outline.some(n => n.title === o.title)) { skipped.push(`大纲:${o.title}`); continue }
    if (o.type === 'volume') lastVolumeId = null
    const node: OutlineNode = {
      id: uid(o.type === 'volume' ? 'v' : 'ch'), projectId: data.project.id, type: o.type,
      title: o.title, summary: o.summary,
      parentId: o.type === 'chapter' ? lastVolumeId : null,
      order: nextOrder++,
      status: 'planned', beats: o.type === 'chapter' ? o.beats : [],
      createdAt: now, updatedAt: now,
    }
    data.outline.push(node)
    if (o.type === 'volume') lastVolumeId = node.id
    counts.outline++
  }
  for (const f of parsed.foreshadowings) {
    if (data.foreshadowings.some(x => x.description === f.description)) { skipped.push(`伏笔:${f.description.slice(0, 30)}`); continue }
    data.foreshadowings.push({
      id: uid('f'), projectId: data.project.id, description: f.description,
      plantedChapterId: null, resolvedChapterId: null, status: 'open',
      notes: f.notes, createdAt: now, updatedAt: now,
    })
    counts.foreshadowings++
  }
  return counts
}

const sumCounts = (a: ImportCounts, b: ImportCounts): ImportCounts => ({
  worldview: a.worldview + b.worldview,
  characters: a.characters + b.characters,
  outline: a.outline + b.outline,
  foreshadowings: a.foreshadowings + b.foreshadowings,
})

export interface ImportArgs {
  projectId: string
  filePath: string
  mode?: string
  dryRun?: boolean
  encoding?: string
}

export interface PolishArgs {
  projectId: string
  chapterId: string
  mode?: 'light' | 'deep'
  focus?: string
  save?: boolean
}

export interface PolishDamage {
  ok: boolean
  issues: string[]
  ratio: number
}

/**
 * 润色稿完整性检测——novel-polish 等本地小模型重写长文时可能截断/段落重复/杂讯/顺序颠倒。
 * 已验证的检测方法：字符数比（<0.5 截断 / >2.5 膨胀）+ 长段重复 + 替换符 + 字符堆叠。
 * 顺序颠倒难以可靠自动检测 → 未通过检测时返回全文预览，由用户确认后再落盘。
 */
export function detectPolishDamage(original: string, polished: string): PolishDamage {
  const issues: string[] = []
  const oLen = original.replace(/\s/g, '').length
  const pLen = polished.replace(/\s/g, '').length
  const ratio = oLen > 0 ? pLen / oLen : 0
  if (ratio < 0.5) {
    issues.push(`输出过短（${pLen} 字 / 原文 ${oLen} 字，比 ${ratio.toFixed(2)}），疑似截断`)
  } else if (ratio > 2.5) {
    issues.push(`输出过长（${pLen} 字 / 原文 ${oLen} 字，比 ${ratio.toFixed(2)}），疑似膨胀/重复`)
  }
  // 长段重复：相邻整行完全相同（≥20 字）
  const lines = polished.split('\n').map(l => l.trim()).filter(Boolean)
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === lines[i - 1] && lines[i].length >= 20) {
      issues.push(`段落重复：第 ${i + 1} 行与上一行完全相同（「${lines[i].slice(0, 24)}…」）`)
      break
    }
  }
  // 内容重复：40 字窗口子串出现 ≥2 次（防换行错位导致的重复）
  if (!issues.some(x => x.includes('段落重复')) && !issues.some(x => x.includes('输出过长'))) {
    const norm = polished.replace(/\s/g, '')
    const seen = new Set<string>()
    for (let i = 0; i + 40 <= norm.length; i++) {
      const sub = norm.slice(i, i + 40)
      if (seen.has(sub)) {
        issues.push(`内容重复：40 字片段「${sub.slice(0, 20)}…」出现 ≥2 次`)
        break
      }
      seen.add(sub)
    }
  }
  if (polished.includes('\uFFFD')) issues.push('输出含替换符 \uFFFD（编码杂讯）')
  const stack = polished.match(/(.)\1{7,}/g)
  if (stack) issues.push(`字符堆叠：${stack[0].slice(0, 8)}…（同一字符连串 ≥8 次）`)
  // 编辑元话语/无关内容：原文没有的行，却以「纠错：」「注：」「说明：」等开头，或含对用户的回应式措辞
  const origLines = new Set(original.split('\n').map(l => l.trim()).filter(Boolean))
  for (const line of polished.split('\n')) {
    const t = line.trim()
    if (!t || t.length < 6 || origLines.has(t)) continue
    if (/^(纠错|注|说明|提示|备注|综上所述|以上)[：:]/.test(t)
      || /(请提供|需要你|请您|可以帮|建议修改|原文内容)/.test(t)) {
      issues.push(`疑似编辑元话语/无关内容：${t.slice(0, 40)}…`)
      break
    }
  }
  return { ok: issues.length === 0, issues, ratio }
}

/** AI 润色主流程（工具 execute 与 HTTP API 共用）：读原文 -> LLM 润色 -> 完整性自检 -> 预览或落盘（原文备份） */
export async function runPolish(store: Store, generator: Generator, a: PolishArgs): Promise<Record<string, unknown>> {
  const data = store.load(a.projectId)
  const node = findChapterNode(data, a.chapterId)
  const content = store.readChapterContent(a.projectId, a.chapterId)
  if (!content) throw new Error('该章节还没有正文，请先用 novel_chapter_write 生成')
  const mode = a.mode ?? 'deep'
  const polished = await generator.polishChapter(data, node, content, { mode, focus: a.focus })
  if (!polished) throw new Error('LLM 返回空内容')
  const damage = detectPolishDamage(content, polished)
  if (a.save === false) {
    return { chapterId: node.id, title: node.title, save: false, polished, damage }
  }
  // save=true：先过完整性自检，未通过则不落盘，返回全文预览让用户确认
  if (!damage.ok) {
    return {
      chapterId: node.id, title: node.title, save: false, polished, damage,
      blocked: '完整性检测未通过，未落盘：' + damage.issues.join('；'),
    }
  }
  // 落盘：先备份原文，再覆盖正文 + 更新字数
  const backupPath = store.writeChapterBackup(a.projectId, node.id, content)
  store.writeChapterContent(a.projectId, node.id, polished)
  const rec = ensureChapterRecord(data, node)
  rec.wordCount = polished.replace(/\s/g, '').length
  rec.updatedAt = nowIso()
  store.save(a.projectId)
  return {
    chapterId: node.id, title: node.title, save: true,
    wordCount: rec.wordCount, backupPath,
    preview: polished.slice(0, 300),
  }
}

export interface ImportResult {
  files: string
  imported: string
  skipped: string
  preview: string
}

/** 路径列表解析：支持换行 / 分号 / 逗号分隔的多路径 */
function splitPaths(input: string): string[] {
  return input.split(/[\n;，,]+/).map(s => s.trim()).filter(Boolean)
}

/** 设定导入主流程（工具 execute 与 HTTP API 共用）：读文件 -> AI 解析 -> 幂等写入 */
export async function runImport(store: Store, generator: Generator, a: ImportArgs): Promise<ImportResult> {
  const data = store.load(a.projectId)
  const mode = a.mode ?? 'auto'
  const dryRun = a.dryRun === true
  const encoding = a.encoding ?? 'utf-8'
  const rawPaths = splitPaths(a.filePath)
  if (rawPaths.length === 0) throw new Error('filePath 为空：请提供文件/目录路径，多个路径用换行或分号分隔')
  // 收集全部文件（多路径支持：每个可为文件或目录；坏路径计入 errors 不中断；绝对路径去重）
  const files: { path: string; name: string; content: string }[] = []
  const seen = new Set<string>()
  const errors: string[] = []
  for (const p of rawPaths) {
    try {
      for (const f of readSettingFileList(p, encoding)) {
        const key = resolve(f.path)
        if (seen.has(key)) continue
        seen.add(key)
        files.push(f)
      }
    } catch (e) {
      errors.push(`${p}：${String(e).slice(0, 120)}`)
    }
  }
  if (files.length === 0) throw new Error('未找到任何可导入的设定文件' + (errors.length > 0 ? `（${errors[0]}）` : ''))
  const skipped: string[] = []
  const totals: ImportCounts = { worldview: 0, characters: 0, outline: 0, foreshadowings: 0 }
  const fileLines: string[] = []
  for (const f of files) {
    // dryRun 用深拷贝计算，避免污染内存态（否则后续真实导入会误判"已存在"）
    const target = dryRun ? JSON.parse(JSON.stringify(data)) as ProjectData : data
    // 超长文本（> importLongThreshold 字符）启用分块解析：每块一次 LLM 调用，
    // 默认走云端大模型（deepseek-official），块间注入已提取清单防重复，最后合并
    const longThreshold = generator.importLongThreshold ?? 20000
    const long = f.content.length > longThreshold && typeof (generator as Generator).parseSettingsFileLong === 'function'
    let parsed: SettingsParsed
    let chunkNote = ''
    if (long) {
      const r = await (generator as Generator).parseSettingsFileLong(target, f.name, f.content, mode)
      parsed = r.parsed
      chunkNote = `（分块 ${r.chunks} 段${r.usedCloud ? '·云端大模型' : ''}${r.truncated ? '·超 20 块截断' : ''}）`
    } else {
      parsed = await generator.parseSettingsFile(target, f.name, f.content, mode)
    }
    const counts = importSettingsInto(target, parsed, skipped)
    totals.worldview += counts.worldview
    totals.characters += counts.characters
    totals.outline += counts.outline
    totals.foreshadowings += counts.foreshadowings
    fileLines.push(`◆ ${f.name}${chunkNote}：世界观+${counts.worldview} 人物+${counts.characters} 大纲+${counts.outline} 伏笔+${counts.foreshadowings}`)
  }
  if (!dryRun) store.save(a.projectId)
  const verb = dryRun ? '将导入' : '已导入'
  const importedText = `世界观 ${totals.worldview} / 人物 ${totals.characters} / 大纲 ${totals.outline} / 伏笔 ${totals.foreshadowings}`
  const skippedText = skipped.length > 0 ? `跳过（已存在）${skipped.length} 项：` + skipped.slice(0, 15).join('、') + (skipped.length > 15 ? `…` : '') : '（无重复）'
  const errorText = errors.length > 0 ? `⚠ 无法读取 ${errors.length} 个路径：` + errors.slice(0, 5).join('；') + (errors.length > 5 ? `…` : '') : ''
  const preview = [
    `设定文件 ${files.length} 个：`,
    ...fileLines,
    '',
    `${verb}合计：${importedText}`,
    skippedText,
    errorText,
    dryRun ? '[预览模式] 未写入项目。确认无误后去掉 dryRun 重新执行。' : '',
  ].filter(Boolean).join('\n')
  return { files: `文件 ${files.length} 个`, imported: importedText, skipped: skippedText, preview }
}

// ═══════════════════════ 工具定义 ═══════════════════════

export function buildTools(deps: ToolDeps): ToolDefinition[] {
  const { store, generator, dataDir } = deps
  const styleKb = new StyleKb(deps.styleKbDir)
  const tools: ToolDefinition[] = []

  /** 通过章节/人物/条目 id 反查项目（遍历项目） */
  const findProjectBy = (id: string, kind: 'chapter' | 'character' | 'entry' | 'foreshadowing' | 'geo' | 'item'): string => {
    for (const p of store.listProjects()) {
      const data = store.load(p.id)
      if (kind === 'chapter' && data.outline.some(n => n.id === id)) return p.id
      if (kind === 'character' && data.characters.some(c => c.id === id)) return p.id
      if (kind === 'entry' && data.worldview.some(w => w.id === id)) return p.id
      if (kind === 'foreshadowing' && data.foreshadowings.some(f => f.id === id)) return p.id
      if (kind === 'geo' && (data.geo ?? []).some(g => g.id === id)) return p.id
      if (kind === 'item' && (data.items ?? []).some(x => x.id === id)) return p.id
    }
    throw new Error(`找不到包含 ${kind} ${id} 的项目`)
  }

  // ── 项目 ──
  tools.push(defineTool({
    name: 'novel_project_create',
    description: '创建长篇小说项目。返回项目 id（后续所有操作的 projectId）。',
    parameters: {
      name: { type: 'string', required: true, description: '书名' },
      genre: { type: 'string', description: '题材，如：奇幻/科幻/都市/日轻' },
      style: { type: 'string', description: '文风要求，如：轻快诙谐的日轻风、克制的严肃文学风' },
      premise: { type: 'string', description: '一句话核心设定/梗概' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          name: { type: 'string', required: true },
          message: { type: 'string', required: true },
        },
      },
      render: (_a, v) => text(`项目已创建: 《${(v as { name: string }).name}》(id=${(v as { id: string }).id})`),
    },
    async execute(args) {
      const a = args as { name: string; genre?: string; style?: string; premise?: string }
      const data = store.createProject({
        id: uid('p'), name: a.name.trim(), genre: a.genre ?? '', style: a.style ?? '',
        premise: a.premise ?? '', styleCards: [], createdAt: nowIso(), updatedAt: nowIso(),
      })
      return { id: data.project.id, name: data.project.name, message: '下一步：用 novel_outline_edit 建大纲、novel_character_edit 建人物、novel_worldview_edit 建世界观，然后 novel_chapter_write 生成章节。' }
    },
  }))

  tools.push(defineTool({
    name: 'novel_project_list',
    description: '列出全部小说项目（id/书名/进度概况）。',
    parameters: {},
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          projects: { type: 'array', required: true, items: { type: 'json' } },
          count: { type: 'integer', required: true },
        },
      },
      render: (_a, v) => text(`共 ${(v as { count: number }).count} 个项目`),
    },
    async execute() {
      const projects = store.listProjects().map(p => {
        const d = store.load(p.id)
        return { id: p.id, name: p.name, genre: p.genre, chaptersWritten: d.chapters.length, characters: d.characters.length, updatedAt: p.updatedAt }
      })
      return { projects, count: projects.length }
    },
  }))

  // ── 大纲 ──
  tools.push(defineTool({
    name: 'novel_outline_edit',
    description: '创建或更新大纲节点（卷 volume / 章 chapter / 情节拍 beat）。不传 nodeId=新建；传 nodeId=更新（只改传入字段）。章节节点需要 summary（本章目标）与 beats（情节拍序列），供 novel_chapter_write 使用。',
    parameters: {
      projectId: { type: 'string', required: true, description: '项目 id' },
      type: { type: 'string', enum: ['volume', 'chapter', 'beat'], description: '节点类型' },
      title: { type: 'string', description: '标题（新建必填）' },
      summary: { type: 'string', description: '目标/概要：章节要发生什么' },
      parentId: { type: 'string', description: '父节点 id（卷/章），顶层为空' },
      order: { type: 'integer', description: '排序号（章的 order 即第几章）' },
      beats: { type: 'array', items: { type: 'string' }, description: '章节情节拍：本章按顺序发生的情节点列表' },
      status: { type: 'string', enum: ['planned', 'writing', 'done'], description: '状态' },
      nodeId: { type: 'string', description: '要更新的节点 id（不传=新建）' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          title: { type: 'string', required: true },
          type: { type: 'string', required: true },
          order: { type: 'integer', required: true },
          message: { type: 'string', required: true },
        },
      },
      render: (_a, v) => text(`大纲节点: ${(v as { title: string }).title} [${(v as { type: string }).type}#order=${(v as { order: number }).order}]`),
    },
    async execute(args) {
      const a = args as Record<string, unknown> as {
        projectId: string; type?: 'volume' | 'chapter' | 'beat'; title?: string; summary?: string
        parentId?: string; order?: number; beats?: string[]; status?: 'planned' | 'writing' | 'done'; nodeId?: string
      }
      const data = store.load(a.projectId)
      if (a.nodeId) {
        const node = data.outline.find(n => n.id === a.nodeId)
        if (!node) throw new Error(`大纲节点不存在: ${a.nodeId}`)
        if (a.title !== undefined) node.title = a.title
        if (a.summary !== undefined) node.summary = a.summary
        if (a.parentId !== undefined) {
          // 防环：不能把卷挂到自己的章下
          if (a.parentId && node.type === 'volume' && data.outline.some(n => n.id === a.parentId && n.type === 'chapter')) {
            throw new Error('parentId 必须指向 volume 节点（卷的父节点只能为空）')
          }
          node.parentId = a.parentId
          // 同步正文记录卷归属（大纲为唯一事实来源）
          if (node.type === 'chapter') {
            const rec = data.chapters.find(c => c.id === node.id)
            if (rec) rec.volumeId = chapterVolume(data, node.id)?.id ?? null
          }
        }
        if (a.order !== undefined) node.order = a.order
        if (a.beats !== undefined) node.beats = a.beats
        if (a.status !== undefined) node.status = a.status
        node.updatedAt = nowIso()
        store.save(a.projectId)
        const vol = node.type === 'chapter' ? chapterVolume(data, node.id) : null
        return {
          id: node.id, title: node.title, type: node.type, order: node.order,
          message: '已更新' + (vol ? `（归入第${volumesSorted(data).findIndex(v => v.id === vol.id) + 1}卷《${vol.title}》）` : ''),
        }
      }
      const type = a.type ?? 'chapter'
      const siblings = data.outline.filter(n => (n.parentId ?? null) === (a.parentId ?? null) && n.type === type)
      const order = a.order ?? (siblings.reduce((m, n) => Math.max(m, n.order), 0) + 1)
      const node: OutlineNode = {
        id: uid(type === 'volume' ? 'vol' : type === 'chapter' ? 'ch' : 'beat'),
        projectId: a.projectId, type, title: a.title ?? `未命名${type}`,
        summary: a.summary ?? '', parentId: a.parentId ?? null, order,
        status: a.status ?? 'planned', beats: a.beats ?? [],
        createdAt: nowIso(), updatedAt: nowIso(),
      }
      data.outline.push(node)
      store.save(a.projectId)
      return { id: node.id, title: node.title, type: node.type, order: node.order, message: '已创建（章节可用 novel_chapter_write 生成）' }
    },
  }))

  tools.push(defineTool({
    name: 'novel_outline_list',
    description: '查看项目大纲树（卷/章/情节拍 + 状态）与未解伏笔。',
    parameters: {
      projectId: { type: 'string', required: true, description: '项目 id' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          outline: { type: 'string', required: true },
          foreshadowings: { type: 'string', required: true },
        },
      },
      render: (_a, v) => text((v as { outline: string }).outline),
    },
    async execute(args) {
      const a = args as { projectId: string }
      const data = store.load(a.projectId)
      const lines: string[] = []
      const byParent = new Map<string | null, OutlineNode[]>()
      for (const n of data.outline) {
        const list = byParent.get(n.parentId ?? null) ?? []
        list.push(n)
        byParent.set(n.parentId ?? null, list)
      }
      const walk = (parent: string | null, depth: number) => {
        const nodes = (byParent.get(parent) ?? []).sort((x, y) => x.order - y.order)
        for (const n of nodes) {
          const mark = n.status === 'done' ? '✓' : n.status === 'writing' ? '✎' : '·'
          lines.push(`${'  '.repeat(depth)}${mark} ${n.id} [${n.type}#${n.order}] ${n.title}${n.summary ? '：' + n.summary.slice(0, 80) : ''}`)
          if (n.type === 'chapter' && n.beats.length > 0) {
            n.beats.forEach((b, i) => lines.push(`${'  '.repeat(depth + 1)}${i + 1}. ${b.slice(0, 60)}`))
          }
          walk(n.id, depth + 1)
        }
      }
      walk(null, 0)
      const open = openForeshadowings(data)
      const fLines = open.map(f => `  [${f.id}] ${f.description}`).join('\n')
      return { outline: lines.join('\n') || '（大纲为空）', foreshadowings: open.length === 0 ? '（无未解伏笔）' : `未解伏笔 ${open.length} 个：\n${fLines}` }
    },
  }))

  // ── 分卷 ──
  tools.push(defineTool({
    name: 'novel_volume_list',
    description: '列出项目的分卷（卷=大纲中 type=volume 的节点，按 order 排序）：每卷标题/概要/章数/总字数/卷内章节。未分卷的章节也列出。',
    parameters: {
      projectId: { type: 'string', required: true, description: '项目 id' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          volumes: { type: 'string', required: true },
          count: { type: 'integer', required: true },
        },
      },
      render: (_a, v) => text((v as { volumes: string }).volumes),
    },
    async execute(args) {
      const a = args as { projectId: string }
      const data = store.load(a.projectId)
      const vols = volumesSorted(data)
      if (vols.length === 0) return { volumes: '（暂无分卷——可用 novel_outline_edit 创建 type=volume 节点，再把章节 parentId 指向卷）', count: 0 }
      const lines: string[] = []
      for (let i = 0; i < vols.length; i++) {
        const v = vols[i]
        const chapters = data.outline
          .filter(n => n.type === 'chapter' && n.parentId === v.id)
          .sort((x, y) => x.order - y.order)
        const words = chapters.reduce((s, n) => s + (data.chapters.find(c => c.id === n.id)?.wordCount ?? 0), 0)
        lines.push(`第${i + 1}卷《${v.title}》[${v.id}]：${chapters.length} 章 / ${words} 字${v.summary ? `｜${v.summary.slice(0, 80)}` : ''}`)
        for (const c of chapters) {
          lines.push(`  · 第${c.order}章 ${c.title}（${data.chapters.find(r => r.id === c.id) ? '已生成' : '未生成'}）`)
        }
      }
      const unassigned = data.outline.filter(n => n.type === 'chapter' && !chapterVolume(data, n.id)).sort((x, y) => x.order - y.order)
      if (unassigned.length > 0) {
        lines.push('── 未分卷章节 ──')
        for (const c of unassigned) lines.push(`  · 第${c.order}章 ${c.title}`)
      }
      return { volumes: lines.join('\n'), count: vols.length }
    },
  }))

  tools.push(defineTool({
    name: 'novel_volume_assign',
    description: '把章节划入某个卷（或移出卷：volumeId 传 "none"/null）。本质是更新大纲 chapter 节点的 parentId，正文记录 volumeId 随之同步（大纲为唯一事实来源）。',
    parameters: {
      projectId: { type: 'string', required: true, description: '项目 id' },
      chapterId: { type: 'string', required: true, description: '章节节点 id（大纲中 type=chapter 的节点）' },
      volumeId: { type: 'string', description: '目标卷节点 id；传 "none" 或留空=移出卷。卷清单用 novel_volume_list 查询。' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          chapterId: { type: 'string', required: true },
          volumeId: { type: 'string', required: true },
          message: { type: 'string', required: true },
        },
      },
      render: (_a, v) => text((v as { message: string }).message),
    },
    async execute(args) {
      const a = args as { projectId: string; chapterId: string; volumeId?: string }
      const data = store.load(a.projectId)
      const node = data.outline.find(n => n.id === a.chapterId && n.type === 'chapter')
      if (!node) throw new Error(`章节节点不存在: ${a.chapterId}`)
      const raw = (a.volumeId ?? '').trim()
      if (!raw || raw === 'none') {
        node.parentId = null
        node.updatedAt = nowIso()
        const rec = data.chapters.find(c => c.id === node.id)
        if (rec) rec.volumeId = null
        store.save(a.projectId)
        return { chapterId: node.id, volumeId: '', message: `第${node.order}章《${node.title}》已移出卷（未分卷）` }
      }
      const vol = data.outline.find(n => n.id === raw && n.type === 'volume')
      if (!vol) throw new Error(`卷不存在（需要 type=volume 的节点 id）: ${raw}`)
      node.parentId = vol.id
      node.updatedAt = nowIso()
      const rec = data.chapters.find(c => c.id === node.id)
      if (rec) rec.volumeId = vol.id
      const vIdx = volumesSorted(data).findIndex(v => v.id === vol.id) + 1
      const cIdx = chapterIndexInVolume(data, node.id)
      store.save(a.projectId)
      return { chapterId: node.id, volumeId: vol.id, message: `第${node.order}章《${node.title}》已划入第${vIdx}卷《${vol.title}》（该卷第${cIdx}章）` }
    },
  }))

  // ── 人物 ──
  tools.push(defineTool({
    name: 'novel_character_edit',
    description: '创建或更新人物档案（外貌/性格/背景/目标/成长弧光/当前状态）。不传 characterId=新建。生成章节时人物档案自动注入上下文。',
    parameters: {
      projectId: { type: 'string', description: '项目 id（新建必填）' },
      characterId: { type: 'string', description: '要更新的人物 id（不传=新建）' },
      name: { type: 'string', description: '姓名（新建必填）' },
      aliases: { type: 'array', items: { type: 'string' }, description: '别名/昵称' },
      role: { type: 'string', enum: ['protagonist', 'supporting', 'antagonist', 'minor'], description: '定位' },
      appearance: { type: 'string', description: '外貌' },
      personality: { type: 'string', description: '性格' },
      personalityProfile: { type: 'string', description: '人格档案（九型/MBTI/大五等结构化人格设定，由角色设定工作坊生成；生成章节时注入上下文）' },
      background: { type: 'string', description: '背景经历' },
      goal: { type: 'string', description: '核心目标/动机' },
      arc: { type: 'array', items: { type: 'string' }, description: '成长弧光阶段（如：怯懦->觉醒->承担）' },
      location: { type: 'string', description: '当前所在位置' },
      condition: { type: 'string', description: '当前状况（伤势/情绪等）' },
      possessions: { type: 'array', items: { type: 'string' }, description: '重要持有物' },
      stateNotes: { type: 'string', description: '当前状态备注（手动修正用）' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          name: { type: 'string', required: true },
          message: { type: 'string', required: true },
        },
      },
      render: (_a, v) => text(`人物: ${(v as { name: string }).name} (${(v as { message: string }).message})`),
    },
    async execute(args) {
      const a = args as Record<string, unknown> as {
        projectId?: string; characterId?: string; name?: string; aliases?: string[]
        role?: CharacterRole; appearance?: string; personality?: string; personalityProfile?: string; background?: string
        goal?: string; arc?: string[]; location?: string; condition?: string; possessions?: string[]; stateNotes?: string
      }
      if (a.characterId) {
        const projectId = findProjectBy(a.characterId, 'character')
        const data = store.load(projectId)
        const ch = data.characters.find(c => c.id === a.characterId)
        if (!ch) throw new Error(`人物不存在: ${a.characterId}`)
        if (a.name !== undefined) ch.name = a.name
        if (a.aliases !== undefined) ch.aliases = a.aliases
        if (a.role !== undefined) ch.role = a.role
        if (a.appearance !== undefined) ch.appearance = a.appearance
        if (a.personality !== undefined) ch.personality = a.personality
        if (a.personalityProfile !== undefined) ch.personalityProfile = a.personalityProfile
        if (a.background !== undefined) ch.background = a.background
        if (a.goal !== undefined) ch.goal = a.goal
        if (a.arc !== undefined) ch.arc = a.arc.map((s, i) => ({ stage: `阶段${i + 1}`, description: s }))
        if (a.location !== undefined) ch.currentState.location = a.location
        if (a.condition !== undefined) ch.currentState.condition = a.condition
        if (a.possessions !== undefined) ch.currentState.possessions = a.possessions
        if (a.stateNotes !== undefined) ch.currentState.notes = a.stateNotes
        ch.updatedAt = nowIso()
        store.save(projectId)
        return { id: ch.id, name: ch.name, message: '已更新' }
      }
      if (!a.projectId || !a.name) throw new Error('新建人物需要 projectId 与 name')
      const data = store.load(a.projectId)
      const ch: Character = {
        id: uid('c'), projectId: a.projectId, name: a.name,
        aliases: a.aliases ?? [], role: a.role ?? 'supporting',
        appearance: a.appearance ?? '', personality: a.personality ?? '',
        personalityProfile: a.personalityProfile ?? '',
        background: a.background ?? '', goal: a.goal ?? '',
        relationships: [],
        arc: (a.arc ?? []).map((s, i) => ({ stage: `阶段${i + 1}`, description: s })),
        currentState: {
          location: a.location ?? '', condition: a.condition ?? '',
          possessions: a.possessions ?? [], notes: a.stateNotes ?? '',
        },
        createdAt: nowIso(), updatedAt: nowIso(),
      }
      data.characters.push(ch)
      store.save(a.projectId)
      return { id: ch.id, name: ch.name, message: '已创建' }
    },
  }))

  tools.push(defineTool({
    name: 'novel_character_list',
    description: '列出项目人物档案（含当前状态）。可选 detail=true 输出完整档案。',
    parameters: {
      projectId: { type: 'string', required: true, description: '项目 id' },
      detail: { type: 'boolean', description: '是否输出完整档案（默认摘要）' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          characters: { type: 'string', required: true },
          count: { type: 'integer', required: true },
        },
      },
      render: (_a, v) => text((v as { characters: string }).characters),
    },
    async execute(args) {
      const a = args as { projectId: string; detail?: boolean }
      const data = store.load(a.projectId)
      if (data.characters.length === 0) return { characters: '（暂无人物）', count: 0 }
      const lines = data.characters.map(c => {
        const base = `[${c.id}] ${c.name}（${CHARACTER_ROLE_LABELS[c.role]}）${c.aliases.length > 0 ? '又称:' + c.aliases.join('、') : ''}`
        if (!a.detail) return base + ` | 位置:${c.currentState.location || '?'} 状况:${c.currentState.condition || '?'}`
        const parts = [
          base,
          c.appearance && `  外貌: ${c.appearance}`,
          c.personality && `  性格: ${c.personality}`,
          c.background && `  背景: ${c.background}`,
          c.goal && `  目标: ${c.goal}`,
          c.arc.length > 0 && `  弧光: ${c.arc.map(x => x.description).join(' -> ')}`,
          `  当前: 位置=${c.currentState.location || '?'} 状况=${c.currentState.condition || '?'}${c.currentState.possessions.length > 0 ? ' 持有=' + c.currentState.possessions.join('、') : ''}`,
          c.currentState.notes && `  状态备注: ${c.currentState.notes}`,
        ]
        return parts.filter(Boolean).join('\n')
      })
      return { characters: lines.join('\n'), count: data.characters.length }
    },
  }))

  // ── 世界观 ──
  tools.push(defineTool({
    name: 'novel_worldview_edit',
    description: '创建或更新世界观条目（地理/历史/规则/文化/力量体系/其他）。生成章节时自动注入上下文。不传 entryId=新建。',
    parameters: {
      projectId: { type: 'string', description: '项目 id（新建必填）' },
      category: { type: 'string', enum: ['geography', 'history', 'rules', 'culture', 'power-system', 'other'], description: '类别' },
      title: { type: 'string', description: '条目标题（新建必填）' },
      content: { type: 'string', description: '条目内容' },
      entryId: { type: 'string', description: '要更新的条目 id（不传=新建）' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          title: { type: 'string', required: true },
          message: { type: 'string', required: true },
        },
      },
      render: (_a, v) => text(`世界观: ${(v as { title: string }).title} (${(v as { message: string }).message})`),
    },
    async execute(args) {
      const a = args as Record<string, unknown> as {
        projectId?: string; category?: WorldviewCategory; title?: string; content?: string; entryId?: string
      }
      if (a.entryId) {
        const projectId = findProjectBy(a.entryId, 'entry')
        const data = store.load(projectId)
        const e = data.worldview.find(x => x.id === a.entryId)
        if (!e) throw new Error(`世界观条目不存在: ${a.entryId}`)
        if (a.category !== undefined) e.category = a.category
        if (a.title !== undefined) e.title = a.title
        if (a.content !== undefined) e.content = a.content
        e.updatedAt = nowIso()
        store.save(projectId)
        return { id: e.id, title: e.title, message: '已更新' }
      }
      if (!a.projectId || !a.title) throw new Error('新建世界观条目需要 projectId 与 title')
      const data = store.load(a.projectId)
      const e = {
        id: uid('w'), projectId: a.projectId,
        category: a.category ?? 'other',
        title: a.title, content: a.content ?? '',
        createdAt: nowIso(), updatedAt: nowIso(),
      }
      data.worldview.push(e)
      store.save(a.projectId)
      return { id: e.id, title: e.title, message: '已创建' }
    },
  }))

  tools.push(defineTool({
    name: 'novel_worldview_list',
    description: '查看项目世界观设定（按类别分组）。',
    parameters: {
      projectId: { type: 'string', required: true, description: '项目 id' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          worldview: { type: 'string', required: true },
          count: { type: 'integer', required: true },
        },
      },
      render: (_a, v) => text((v as { worldview: string }).worldview),
    },
    async execute(args) {
      const a = args as { projectId: string }
      const data = store.load(a.projectId)
      if (data.worldview.length === 0) return { worldview: '（世界观为空）', count: 0 }
      const byCat = new Map<string, typeof data.worldview>()
      for (const e of data.worldview) {
        const list = byCat.get(e.category) ?? []
        list.push(e)
        byCat.set(e.category, list)
      }
      const lines: string[] = []
      for (const [cat, entries] of byCat) {
        lines.push(`◆ ${WORLDVIEW_CATEGORY_LABELS[cat as keyof typeof WORLDVIEW_CATEGORY_LABELS] ?? cat}`)
        for (const e of entries) lines.push(`  [${e.id}] ${e.title}: ${e.content.slice(0, 150)}`)
      }
      return { worldview: lines.join('\n'), count: data.worldview.length }
    },
  }))

  // ── 地理（独立于世界观，与地图插件联动） ──
  tools.push(defineTool({
    name: 'novel_geo_edit',
    description: '创建或更新地理条目（国家/区域/城市/地形/建筑/其他）。地理已在世界观中独立成库；mapX/mapY 为归一化坐标（0-1，可空），供地图插件标注相对位置。不传 geoId=新建。',
    parameters: {
      projectId: { type: 'string', description: '项目 id（新建必填）' },
      geoId: { type: 'string', description: '要更新的条目 id（不传=新建）' },
      name: { type: 'string', description: '地名（新建必填）' },
      aliases: { type: 'array', items: { type: 'string' }, description: '别名' },
      type: { type: 'string', enum: GEO_TYPES, description: '类型：country=国家/势力 region=区域 city=城市 terrain=地形 building=建筑 other=其他' },
      description: { type: 'string', description: '描述（地理/地貌/人文特征）' },
      mapX: { type: 'number', description: '归一化横坐标 0-1（可空；地图上的相对位置）' },
      mapY: { type: 'number', description: '归一化纵坐标 0-1（可空）' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          name: { type: 'string', required: true },
          message: { type: 'string', required: true },
        },
      },
      render: (_a, v) => text(`地理: ${(v as { name: string }).name} (${(v as { message: string }).message})`),
    },
    async execute(args) {
      const a = args as Record<string, unknown> as {
        projectId?: string; geoId?: string; name?: string; aliases?: string[]
        type?: GeoType; description?: string; mapX?: number; mapY?: number
      }
      if (a.geoId) {
        const projectId = findProjectBy(a.geoId, 'geo')
        const data = store.load(projectId)
        const g = data.geo.find(x => x.id === a.geoId)
        if (!g) throw new Error(`地理条目不存在: ${a.geoId}`)
        if (a.name !== undefined) g.name = a.name
        if (a.aliases !== undefined) g.aliases = a.aliases
        if (a.type !== undefined && GEO_TYPES.includes(a.type)) g.type = a.type
        if (a.description !== undefined) g.description = a.description
        if (a.mapX !== undefined) g.mapX = typeof a.mapX === 'number' ? Math.min(1, Math.max(0, a.mapX)) : g.mapX
        if (a.mapY !== undefined) g.mapY = typeof a.mapY === 'number' ? Math.min(1, Math.max(0, a.mapY)) : g.mapY
        g.updatedAt = nowIso()
        store.save(projectId)
        return { id: g.id, name: g.name, message: '已更新' }
      }
      if (!a.projectId || !a.name) throw new Error('新建地理条目需要 projectId 与 name')
      const data = store.load(a.projectId)
      if (!Array.isArray(data.geo)) data.geo = []
      const g: GeoEntry = {
        id: uid('g'), projectId: a.projectId, name: a.name, aliases: a.aliases ?? [],
        type: a.type && GEO_TYPES.includes(a.type) ? a.type : 'other', description: a.description ?? '',
        mapX: typeof a.mapX === 'number' ? Math.min(1, Math.max(0, a.mapX)) : null,
        mapY: typeof a.mapY === 'number' ? Math.min(1, Math.max(0, a.mapY)) : null,
        createdAt: nowIso(), updatedAt: nowIso(),
      }
      data.geo.push(g)
      store.save(a.projectId)
      return { id: g.id, name: g.name, message: '已创建（地图插件联动时自动注入）' }
    },
  }))

  tools.push(defineTool({
    name: 'novel_geo_list',
    description: '查看项目地理库（按类型分组，含归一化坐标）。与世界观分离；地图插件（mapforge）联动时使用这些条目。',
    parameters: {
      projectId: { type: 'string', required: true, description: '项目 id' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          geo: { type: 'string', required: true },
          count: { type: 'integer', required: true },
        },
      },
      render: (_a, v) => text((v as { geo: string }).geo),
    },
    async execute(args) {
      const a = args as { projectId: string }
      const data = store.load(a.projectId)
      const geo = data.geo ?? []
      if (geo.length === 0) return { geo: '（地理库为空——用 novel_geo_edit 登记地名/区域；旧版世界观里的 geography 条目已自动迁移至此）', count: 0 }
      const byType = geoGrouped(data)
      const lines: string[] = []
      for (const [type, entries] of byType) {
        lines.push(`◆ ${GEO_TYPE_LABELS[type] ?? type}`)
        for (const g of entries) {
          lines.push(`  [${g.id}] ${g.name}${g.aliases.length > 0 ? '（' + g.aliases.join('、') + '）' : ''}${geoCoordLabel(g.mapX, g.mapY)}：${g.description.slice(0, 150)}`)
        }
      }
      return { geo: lines.join('\n'), count: geo.length }
    },
  }))

  // ── 物品（独立物品库） ──
  tools.push(defineTool({
    name: 'novel_item_edit',
    description: '创建或更新物品档案（独立于章节记忆的持久物品库：武器/法器/器具/材料/药物/书证/其他）。含持有者/所在地/状态；生成章节时自动注入上下文，章节记忆出现的新物品自动登记。不传 itemId=新建。',
    parameters: {
      projectId: { type: 'string', description: '项目 id（新建必填）' },
      itemId: { type: 'string', description: '要更新的物品 id（不传=新建）' },
      name: { type: 'string', description: '物品名（新建必填）' },
      aliases: { type: 'array', items: { type: 'string' }, description: '别名' },
      category: { type: 'string', enum: ITEM_CATEGORIES, description: '类别：weapon=武器 artifact=法器/宝物 tool=器具 material=材料 drug=药物 document=书证/情报 other=其他' },
      description: { type: 'string', description: '描述（外观/来历/用途）' },
      owner: { type: 'string', description: '当前持有者（人物名/组织名；空=无主/未知）' },
      location: { type: 'string', description: '所在地（可与地理库条目同名）' },
      status: { type: 'string', description: '状态：正常/损坏/失窃/封印/遗失等' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          name: { type: 'string', required: true },
          message: { type: 'string', required: true },
        },
      },
      render: (_a, v) => text(`物品: ${(v as { name: string }).name} (${(v as { message: string }).message})`),
    },
    async execute(args) {
      const a = args as Record<string, unknown> as {
        projectId?: string; itemId?: string; name?: string; aliases?: string[]
        category?: ItemCategory; description?: string; owner?: string; location?: string; status?: string
      }
      if (a.itemId) {
        const projectId = findProjectBy(a.itemId, 'item')
        const data = store.load(projectId)
        const it = data.items.find(x => x.id === a.itemId)
        if (!it) throw new Error(`物品不存在: ${a.itemId}`)
        if (a.name !== undefined) it.name = a.name
        if (a.aliases !== undefined) it.aliases = a.aliases
        if (a.category !== undefined && ITEM_CATEGORIES.includes(a.category)) it.category = a.category
        if (a.description !== undefined) it.description = a.description
        if (a.owner !== undefined) it.owner = a.owner
        if (a.location !== undefined) it.location = a.location
        if (a.status !== undefined) it.status = a.status
        it.updatedAt = nowIso()
        store.save(projectId)
        return { id: it.id, name: it.name, message: '已更新' }
      }
      if (!a.projectId || !a.name) throw new Error('新建物品需要 projectId 与 name')
      const data = store.load(a.projectId)
      if (!Array.isArray(data.items)) data.items = []
      const it: ItemRecord = {
        id: uid('it'), projectId: a.projectId, name: a.name, aliases: a.aliases ?? [],
        category: a.category && ITEM_CATEGORIES.includes(a.category) ? a.category : 'other',
        description: a.description ?? '', owner: a.owner ?? '', location: a.location ?? '', status: a.status ?? '正常',
        createdAt: nowIso(), updatedAt: nowIso(),
      }
      data.items.push(it)
      store.save(a.projectId)
      return { id: it.id, name: it.name, message: '已创建（生成章节时自动注入上下文）' }
    },
  }))

  tools.push(defineTool({
    name: 'novel_item_list',
    description: '查看项目物品库（按类别分组：持有者/所在地/状态）。',
    parameters: {
      projectId: { type: 'string', required: true, description: '项目 id' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          items: { type: 'string', required: true },
          count: { type: 'integer', required: true },
        },
      },
      render: (_a, v) => text((v as { items: string }).items),
    },
    async execute(args) {
      const a = args as { projectId: string }
      const data = store.load(a.projectId)
      const items = data.items ?? []
      if (items.length === 0) return { items: '（物品库为空——章节记忆会自动登记出现过的物品；也可用 novel_item_edit 提前登记重要物品）', count: 0 }
      const byCat = new Map<ItemCategory, ItemRecord[]>()
      for (const it of items) {
        const list = byCat.get(it.category) ?? []
        list.push(it)
        byCat.set(it.category, list)
      }
      const lines: string[] = []
      for (const [cat, list] of byCat) {
        lines.push(`◆ ${ITEM_CATEGORY_LABELS[cat] ?? cat}（${list.length}）`)
        for (const it of list) {
          const rel = [it.owner ? `持有=${it.owner}` : '', it.location ? `在=${it.location}` : '', it.status ? `状态=${it.status}` : ''].filter(Boolean).join('；')
          lines.push(`  [${it.id}] ${it.name}${it.aliases.length > 0 ? '（' + it.aliases.join('、') + '）' : ''}${rel ? '｜' + rel : ''}：${it.description.slice(0, 120)}`)
        }
      }
      return { items: lines.join('\n'), count: items.length }
    },
  }))

  // ── 地图联动（读取 mapforge 生成记录） ──
  tools.push(defineTool({
    name: 'novel_map_list',
    description: '列出本项目已生成的地图（与 dsh-map-forge 联动：读取其记录索引，含风格/分辨率/文件路径；无记录时提示用 mapforge_generate 生成）。',
    parameters: {
      projectId: { type: 'string', required: true, description: '项目 id' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          maps: { type: 'string', required: true },
          count: { type: 'integer', required: true },
        },
      },
      render: (_a, v) => text((v as { maps: string }).maps),
    },
    async execute(args) {
      const a = args as { projectId: string }
      const mapDir = deps.mapForgeDataDir
      const index = mapDir ? join(mapDir, 'maps.json') : ''
      if (!index || !existsSync(index)) {
        return { maps: '（地图插件数据不可达——确认 dsh-map-forge 已注入且数据目录正确；可用 mapforge_generate 生成项目地图）', count: 0 }
      }
      let recs: { id: string; projectId?: string | null; title?: string; style?: string; size?: string; quality?: string; files?: string[]; promptFile?: string; status?: string; error?: string; createdAt?: string; notes?: string[] }[] = []
      try { recs = JSON.parse(readFileSync(index, 'utf8')) } catch { /* 损坏索引 */ }
      const mine = recs.filter(r => r.projectId === a.projectId).sort((x, y) => (y.createdAt ?? '').localeCompare(x.createdAt ?? ''))
      if (mine.length === 0) return { maps: '（本项目尚无地图——用 mapforge_generate(projectId=…, style=…) 生成世界地图，生成后此处可见）', count: 0 }
      const lines = mine.map(r => `- ${r.id} 《${r.title ?? '未命名'}》[${r.style ?? '?'}|${r.size ?? '?'}|${r.quality ?? '?'}] ${r.status ?? 'done'}${r.files?.[0] ? '｜' + r.files[0] : r.error ? '｜失败:' + r.error.slice(0, 80) : ''}（${(r.createdAt ?? '').slice(0, 16).replace('T', ' ')}）`)
      return { maps: `项目地图 ${mine.length} 张：\n` + lines.join('\n'), count: mine.length }
    },
  }))

  // ── 伏笔 ──
  tools.push(defineTool({
    name: 'novel_foreshadowing_edit',
    description: '创建或更新伏笔（状态 open/resolved/abandoned）。章节生成后记忆引擎自动登记新伏笔与回收；此工具用于手动管理。',
    parameters: {
      projectId: { type: 'string', description: '项目 id（新建必填）' },
      description: { type: 'string', description: '伏笔描述（新建必填）' },
      foreshadowingId: { type: 'string', description: '要更新的伏笔 id（不传=新建）' },
      status: { type: 'string', enum: ['open', 'resolved', 'abandoned'], description: '状态' },
      notes: { type: 'string', description: '备注' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          status: { type: 'string', required: true },
          message: { type: 'string', required: true },
        },
      },
      render: (_a, v) => text(`伏笔 [${(v as { id: string }).id}] ${(v as { status: string }).status}`),
    },
    async execute(args) {
      const a = args as Record<string, unknown> as {
        projectId?: string; description?: string; foreshadowingId?: string
        status?: 'open' | 'resolved' | 'abandoned'; notes?: string
      }
      if (a.foreshadowingId) {
        const projectId = findProjectBy(a.foreshadowingId, 'foreshadowing')
        const data = store.load(projectId)
        const f = data.foreshadowings.find(x => x.id === a.foreshadowingId)
        if (!f) throw new Error(`伏笔不存在: ${a.foreshadowingId}`)
        if (a.description !== undefined) f.description = a.description
        if (a.status !== undefined) f.status = a.status
        if (a.notes !== undefined) f.notes = a.notes
        f.updatedAt = nowIso()
        store.save(projectId)
        return { id: f.id, status: f.status, message: '已更新' }
      }
      if (!a.projectId || !a.description) throw new Error('新建伏笔需要 projectId 与 description')
      const data = store.load(a.projectId)
      const f: Foreshadowing = {
        id: uid('f'), projectId: a.projectId, description: a.description,
        plantedChapterId: null, resolvedChapterId: null,
        status: a.status ?? 'open',
        notes: a.notes ?? '', createdAt: nowIso(), updatedAt: nowIso(),
      }
      data.foreshadowings.push(f)
      store.save(a.projectId)
      return { id: f.id, status: f.status, message: '已创建' }
    },
  }))

  // ── 章节生成（核心） ──
  tools.push(defineTool({
    name: 'novel_chapter_write',
    description: '生成一章完整小说。输入=大纲章节节点 id（须先用 novel_outline_edit 创建 type=chapter 节点，含 summary 与 beats），自动拼接世界观/人物状态/近章记忆/未解伏笔调用 LLM 生成正文，随后自动提取记忆（摘要/事件/人物变化/伏笔变化）并更新状态。返回章节预览与记忆摘要。',
    parameters: {
      chapterId: { type: 'string', required: true, description: '大纲章节节点 id' },
      extraInstructions: { type: 'string', description: '额外写作指令（中途改方向/特殊要求）' },
      styleCards: { type: 'array', items: { type: 'string' }, description: '本次生成选用的文风卡 key 清单（须先在 novel_style_kb 里登记；不传则用项目 enabled 的默认集。例：["c085-yonezawa-honobu","hands02-setting-detective"]）。既支持多张并存，也可按本章需要挑对应文风。' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          chapterId: { type: 'string', required: true },
          title: { type: 'string', required: true },
          volume: { type: 'string' },
          wordCount: { type: 'integer', required: true },
          preview: { type: 'string', required: true },
          memory: { type: 'string', required: true },
        },
      },
      render: (_a, v) => text(`章节已生成: 《${(v as { title: string }).title}》 ${(v as { wordCount: number }).wordCount}字${(v as { volume?: string }).volume ? '\n' + (v as { volume: string }).volume : ''}\n${(v as { memory: string }).memory}`),
    },
    async execute(args) {
      const a = args as { chapterId: string; extraInstructions?: string; styleCards?: string[] }
      const projectId = findProjectBy(a.chapterId, 'chapter')
      const data = store.load(projectId)
      const node = findChapterNode(data, a.chapterId)
      const { recent, prev } = chapterContext(data, 3, node.id)
      const open = openForeshadowings(data)
      const system = generator.buildSystemPrompt(data, data.characters, a.styleCards && a.styleCards.length > 0 ? a.styleCards : undefined)
      const prompt = generator.buildChapterPrompt(data, node, prev, open, recent, a.extraInstructions ?? '')
      node.status = 'writing'
      store.save(projectId)
      const content = await generator.generate(system, prompt)
      if (!content) throw new Error('LLM 返回空内容')
      store.writeChapterContent(projectId, node.id, content)
      ensureChapterRecord(data, node)
      store.save(projectId)
      // 记忆提取
      let mem: MemoryExtraction
      try {
        mem = await generator.extractMemory(data, node.title, content, open)
      } catch (e) {
        // 记忆失败不阻塞章节，正文已保存
        const rec = ensureChapterRecord(data, node)
        rec.summary = content.slice(0, 150)
        rec.wordCount = content.replace(/\s/g, '').length
        node.status = 'done'
        store.save(projectId)
        return {
          chapterId: node.id, title: node.title, wordCount: rec.wordCount,
          ...(volumeTitleOf(data, node.id) ? { volume: volumeTitleOf(data, node.id) } : {}),
          preview: content.slice(0, 300),
          memory: `⚠️ 记忆提取失败（${String(e).slice(0, 80)}），正文已保存，摘要为截断预览。可用 novel_memory_update 手动修正。`,
        }
      }
      const planted = applyMemory(data, node, content, mem)
      store.save(projectId)
      const rec = data.chapters.find(c => c.id === node.id)!
      const volTitle = volumeTitleOf(data, node.id)
      return {
        chapterId: node.id, title: node.title, wordCount: rec.wordCount,
        ...(volTitle ? { volume: volTitle } : {}),
        preview: content.slice(0, 300),
        memory: memoryBrief(rec, planted, rec.foreshadowingResolved.length),
      }
    },
    timeoutMs: 600_000,
  }))

  // ── 章节读取 ──
  tools.push(defineTool({
    name: 'novel_chapter_get',
    description: '读取已生成章节（正文+记忆）。默认返回摘要与前500字，withContent=true 返回全文。',
    parameters: {
      chapterId: { type: 'string', required: true, description: '章节 id' },
      withContent: { type: 'boolean', description: '返回全文（默认只返回前500字预览+记忆）' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          chapterId: { type: 'string', required: true },
          title: { type: 'string', required: true },
          volume: { type: 'string' },
          order: { type: 'integer', required: true },
          wordCount: { type: 'integer', required: true },
          content: { type: 'string', required: true },
          memory: { type: 'string', required: true },
        },
      },
      render: (_a, v) => {
        const r = v as { title: string; order: number; wordCount: number; volume?: string }
        return text(`《${r.title}》第${r.order}章 ${r.wordCount}字${r.volume ? '｜' + r.volume : ''}`)
      },
    },
    async execute(args) {
      const a = args as { chapterId: string; withContent?: boolean }
      const projectId = findProjectBy(a.chapterId, 'chapter')
      const data = store.load(projectId)
      const node = findChapterNode(data, a.chapterId)
      const rec = data.chapters.find(c => c.id === a.chapterId)
      const content = store.readChapterContent(projectId, a.chapterId)
      const memParts: string[] = []
      if (rec) {
        if (rec.summary) memParts.push('摘要: ' + rec.summary)
        if (rec.events.length) memParts.push('事件: ' + rec.events.join('；'))
        if (rec.characterUpdates.length) memParts.push('人物变化: ' + rec.characterUpdates.map(c => `${c.name}-${c.change}`).join('；'))
      } else {
        memParts.push('（无记忆记录--尚未经 novel_chapter_write 生成）')
      }
      const volTitle = volumeTitleOf(data, node.id)
      return {
        chapterId: node.id, title: node.title, order: node.order,
        ...(volTitle ? { volume: volTitle } : {}),
        wordCount: content.replace(/\s/g, '').length,
        content: a.withContent ? content : content.slice(0, 500),
        memory: memParts.join('\n'),
      }
    },
  }))

  // ── 交互式续写/改写 ──
  tools.push(defineTool({
    name: 'novel_chapter_continue',
    description: '交互式续写或改写已有章节：mode=append 在章节末尾按指令续写（保留原文）；mode=rewrite 按指令改写整章。完成后自动重新提取记忆并更新状态。',
    parameters: {
      chapterId: { type: 'string', required: true, description: '章节 id' },
      instructions: { type: 'string', required: true, description: '续写/改写指令（中途改方向、插入情节、调整文风等）' },
      mode: { type: 'string', enum: ['append', 'rewrite'], description: 'append=末尾续写（默认），rewrite=整章改写' },
      styleCards: { type: 'array', items: { type: 'string' }, description: '本次续写/改写选用的文风卡 key 清单（不传则用项目 enabled 的默认集）' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          chapterId: { type: 'string', required: true },
          wordCount: { type: 'integer', required: true },
          addedText: { type: 'string', required: true },
          memory: { type: 'string', required: true },
        },
      },
      render: (_a, v) => text(`章节已更新: ${(v as { chapterId: string }).chapterId} 现${(v as { wordCount: number }).wordCount}字`),
    },
    async execute(args) {
      const a = args as { chapterId: string; instructions: string; mode?: 'append' | 'rewrite'; styleCards?: string[] }
      const projectId = findProjectBy(a.chapterId, 'chapter')
      const data = store.load(projectId)
      const node = findChapterNode(data, a.chapterId)
      const oldContent = store.readChapterContent(projectId, a.chapterId)
      if (!oldContent) throw new Error('该章节还没有正文，请先用 novel_chapter_write 生成')
      const mode = a.mode ?? 'append'
      const system = generator.buildSystemPrompt(data, data.characters, a.styleCards && a.styleCards.length > 0 ? a.styleCards : undefined)
      const instructions = mode === 'append'
        ? `以下是本章已有正文的末尾部分：\n\n${oldContent.slice(-1000)}\n\n【续写指令】${a.instructions}\n\n请直接输出续写的新内容（不要重复已有正文），保持人称、时态、文风连贯。`
        : `以下是本章当前正文：\n\n${oldContent.slice(0, 6000)}\n\n【改写指令】${a.instructions}\n\n请输出改写后的完整章节正文。`
      const newText = await generator.generate(system, instructions)
      if (!newText) throw new Error('LLM 返回空内容')
      const content = mode === 'append' ? oldContent + '\n\n' + newText : newText
      store.writeChapterContent(projectId, node.id, content)
      ensureChapterRecord(data, node)
      store.save(projectId)
      try {
        const mem = await generator.extractMemory(data, node.title, content, openForeshadowings(data))
        applyMemory(data, node, content, mem)
        store.save(projectId)
      } catch {
        const rec = ensureChapterRecord(data, node)
        rec.wordCount = content.replace(/\s/g, '').length
        store.save(projectId)
      }
      const rec = data.chapters.find(c => c.id === node.id)!
      return {
        chapterId: node.id,
        wordCount: content.replace(/\s/g, '').length,
        addedText: newText.slice(0, 400),
        memory: memoryBrief(rec, 0, rec.foreshadowingResolved.length),
      }
    },
    timeoutMs: 600_000,
  }))

  // ── AI 智能编辑：章节润色 ──
  tools.push(defineTool({
    name: 'novel_chapter_polish',
    description: 'AI 智能编辑：对已完成章节进行修正与润色（保持人物/世界观/情节一致）。mode=light 轻度修正硬伤（错别字/语病/标点/逻辑，不扩写）；mode=deep 深度润色（增强表现力，可适度扩写）。focus 可指定重点润色方向。save=true 覆盖正文（原文自动备份到 chapters/backup/），落盘前自动做完整性检测（长度比/长段重复/杂讯），检测未通过则不落盘并返回 blocked+全文预览；save=false 只返回润色稿预览不落盘。本地小模型（novel-polish）重写长文可能不稳定，建议先 save=false 预览确认再落盘。',
    parameters: {
      projectId: { type: 'string', required: true, description: '项目 id' },
      chapterId: { type: 'string', required: true, description: '章节 id（大纲中 type=chapter 的节点 id）' },
      mode: { type: 'string', enum: ['light', 'deep'], description: 'light=轻度修正（默认 deep=深度润色）' },
      focus: { type: 'string', description: '重点润色方向（如：对话更口语化、动作描写更细致、节奏更快）' },
      save: { type: 'boolean', description: '覆盖正文并备份原文（默认 true，落盘前自动完整性检测）；false=只返回润色稿预览' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          chapterId: { type: 'string', required: true },
          title: { type: 'string', required: true },
          save: { type: 'boolean', required: true },
          wordCount: { type: 'integer' },
          preview: { type: 'string' },
          polished: { type: 'string' },
          backupPath: { type: 'string' },
          blocked: { type: 'string' },
          damage: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' }, issues: { type: 'array', items: { type: 'string' } }, ratio: { type: 'number' } } },
        },
      },
      render: (_a, v) => {
        const r = v as { title: string; save: boolean; wordCount?: number; preview?: string; polished?: string; backupPath?: string; blocked?: string; damage?: { ok: boolean; issues: string[]; ratio: number } }
        if (r.blocked) {
          return text(`《${r.title}》完整性检测未通过，未落盘：${r.blocked}。\n请检查以下润色稿全文，确认无误后再调用 save=true 保存（或手动修正）。\n${(r.polished ?? '').slice(0, 500)}`)
        }
        return text(r.save
          ? `《${r.title}》已润色并落盘（${r.wordCount}字），原文已备份到 ${r.backupPath ?? 'chapters/backup/'}。\n${r.preview ?? ''}`
          : `《${r.title}》润色稿预览（未落盘${r.damage && !r.damage.ok ? '，⚠️ 检测提示：' + r.damage.issues.join('；') : ''}，可用 save=true 确认保存）：\n${(r.preview ?? r.polished ?? '').slice(0, 300)}`)
      },
    },
    async execute(args) {
      return runPolish(store, generator, args as PolishArgs) as Promise<{ chapterId: string; title: string; save: boolean; wordCount?: number; preview?: string; polished?: string; backupPath?: string; blocked?: string; damage?: PolishDamage }>
    },
    timeoutMs: 600_000,
  }))

  // ── 记忆手动修正 ──
  tools.push(defineTool({
    name: 'novel_memory_update',
    description: '手动修正章节记忆（摘要/事件/人物变化/物品）。当自动提取不准时使用。',
    parameters: {
      chapterId: { type: 'string', required: true, description: '章节 id' },
      summary: { type: 'string', description: '修正后的剧情摘要' },
      events: { type: 'array', items: { type: 'string' }, description: '修正后的主要事件' },
      items: { type: 'array', items: { type: 'string' }, description: '修正后的物品' },
      characterUpdates: { type: 'array', items: { type: 'object', additionalProperties: true }, description: '人物变化（手动修正，不自动应用到人物状态）' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          chapterId: { type: 'string', required: true },
          message: { type: 'string', required: true },
        },
      },
      render: () => text('记忆已修正'),
    },
    async execute(args) {
      const a = args as Record<string, unknown> as {
        chapterId: string; summary?: string; events?: string[]
        items?: string[]; characterUpdates?: { name: string; change: string }[]
      }
      const projectId = findProjectBy(a.chapterId, 'chapter')
      const data = store.load(projectId)
      const node = findChapterNode(data, a.chapterId)
      const rec = ensureChapterRecord(data, node)
      if (a.summary !== undefined) rec.summary = a.summary
      if (a.events !== undefined) rec.events = a.events
      if (a.items !== undefined) rec.items = a.items
      if (a.characterUpdates !== undefined) rec.characterUpdates = a.characterUpdates
      rec.updatedAt = nowIso()
      store.save(projectId)
      return { chapterId: node.id, message: '记忆已修正' }
    },
  }))

  // ── 导出 ──
  tools.push(defineTool({
    name: 'novel_export',
    description: '导出整本小说：markdown / txt / epub 三种格式，输出到项目 exports 目录。',
    parameters: {
      projectId: { type: 'string', required: true, description: '项目 id' },
      format: { type: 'string', enum: ['markdown', 'txt', 'epub'], description: '导出格式' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          format: { type: 'string', required: true },
          filePath: { type: 'string', required: true },
          wordCount: { type: 'integer', required: true },
          chapterCount: { type: 'integer', required: true },
        },
      },
      render: (_a, v) => text(`已导出 ${(v as { format: string }).format}: ${(v as { filePath: string }).filePath}（${(v as { chapterCount: number }).chapterCount}章 / ${(v as { wordCount: number }).wordCount}字）`),
    },
    async execute(args) {
      const a = args as { projectId: string; format: 'markdown' | 'txt' | 'epub' }
      const data = store.load(a.projectId)
      const outDir = store.exportDir(a.projectId)
      const r = a.format === 'epub' ? exportEpub(store, data, outDir)
        : a.format === 'txt' ? exportTxt(store, data, outDir)
        : exportMarkdown(store, data, outDir)
      return r
    },
  }))

  // ── 模型状态 ──
  tools.push(defineTool({
    name: 'novel_model_status',
    description: '查看写作引擎当前使用的模型路由（配置的 provider/model 或跟随主会话的路由）。',
    parameters: {},
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          provider: { type: 'string', required: true },
          model: { type: 'string', required: true },
          source: { type: 'string', required: true },
        },
      },
      render: (_a, v) => text(`写作模型: ${(v as { provider: string }).provider}/${(v as { model: string }).model} (${(v as { source: string }).source})`),
    },
    async execute() {
      const r = generator.effectiveRoute()
      if (!r) return { provider: '', model: '', source: '无可用路由：请在主会话发一条消息以捕获路由，或配置插件 provider/model' }
      const source = generator.lastSessionRoute && generator.lastSessionRoute.provider === r.provider ? '跟随主会话' : '插件配置'
      return { provider: r.provider, model: r.model, source }
    },
  }))

  // ── 设定文件导入（AI 解析）──
  tools.push(defineTool({
    name: 'novel_import_settings',
    description: '读取本地已完成设定文件（.md/.txt/.json/.yaml），AI 解析为结构化设定（世界观/人物/大纲/伏笔）并导入项目。一次可指定多个文件或目录：filePath 用换行/分号/逗号分隔多个路径（每个可为文件或目录，坏路径会跳过并在报告中列出）。相同标题/名字/描述自动跳过（幂等）。建议先 dryRun=true 预览解析效果再正式导入。',
    parameters: {
      projectId: { type: 'string', required: true, description: '目标项目 id' },
      filePath: { type: 'string', required: true, description: '设定文件/目录路径；多个路径用换行、分号或逗号分隔，每个可为文件或目录（目录递归读取 .md/.txt/.json/.yaml）' },
      mode: { type: 'string', enum: ['auto', 'worldview', 'characters', 'outline', 'foreshadowing'], description: '解析模式（默认 auto=解析全部）' },
      dryRun: { type: 'boolean', description: '只解析预览不写入（默认 false）' },
      encoding: { type: 'string', enum: ['utf-8', 'gbk'], description: '文件编码（Windows 老文件可能需 gbk，默认 utf-8）' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          files: { type: 'string', required: true },
          imported: { type: 'string', required: true },
          skipped: { type: 'string', required: true },
          preview: { type: 'string', required: true },
        },
      },
      render: (_a, v) => text((v as { preview: string }).preview),
    },
    async execute(args) {
      return runImport(store, generator, args as ImportArgs)
    },
    // 超长文本分块解析：20 块 × 每块 ~90s，上限给足 15 分钟
    timeoutMs: 900_000,
  }))

  // ── 移植自旧版：分析类 + 章节库浏览工具（projectId 定位作品） ──
  for (const tool of buildAnalysisTools({ store, dataDir })) {
    tools.push(tool)
  }

  // ── 移植自旧版：设定/摘要/伏笔/创作资料/连贯性/语义检索/导入/新建章（第二批） ──
  for (const tool of buildPortTools({ store, dataDir })) {
    tools.push(tool)
  }

  // ── 文风知识库适配 ──
  tools.push(defineTool({
    name: 'novel_style_kb',
    description: '文风知识库（style-kb）适配：检索/查看文风卡，并把一到多张文风卡绑定到项目，写作时自动注入对应文风（支持多张并存、按需选用）。action=list 检索全部卡（tag/q 过滤）；action=get 查看项目已绑定卡片与启用状态；action=bind 绑定卡片（可多张，cards 接受 key 或标题/作品名柔性匹配）；action=unbind 解除绑定；action=set_enabled 切换某卡的启用状态（enabled 的合集=项目默认注入集）；action=preview 预览项目注入进 system prompt 的文风块。绑定后 novel_chapter_write / novel_chapter_continue 默认注入 enabled 的卡，也可传 styleCards 临时按本章选用。',
    parameters: {
      action: { type: 'string', enum: ['list', 'get', 'bind', 'unbind', 'set_enabled', 'preview'], description: '操作（默认 list）' },
      projectId: { type: 'string', description: '项目 id（bind/unbind/set_enabled/get/preview 需要）' },
      cards: { type: 'array', items: { type: 'string' }, description: '卡片引用（key 或标题/作者·作品名）；bind/unbind/set_enabled 用' },
      tag: { type: 'string', description: 'list 过滤：体裁标签，如 推理-本格 / 异世界 / 恋爱喜剧' },
      q: { type: 'string', description: 'list 检索：作者名/作品名/标题子串/手法关键词，如 米泽 / 凉宫 / 设定系' },
      enabled: { type: 'boolean', description: 'set_enabled 用：是否启用该卡（true/false）' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          available: { type: 'boolean', required: true },
          action: { type: 'string', required: true },
          message: { type: 'string', required: true },
          cards: { type: 'array', items: { type: 'json' } },
          bound: { type: 'array', items: { type: 'json' } },
          preview: { type: 'string' },
        },
      },
      render: (_a, v) => {
        const r = v as { message: string; available: boolean }
        return text((r.available ? '' : '⚠️ 文风知识库不可用（style-kb/cards 不存在，请在插件配置 styleKbDir 指向文风知识库根目录）\n\n') + r.message)
      },
    },
    async execute(args: Record<string, unknown>) {
      const a = args as {
        action?: string; projectId?: string; cards?: string[]; tag?: string; q?: string; enabled?: boolean
      }
      const action = a.action ?? 'list'
      // 输出 schema 的 bound 是 JsonValue[]（须为 fresh 字面量对象）
      const freshBound = (arr: StyleCardBinding[]): { key: string; enabled: boolean }[] => arr.map(b => ({ key: b.key, enabled: b.enabled }))
      if (!styleKb.available) {
        return {
          action, available: false,
          message: `文风知识库不可用：未找到 ${styleKb.cardsDirname}（配置 styleKbDir 指向 style-kb 根目录即可启用）。`,
        }
      }
      const resolveCards = (refs: string[]): { ok: string[]; miss: { ref: string; hint?: string }[] } => {
        const ok: string[] = []
        const miss: { ref: string; hint?: string }[] = []
        for (const ref of refs) {
          const r = styleKb.resolve(ref)
          if (r.matched) ok.push(r.key)
          else miss.push({ ref, hint: r.hint ?? '' })
        }
        return { ok, miss }
      }

      if (action === 'list') {
        const items = styleKb.list({ tag: a.tag, q: a.q })
        const cards = items.map(c => ({ key: c.key, title: c.title, tags: c.tags, kind: c.kind }))
        return {
          action, cards, available: true,
          message: `文风知识库共 ${styleKb.count} 张可绑定卡片，本次返回 ${items.length} 张${a.q || a.tag
            ? `（${a.tag ? 'tag=' + a.tag : ''}${a.tag && a.q ? '；' : ''}${a.q ? 'q=' + a.q : ''}）` : ''}。\n` +
            items.map(c => `- ${c.key}｜${c.title}${c.tags.length ? `（${c.tags.join('、')}）` : ''}`).join('\n') +
            '\n\n绑定用 key：novel_style_kb action=bind projectId=<id> cards=["<key>"]',
        }
      }

      if (!a.projectId) return { action, available: true, message: 'bind/unbind/set_enabled/get/preview 需要 projectId' }
      const data = store.load(a.projectId)
      const bindings: StyleCardBinding[] = Array.isArray(data.project.styleCards) ? data.project.styleCards.slice() : []

      if (action === 'get') {
        const resolved = bindings.map(b => {
          const card = styleKb.read(b.key)
          return { key: b.key, enabled: b.enabled, title: card?.title ?? '（卡片缺失）', tags: card?.tags ?? [] }
        })
        return {
          action, available: true, bound: resolved, cards: resolved,
          message: `《${data.project.name}》已绑定 ${resolved.length} 张文风卡：\n` +
            resolved.map(r => `- ${r.enabled ? '✓启用' : '○停用'} ${r.key}｜${r.title}`).join('\n') +
            (resolved.length ? '\n\n启用集合会在 novel_chapter_write 自动注入；可 bind 增加、set_enabled 切换、unbind 移除。' : '\n\n尚未绑定卡片，用 action=bind 添加（可多张）。'),
        }
      }

      if (action === 'bind') {
        const refs = Array.isArray(a.cards) ? a.cards.filter(x => typeof x === 'string') : []
        if (refs.length === 0) return { action, available: true, message: 'bind 需要 cards（一张或多张，key 或标题均可）' }
        const { ok, miss } = resolveCards(refs)
        const knownKeys = new Set(bindings.map(b => b.key))
        for (const key of ok) {
          if (!knownKeys.has(key)) bindings.push({ key, enabled: true })
          else { const b = bindings.find(x => x.key === key); if (b) b.enabled = true }
        }
        data.project.styleCards = bindings
        store.save(a.projectId)
        return {
          action, available: true, bound: freshBound(bindings), cards: freshBound(bindings),
          message: `已绑定 ${ok.length} 张${ok.length ? '：' + ok.join('、') : ''}${miss.length ? '\n未匹配：' + miss.map(m => m.ref + (m.hint ? `（${m.hint}）` : '')).join('；') : ''}\n` +
            `可用 novel_style_kb action=preview projectId=${a.projectId} 预览注入效果，或 action=get 查看绑定。`,
        }
      }

      if (action === 'unbind') {
        const refs = Array.isArray(a.cards) ? a.cards.filter(x => typeof x === 'string') : []
        const before = bindings.map(b => b.key)
        if (refs.length === 0) {
          // 不传 cards = 清空全部
          data.project.styleCards = []
          store.save(a.projectId)
          return { action, available: true, bound: [], message: `已清空《${data.project.name}》全部文风卡绑定。` }
        }
        const keysToDrop = new Set(refs.map(r => styleKb.resolve(r).key).filter(Boolean))
        const remaining = bindings.filter(b => !keysToDrop.has(b.key))
        data.project.styleCards = remaining
        store.save(a.projectId)
        return {
          action, available: true, bound: freshBound(remaining),
          message: `已解除 ${refs.length} 张（剩余 ${remaining.length}）：${before.filter(k => keysToDrop.has(k)).join('、') || '(无命中)'}`,
        }
      }

      if (action === 'set_enabled') {
        const refs = Array.isArray(a.cards) ? a.cards.filter(x => typeof x === 'string') : []
        if (refs.length === 0 || typeof a.enabled !== 'boolean') return { action, available: true, message: 'set_enabled 需要 cards + enabled(boolean)' }
        const { ok } = resolveCards(refs)
        let toggled = 0
        for (const key of ok) {
          const b = bindings.find(x => x.key === key)
          if (!b) { bindings.push({ key, enabled: a.enabled }); toggled++ }
          else if (b.enabled !== a.enabled) { b.enabled = a.enabled; toggled++ }
        }
        data.project.styleCards = bindings
        store.save(a.projectId)
        const enabledNow = bindings.filter(b => b.enabled).map(b => b.key)
        return {
          action, available: true, bound: freshBound(bindings),
          message: `已切换 ${toggled} 张为「${a.enabled ? '启用' : '停用'}」；当前启用 ${enabledNow.length} 张：${enabledNow.join('、') || '（无，生成将不注入文风卡）'}`,
        }
      }

      if (action === 'preview') {
        const active = bindings.filter(b => b.enabled).map(b => b.key)
        if (active.length === 0) return { action, available: true, message: `《${data.project.name}》当前没有启用的文风卡（可 set_enabled 启用，或用 styleCards 本次选用）。` }
        const preview = generator.styleCardBlocks(active, 700, 3) // 复刻生成注入的紧凑块（同 buildSystemPrompt）
        return {
          action, available: true, preview, bound: freshBound(bindings),
          message: `以下内容会注入《${data.project.name}》写作 system prompt（当前启用 ${active.length} 张，默认每张 ≤700 字符、最多 3 张）：`,
        }
      }

      return { action, available: true, message: `未知 action=${action}` }
    },
  }))

  return tools
}
