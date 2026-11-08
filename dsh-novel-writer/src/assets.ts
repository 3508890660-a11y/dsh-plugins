/**
 * 统一资产注册表：把立绘 / 插画 / 地图 / 配音登记成**项目资产**，
 * 而不是散落在各插件自己的 jobs.json、maps.json、voice-map.json 里。
 *
 * 存储：`projects/<pid>/assets.json`（与 data.json 分离——资产是高频增量、
 * 体积大，不参与小说正文的结构化事务，也不影响 revision）。
 *
 * 记录模型：
 *   assetId         `source:sourceId`（如 dsh-illustrator:ill-xxx）
 *   kind            portrait | illustration | map | voice | other
 *   characterId     可选，关联小说人物（不是角色名，改名不断链）
 *   chapterId/geoId 可选
 *   versions[]      同一对象的多次生成，按时间追加
 *   currentVersion  当前选用的版本索引（「设为当前立绘」）
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export type AssetKind = 'portrait' | 'illustration' | 'map' | 'voice' | 'other'

export const ASSET_KINDS: AssetKind[] = ['portrait', 'illustration', 'map', 'voice', 'other']

/** 单次生成的产物 */
export interface AssetVersion {
  /** 其它插件提供的相对 URL（同源可直接 <img src>） */
  url: string
  /** 本地文件绝对路径（配音等需要下载/播放的场景） */
  file?: string
  prompt?: string
  model?: string
  provider?: string
  size?: string
  note?: string
  createdAt: string
}

export interface AssetRecord {
  id: string
  kind: AssetKind
  title: string
  /** 写入方插件 id */
  source: string
  /** 写入方内部任务 id */
  sourceId: string
  characterId: string
  characterName: string
  chapterId: string
  geoId: string
  currentVersion: number
  versions: AssetVersion[]
  createdAt: string
  updatedAt: string
}

export interface AssetInput {
  id?: string
  kind?: string
  title?: string
  source?: string
  sourceId?: string
  characterId?: string
  characterName?: string
  chapterId?: string
  geoId?: string
  url?: string
  file?: string
  prompt?: string
  model?: string
  provider?: string
  size?: string
  note?: string
}

interface AssetFile {
  assets: AssetRecord[]
}

const MAX_VERSIONS = 30

function str(v: unknown, max = 400): string {
  return typeof v === 'string' ? v.slice(0, max) : ''
}

export class AssetStore {
  private dataDir: string

  constructor(dataDir: string) {
    this.dataDir = dataDir
  }

  private file(projectId: string): string {
    return join(this.dataDir, 'projects', projectId, 'assets.json')
  }

  private load(projectId: string): AssetFile {
    const f = this.file(projectId)
    if (!existsSync(f)) return { assets: [] }
    try {
      const j = JSON.parse(readFileSync(f, 'utf8')) as AssetFile
      return { assets: Array.isArray(j.assets) ? j.assets : [] }
    } catch {
      // 坏文件不阻断：下次写入重建
      return { assets: [] }
    }
  }

  private save(projectId: string, value: AssetFile): void {
    const f = this.file(projectId)
    mkdirSync(dirname(f), { recursive: true })
    const tmp = f + '.tmp'
    writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
    renameSync(tmp, f)
  }

  list(projectId: string, filter: { kind?: string; characterId?: string; chapterId?: string } = {}): AssetRecord[] {
    const all = this.load(projectId).assets
    return all
      .filter(a => (!filter.kind || a.kind === filter.kind)
        && (!filter.characterId || a.characterId === filter.characterId)
        && (!filter.chapterId || a.chapterId === filter.chapterId))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
  }

  /** 登记一次生成产物：同 id 追加版本，不同 id 新建 */
  upsert(projectId: string, input: AssetInput): AssetRecord {
    const kind = (ASSET_KINDS as string[]).includes(String(input.kind)) ? input.kind as AssetKind : 'other'
    const source = str(input.source, 80) || 'unknown'
    const sourceId = str(input.sourceId, 120)
    const id = str(input.id, 160) || `${source}:${sourceId || Date.now().toString(36)}`
    const now = new Date().toISOString()
    const j = this.load(projectId)
    let rec = j.assets.find(a => a.id === id)
    if (!rec) {
      rec = {
        id, kind, title: str(input.title, 120) || '未命名资产',
        source, sourceId,
        characterId: str(input.characterId, 120),
        characterName: str(input.characterName, 120),
        chapterId: str(input.chapterId, 120),
        geoId: str(input.geoId, 120),
        currentVersion: 0,
        versions: [],
        createdAt: now,
        updatedAt: now,
      }
      j.assets.push(rec)
    } else {
      // 元信息以最新一次为准（标题/章节等可能被补全），空值不覆盖已有
      if (input.title) rec.title = str(input.title, 120)
      if (input.characterId) rec.characterId = str(input.characterId, 120)
      if (input.characterName) rec.characterName = str(input.characterName, 120)
      if (input.chapterId) rec.chapterId = str(input.chapterId, 120)
      if (input.geoId) rec.geoId = str(input.geoId, 120)
    }

    const url = str(input.url, 800)
    const file = str(input.file, 800)
    if (url || file) {
      const exists = rec.versions.some(v => (url && v.url === url) || (file && v.file === file))
      if (!exists) {
        rec.versions.push({
          url, file,
          prompt: str(input.prompt, 4000),
          model: str(input.model, 120),
          provider: str(input.provider, 120),
          size: str(input.size, 40),
          note: str(input.note, 400),
          createdAt: now,
        })
        if (rec.versions.length > MAX_VERSIONS) rec.versions = rec.versions.slice(-MAX_VERSIONS)
        // 新版本默认成为当前版本（符合「刚生成的就是我要的」直觉，可再手动切换）
        rec.currentVersion = rec.versions.length - 1
      }
    }
    rec.updatedAt = now
    this.save(projectId, j)
    return rec
  }

  setCurrent(projectId: string, assetId: string, index: number): AssetRecord | null {
    const j = this.load(projectId)
    const rec = j.assets.find(a => a.id === assetId)
    if (!rec || !Number.isInteger(index) || index < 0 || index >= rec.versions.length) return null
    rec.currentVersion = index
    rec.updatedAt = new Date().toISOString()
    this.save(projectId, j)
    return rec
  }

  remove(projectId: string, assetId: string): boolean {
    const j = this.load(projectId)
    const before = j.assets.length
    j.assets = j.assets.filter(a => a.id !== assetId)
    if (j.assets.length === before) return false
    this.save(projectId, j)
    return true
  }

  /** 只清登记，不删源文件（源文件归各自插件管） */
  clearProject(projectId: string): void {
    this.save(projectId, { assets: [] })
  }
}
