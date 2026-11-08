/**
 * novel-editor 精简项目数据访问：与 dsh-novel-writer 的 Store 数据布局互通，
 * 但不 import 其内部实现（保持插件独立）。
 * 布局：dataDir/projects/<id>/data.json（结构化）、chapters/<id>.md（正文）、chapters/backup/<id>-<ts>.md（备份）。
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'

export interface ProjectMeta {
  id: string
  name: string
  genre?: string
  style?: string
  createdAt?: string
  updatedAt?: string
  chapterCount?: number
}

export interface CharacterBrief {
  name: string
  aliases: string[]
  role?: string
  personality?: string
  goal?: string
  background?: string
}

/** 宽松的项目结构（只取 novel-editor 需要的字段） */
export interface ProjectData {
  project: { id: string; name: string; genre?: string; style?: string; createdAt?: string; updatedAt?: string }
  outline: unknown[]
  chapters: { id: string; title: string; order?: number }[]
  characters: CharacterBrief[]
  [key: string]: unknown
}

export class MiniStore {
  constructor(private dataDir: string) {
    mkdirSync(join(dataDir, 'projects'), { recursive: true })
  }

  private projectDir(projectId: string): string {
    return join(this.dataDir, 'projects', projectId)
  }

  private dataFile(projectId: string): string {
    return join(this.projectDir(projectId), 'data.json')
  }

  /** 列出全部项目（无正文的项目排除） */
  listProjects(): ProjectMeta[] {
    const root = join(this.dataDir, 'projects')
    const out: ProjectMeta[] = []
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const f = join(root, entry.name, 'data.json')
      if (!existsSync(f)) continue
      try {
        const data = JSON.parse(readFileSync(f, 'utf8')) as ProjectData
        out.push({
          id: data.project.id,
          name: data.project.name,
          genre: data.project.genre,
          style: data.project.style,
          createdAt: data.project.createdAt,
          updatedAt: data.project.updatedAt,
          chapterCount: Array.isArray(data.chapters) ? data.chapters.length : 0,
        })
      } catch { /* 损坏项目跳过 */ }
    }
    return out.sort((a, b) => (a.createdAt ?? '') < (b.createdAt ?? '') ? -1 : 1)
  }

  load(projectId: string): ProjectData {
    const f = this.dataFile(projectId)
    if (!existsSync(f)) throw new Error(`项目不存在: ${projectId}`)
    return JSON.parse(readFileSync(f, 'utf8')) as ProjectData
  }

  /** 章节正文（与 dsh-novel-writer store.chapterFile 一致） */
  chapterFile(projectId: string, chapterId: string): string {
    return join(this.projectDir(projectId), 'chapters', chapterId + '.md')
  }

  readChapterContent(projectId: string, chapterId: string): string {
    const f = this.chapterFile(projectId, chapterId)
    return existsSync(f) ? readFileSync(f, 'utf8') : ''
  }

  /** 原子写正文（tmp + rename，与 dsh-novel-writer 相同策略，避免半写） */
  writeChapterContent(projectId: string, chapterId: string, content: string): void {
    const f = this.chapterFile(projectId, chapterId)
    mkdirSync(dirname(f), { recursive: true })
    const tmp = f + '.tmp'
    writeFileSync(tmp, content, 'utf8')
    renameSync(tmp, f)
  }

  /** 原文备份：chapters/backup/<chapterId>-<ts>.md，返回备份路径 */
  writeChapterBackup(projectId: string, chapterId: string, content: string): string {
    const dir = join(this.projectDir(projectId), 'chapters', 'backup')
    mkdirSync(dir, { recursive: true })
    const f = join(dir, `${chapterId}-${Date.now()}.md`)
    writeFileSync(f, content, 'utf8')
    return f
  }
}
