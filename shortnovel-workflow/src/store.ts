/**
 * shortnovel-workflow 数据持久化：每项目一目录 dataDir/shortnovel/<id>/data.json。
 * 原子写（tmp + rename），内存缓存。
 */
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { ShortNovelProject, ProjectMeta } from './types.js'
import { nowIso, wordCountOf } from './types.js'

export class ShortNovelStore {
  private dataDir: string
  private cache: Map<string, ShortNovelProject> = new Map()

  constructor(dataDir: string) {
    this.dataDir = dataDir
    mkdirSync(join(dataDir, 'shortnovel'), { recursive: true })
  }

  private projectDir(id: string): string {
    return join(this.dataDir, 'shortnovel', id)
  }

  private dataFile(id: string): string {
    return join(this.projectDir(id), 'data.json')
  }

  private writeJson(path: string, value: unknown): void {
    const tmp = path + '.tmp'
    writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
    renameSync(tmp, path)
  }

  createProject(meta: {
    id: string; topic: string; genre: string; style: string; title: string; targetChars: number
  }): ShortNovelProject {
    const dir = this.projectDir(meta.id)
    mkdirSync(dir, { recursive: true })
    const data: ShortNovelProject = {
      id: meta.id,
      topic: meta.topic,
      genre: meta.genre,
      style: meta.style,
      title: meta.title,
      stage: 'brainstorm',
      content: {},
      styleCards: [],
      novelParts: [],
      goals: [],
      targetChars: meta.targetChars,
      done: false,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }
    this.writeJson(this.dataFile(meta.id), data)
    this.cache.set(meta.id, data)
    return data
  }

  listProjects(): ProjectMeta[] {
    const root = join(this.dataDir, 'shortnovel')
    const out: ProjectMeta[] = []
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const f = join(root, entry.name, 'data.json')
      if (!existsSync(f)) continue
      try {
        const p = this.load(entry.name)
        out.push({
          id: p.id, topic: p.topic, title: p.title, genre: p.genre,
          stage: p.stage, done: p.done, wordCount: wordCountOf(p),
          createdAt: p.createdAt, updatedAt: p.updatedAt,
        })
      } catch { /* 损坏项目跳过 */ }
    }
    return out.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
  }

  load(id: string): ShortNovelProject {
    const cached = this.cache.get(id)
    if (cached) return cached
    const f = this.dataFile(id)
    if (!existsSync(f)) throw new Error(`短篇小说项目不存在: ${id}`)
    const data = JSON.parse(readFileSync(f, 'utf8')) as ShortNovelProject
    this.cache.set(id, data)
    return data
  }

  save(id: string): void {
    const p = this.load(id)
    p.updatedAt = nowIso()
    this.writeJson(this.dataFile(id), p)
  }

  delete(id: string): void {
    this.cache.delete(id)
    rmSync(this.projectDir(id), { recursive: true, force: true })
  }
}
