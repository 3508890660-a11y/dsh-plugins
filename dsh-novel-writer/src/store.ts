/**
 * 数据持久化：每项目一个目录 dataDir/projects/<id>/，
 * data.json 存全部结构化数据（大纲/伏笔/人物/世界观/章节记忆），chapters/<id>.md 存正文。
 * 内存缓存 + 原子写（tmp + rename）。
 */
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import type { ChapterRecord, GeoEntry, ItemRecord, OutlineNode, OutlineStatus, ProjectData, ProjectMeta, WorldviewEntry } from './types.js'
import { nowIso, chapterVolume } from './types.js'
import { writeProjectFile } from './project-contract.js'

/** 大纲节点删除时对章节正文的处理方式 */
export type OutlineDeleteMode = 'outline' | 'archive' | 'purge'

/** 孤儿章节（有正文/记录，但大纲里已没有对应节点） */
export interface OrphanChapter {
  id: string
  title: string
  wordCount: number
  hasRecord: boolean
  hasContent: boolean
  updatedAt: string
}

/**
 * 旧数据 quality 过滤：历史上被归为 geography 的条目分两类——
 * 真地理（大陆/山脉/水系/城市/区域）→ 迁入独立 geo 库；
 * 力量/图鉴类（魔脉/魔兽/地城/格局）→ 保留在 worldview（不属于地图要素）。
 * 判据：标题为主（标题含地理词 → 迁；含图鉴/格局/结构等负信号 → 留），
 * 内容仅作强句式兜底（“位于/地处/国境…”开头），避免把规则描述里的泛词误判为地理。
 */
const GEO_TITLE_HIT = /大陆|山脉|山系|河流|湖泊|海域|群岛|地形|区域划分|基本盘|地理与|政体|平原|高原|沙漠|森林|草原|城市|国家|地带|谷地|沿海|气候/
const GEO_TITLE_NEG = /图鉴|力量格局|总览|一览|巡礼|结构|形态|现象|生态|经济|分布|种类|介绍|说明|崇拜|风俗/
const GEO_CONTENT_HIT = /^(河间|位于|地处|国境|边境|坐落在|横亘)/

function isRealGeo(e: WorldviewEntry): boolean {
  const title = e.title.trim()
  if (GEO_TITLE_NEG.test(title)) return false
  if (GEO_TITLE_HIT.test(title)) return true
  // 标题无信号：看正文开头 40 字是否强地理句式（不在标题泛词上做文章）
  return GEO_CONTENT_HIT.test(e.content.trim().slice(0, 40))
}

export class Store {
  private dataDir: string
  private cache: Map<string, ProjectData> = new Map()
  /**
   * 每项目 data.json 的磁盘指纹（mtime:size）。
   * 其他插件（character-maker / mapforge / 手工编辑）会直写 data.json，
   * 本进程缓存必须据此失效，否则会出现「界面显示旧值」以及
   * 「小说工坊再次保存时用旧缓存覆盖别人刚写入的数据」。
   */
  private stamps: Map<string, string> = new Map()
  /**
   * 每个项目「上次从磁盘读到的 revision」。
   * save() 以它做 CAS：若期间有别的插件写入（revision 已推进），
   * 直接抛 ProjectConflictError → 路由返回 409，而不是静默覆盖。
   */
  private revs: Map<string, number> = new Map()

  constructor(dataDir: string) {
    this.dataDir = dataDir
    mkdirSync(join(dataDir, 'projects'), { recursive: true })
  }

  private projectDir(projectId: string): string {
    return join(this.dataDir, 'projects', projectId)
  }

  private dataFile(projectId: string): string {
    return join(this.projectDir(projectId), 'data.json')
  }

  /** 磁盘指纹（读不到返回空串） */
  private stampOf(path: string): string {
    try {
      const st = statSync(path)
      return `${Math.round(st.mtimeMs)}:${st.size}`
    } catch { return '' }
  }

  /** 原子写 JSON + 同步磁盘指纹 */
  private persist(projectId: string, value: ProjectData): void {
    const path = this.dataFile(projectId)
    const tmp = path + '.tmp'
    writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
    renameSync(tmp, path)
    this.stamps.set(projectId, this.stampOf(path))
  }

  /** 创建项目 */
  createProject(meta: ProjectMeta): ProjectData {
    const dir = this.projectDir(meta.id)
    mkdirSync(join(dir, 'chapters'), { recursive: true })
    const data: ProjectData = { project: meta, outline: [], foreshadowings: [], characters: [], worldview: [], geo: [], items: [], chapters: [] }
    if (!Array.isArray(data.project.styleCards)) data.project.styleCards = []
    if (typeof (data.project as { revision?: number }).revision !== 'number') (data.project as { revision?: number }).revision = 0
    this.cache.set(meta.id, data)
    this.revs.set(meta.id, (data.project as { revision?: number }).revision ?? 0)
    this.persist(meta.id, data)
    return data
  }

  /** 列出全部项目（按创建时间） */
  listProjects(): ProjectMeta[] {
    const root = join(this.dataDir, 'projects')
    const out: ProjectMeta[] = []
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const f = join(root, entry.name, 'data.json')
      if (!existsSync(f)) continue
      try {
        const data = this.load(entry.name)
        out.push(data.project)
      } catch { /* 损坏项目跳过 */ }
    }
    return out.sort((a, b) => a.createdAt < b.createdAt ? -1 : 1)
  }

  /** 加载项目（带缓存 + 磁盘指纹校验）；加载后迁移：卷归属推导 + 世界观地理拆分为独立 geo 库 */
  load(projectId: string): ProjectData {
    const f = this.dataFile(projectId)
    const stamp = this.stampOf(f)
    const cached = this.cache.get(projectId)
    if (cached) {
      if (stamp && this.stamps.get(projectId) === stamp) {
        this.migrateVolumes(cached)
        this.migrateGeo(cached)
        return cached
      }
      // 磁盘已被外部改动 → 丢弃旧缓存重读，避免用过期数据覆盖新写入
      this.cache.delete(projectId)
      this.stamps.delete(projectId)
    }
    if (!existsSync(f)) throw new Error(`项目不存在: ${projectId}`)
    const data = JSON.parse(readFileSync(f, 'utf8')) as ProjectData
    if (!Array.isArray(data.project?.styleCards)) data.project.styleCards = []
    if (typeof (data.project as { revision?: number }).revision !== 'number') (data.project as { revision?: number }).revision = 0
    this.migrateVolumes(data)
    this.migrateGeo(data)
    this.cache.set(projectId, data)
    const st = statSync(f)
    this.stamps.set(projectId, `${Math.round(st.mtimeMs)}:${st.size}`)
    this.revs.set(projectId, (data.project as { revision?: number }).revision ?? 0)
    return data
  }

  /** 项目修订号：任何保存/外部写回都会递增（data.json 的 project.revision） */
  revisionOf(projectId: string): number {
    const d = this.load(projectId)
    const rev = (d.project as { revision?: number }).revision
    return typeof rev === 'number' ? rev : 0
  }

  /** ChapterRecord.volumeId 从大纲推导回填（旧数据迁移；大纲 chapter 节点 parentId → volume 节点） */
  private migrateVolumes(data: ProjectData): void {
    if (!Array.isArray(data.chapters)) data.chapters = []
    for (const rec of data.chapters) {
      const vol = chapterVolume(data, rec.id)
      const vid = vol ? vol.id : null
      if (rec.volumeId !== vid) rec.volumeId = vid
    }
  }

  /** 旧数据迁移：worldview.geography 条目 → 独立 geo 库（保留 id/名称/内容，类型归 other；原条目从 worldview 移除）。
   *  幂等：geo 已存在同名/同 id 条目或 worldview 已无 geography 时跳过。
   *  迁移即落盘（mapforge 等外部读者直读磁盘 data.json，需立即可见）。
   *  ⚠️ 落盘用 writeJson 直写（不经过 save→load：load 在 cache.set 前重读磁盘会导致递归迁移）。
   *  二次校正：首轮迁移把非地理条目（图鉴/格局类）也搬进了 geo——这批搬回 worldview（category=geography），
   *  保证 geo 库是纯地图要素（供地图插件精确标注）。 */
  private migrateGeo(data: ProjectData): void {
    if (!Array.isArray(data.geo)) data.geo = []
    if (!Array.isArray(data.items)) data.items = []
    if (!Array.isArray(data.worldview)) data.worldview = []

    // ① 二次校正：geo 里的非地理条目搬回 worldview。
    //    仅针对迁移来源条目（旧 worldview 的 id 前缀 w-——迁移保留原 id）；
    //    用户手动创建的 geo（id 前缀 g-）一律保留，不参与校正。
    const backToWorld: GeoEntry[] = []
    const keptGeo: GeoEntry[] = []
    for (const g of data.geo) {
      if (!g.id.startsWith('w-')) { keptGeo.push(g); continue }
      const wv: WorldviewEntry = { id: g.id, projectId: g.projectId, category: 'geography', title: g.name, content: g.description, createdAt: g.createdAt, updatedAt: g.updatedAt }
      if (isRealGeo(wv)) keptGeo.push(g)
      else backToWorld.push(g)
    }
    let changed = false
    if (backToWorld.length > 0) {
      for (const g of backToWorld) {
        if (data.worldview.some(w => w.id === g.id || w.title === g.name)) continue
        data.worldview.push({ id: g.id, projectId: g.projectId, category: 'geography', title: g.name, content: g.description, createdAt: g.createdAt, updatedAt: g.updatedAt })
        changed = true
      }
      data.geo = keptGeo
    }

    // ② 首轮迁移：worldview.geography → geo（仅真地理条目；非地理留在 worldview）
    const oldGeo = data.worldview.filter(w => w.category === 'geography')
    const existing = new Set(data.geo.map(g => g.id))
    let migrated = false
    for (const w of oldGeo) {
      if (!isRealGeo(w)) continue
      if (existing.has(w.id)) continue
      // 沿用 WorldviewEntry 的时间戳，id 不变（外部引用/伏笔不失效）
      const g: GeoEntry = {
        id: w.id, projectId: w.projectId, name: w.title, aliases: [],
        type: 'other', description: w.content, mapX: null, mapY: null,
        createdAt: w.createdAt, updatedAt: w.updatedAt,
      }
      data.geo.push(g)
      data.worldview = data.worldview.filter(x => x.id !== w.id) // 已迁走的从 worldview 移除
      migrated = true
    }
    if (changed || migrated) {
      console.info(`[novel-writer] 地理库校正 ${data.project.name}: geo=${data.geo.length} 条（搬回世界观 ${changed ? backToWorld.length : 0} 条 / 新迁移 ${migrated ? oldGeo.length : 0} 条）`)
      this.persist(data.project.id, data)
    }
  }

  /**
   * 保存项目结构化数据（统一写入契约）。
   * - 走 project-contract：文件锁内比对 revision，冲突抛 ProjectConflictError（路由 → 409）；
   * - revision 由契约统一 +1，内存缓存同步更新，外部轮询据此刷新。
   * @param opts.expectedRevision 显式指定基线（默认用上次 load 读到的 revision）
   */
  save(projectId: string, opts: { expectedRevision?: number } = {}): number {
    const data = this.load(projectId)
    data.project.updatedAt = nowIso()
    const expected = typeof opts.expectedRevision === 'number' ? opts.expectedRevision : this.revs.get(projectId)
    const r = writeProjectFile(this.dataDir, projectId, data as unknown as Record<string, any>, {
      expectedRevision: expected,
      source: 'dsh-novel-writer',
    })
    this.revs.set(projectId, r.revision)
    this.stamps.set(projectId, this.stampOf(this.dataFile(projectId)))
    return r.revision
  }

  /** 章节正文存取 */
  chapterFile(projectId: string, chapterId: string): string {
    return join(this.projectDir(projectId), 'chapters', chapterId + '.md')
  }

  readChapterContent(projectId: string, chapterId: string): string {
    const f = this.chapterFile(projectId, chapterId)
    return existsSync(f) ? readFileSync(f, 'utf8') : ''
  }

  writeChapterContent(projectId: string, chapterId: string, content: string): void {
    const f = this.chapterFile(projectId, chapterId)
    mkdirSync(dirname(f), { recursive: true })
    const tmp = f + '.tmp'
    writeFileSync(tmp, content, 'utf8')
    renameSync(tmp, f)
  }

  /** 章节原文备份（AI 润色落盘前调用）：chapters/backup/<chapterId>-<ts>.md */
  writeChapterBackup(projectId: string, chapterId: string, content: string): string {
    const dir = join(this.projectDir(projectId), 'chapters', 'backup')
    mkdirSync(dir, { recursive: true })
    const f = join(dir, `${chapterId}-${Date.now()}.md`)
    writeFileSync(f, content, 'utf8')
    return f
  }

  /** 导出目录 */
  exportDir(projectId: string): string {
    const dir = join(this.projectDir(projectId), 'exports')
    mkdirSync(dir, { recursive: true })
    return dir
  }

  /** 已导出文件清单（UI 下载区） */
  listExports(projectId: string): { file: string; size: number; mtime: string }[] {
    const dir = this.exportDir(projectId)
    const out: { file: string; size: number; mtime: string }[] = []
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isFile()) continue
      try {
        const st = statSync(join(dir, e.name))
        out.push({ file: e.name, size: st.size, mtime: new Date(st.mtimeMs).toISOString() })
      } catch { /* 读不到的文件跳过 */ }
    }
    return out.sort((a, b) => (a.mtime < b.mtime ? 1 : -1))
  }

  /** 正文归档目录（删除大纲节点时把正文移到这里，可人工找回） */
  private archiveDir(projectId: string): string {
    return join(this.projectDir(projectId), 'chapters', 'archive')
  }

  /**
   * 删除大纲节点（含其全部后代）。
   * mode:
   *   outline —— 只删大纲，正文与章节记录保留（成为「孤儿章节」，可在面板恢复）
   *   archive —— 删除章节记录，正文移到 chapters/archive/（默认，可找回）
   *   purge   —— 删除章节记录 + 正文（不可恢复）
   */
  deleteOutlineNode(projectId: string, nodeId: string, mode: OutlineDeleteMode = 'archive'): {
    removedNodes: number
    chapters: string[]
    archived: string[]
    purged: string[]
  } | null {
    const data = this.load(projectId)
    if (!data.outline.some(n => n.id === nodeId)) return null
    const removed = new Set<string>([nodeId])
    let grew = true
    while (grew) {
      grew = false
      for (const n of data.outline) {
        if (!removed.has(n.id) && n.parentId && removed.has(n.parentId)) {
          removed.add(n.id)
          grew = true
        }
      }
    }
    const chapterIds = data.outline.filter(n => removed.has(n.id) && n.type === 'chapter').map(n => n.id)
    data.outline = data.outline.filter(n => !removed.has(n.id))
    const archived: string[] = []
    const purged: string[] = []
    if (mode !== 'outline' && chapterIds.length > 0) {
      const keep: ChapterRecord[] = []
      for (const rec of data.chapters) {
        if (!chapterIds.includes(rec.id)) { keep.push(rec); continue }
        const f = this.chapterFile(projectId, rec.id)
        if (existsSync(f)) {
          if (mode === 'archive') {
            const dir = this.archiveDir(projectId)
            mkdirSync(dir, { recursive: true })
            const dest = join(dir, `${rec.id}-${Date.now()}.md`)
            renameSync(f, dest)
            archived.push(dest)
          } else {
            rmSync(f, { force: true })
            purged.push(f)
          }
        }
      }
      data.chapters = keep
    }
    this.save(projectId)
    return { removedNodes: removed.size, chapters: chapterIds, archived, purged }
  }

  /** 孤儿章节：有正文或章节记录，但大纲里已无对应 chapter 节点 */
  listOrphans(projectId: string): OrphanChapter[] {
    const data = this.load(projectId)
    const outlineIds = new Set(data.outline.filter(n => n.type === 'chapter').map(n => n.id))
    const recById = new Map(data.chapters.map(c => [c.id, c]))
    const ids = new Set<string>()
    for (const c of data.chapters) if (!outlineIds.has(c.id)) ids.add(c.id)
    const dir = join(this.projectDir(projectId), 'chapters')
    if (existsSync(dir)) {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (!e.isFile() || !e.name.endsWith('.md')) continue
        const id = e.name.slice(0, -3)
        if (!outlineIds.has(id)) ids.add(id)
      }
    }
    const out: OrphanChapter[] = []
    for (const id of ids) {
      const rec = recById.get(id)
      const content = this.readChapterContent(projectId, id)
      if (!rec && !content) continue
      out.push({
        id,
        title: rec?.title ?? id,
        wordCount: rec?.wordCount ?? content.replace(/\s/g, '').length,
        hasRecord: !!rec,
        hasContent: !!content,
        updatedAt: rec?.updatedAt ?? '',
      })
    }
    return out.sort((a, b) => (a.title < b.title ? -1 : 1))
  }

  /** 把孤儿章节恢复到大纲（可指定卷与章序；缺记录时按正文补一条） */
  restoreOrphan(
    projectId: string,
    chapterId: string,
    opts: { volumeId?: string | null; title?: string; order?: number } = {},
  ): { ok: boolean; message: string; node?: OutlineNode } {
    const data = this.load(projectId)
    if (data.outline.some(n => n.id === chapterId)) return { ok: false, message: '大纲中已存在同 id 的节点' }
    const rec = data.chapters.find(c => c.id === chapterId)
    const content = this.readChapterContent(projectId, chapterId)
    if (!rec && !content) return { ok: false, message: '找不到该章节的正文或记录' }
    const volumeId = opts.volumeId && data.outline.some(n => n.id === opts.volumeId && n.type === 'volume')
      ? opts.volumeId
      : null
    const siblings = data.outline.filter(n => n.type === 'chapter' && (n.parentId ?? null) === volumeId)
    const order = typeof opts.order === 'number' && opts.order > 0
      ? opts.order
      : (siblings.length ? Math.max(...siblings.map(n => n.order)) + 1 : 1)
    const node: OutlineNode = {
      id: chapterId,
      projectId,
      type: 'chapter',
      title: (opts.title ?? rec?.title ?? chapterId).slice(0, 100),
      summary: rec?.summary ?? '',
      parentId: volumeId,
      order,
      status: (rec?.status === 'final' ? 'done' : 'writing') as OutlineStatus,
      beats: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }
    data.outline.push(node)
    if (rec) {
      rec.volumeId = volumeId
      rec.updatedAt = nowIso()
    } else {
      const now = nowIso()
      data.chapters.push({
        id: chapterId, projectId, title: node.title, order: node.order,
        status: 'draft', wordCount: content.replace(/\s/g, '').length, volumeId,
        summary: '', events: [], characterUpdates: [], items: [],
        foreshadowingPlanted: [], foreshadowingResolved: [], createdAt: now, updatedAt: now,
      })
    }
    this.save(projectId)
    return { ok: true, message: '已恢复到大纲', node }
  }

  /** 删除项目 */
  deleteProject(projectId: string): void {
    this.cache.delete(projectId)
    this.stamps.delete(projectId)
    rmSync(this.projectDir(projectId), { recursive: true, force: true })
  }
}
