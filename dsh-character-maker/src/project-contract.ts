/* eslint-disable */
// ⚠️ 自动生成，请勿直接修改。
// 源文件：shared/dsh-workbench-kit/src/project-contract.ts
// 同步命令：node tools/sync-workbench-kit.mjs
/**
 * dsh-workbench-kit / project-contract
 *
 * 小说项目 `data.json` 的**唯一写入契约**。所有插件（小说工坊、角色工作坊、地图、配音…）
 * 都必须经由本模块读写，禁止再各自 `writeFileSync(dataFile)`。
 *
 * 解决三个问题：
 *  1. 丢失更新：读-改-写全部在文件锁内基于**最新盘面**完成，补丁不会覆盖别人刚写的字段；
 *  2. 静默覆盖：写前比对 `project.revision`，不匹配抛 ProjectConflictError（HTTP 层映射 409）；
 *  3. 修订号唯一来源：每次成功写入 revision 自增，外部轮询据此刷新界面。
 *
 * 锁：`data.json.lock`（O_EXCL 创建）。持有者崩溃留下的陈旧锁按 mtime 超过 15s 回收。
 * 同步 API（插件路由是同步风格），等待用 Atomics.wait 实现，不阻塞事件循环以外的语义。
 *
 * ⚠️ 自动生成到各插件，源文件在 shared/dsh-workbench-kit/src/project-contract.ts。
 */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** 项目文件快照 */
export interface ProjectFileState {
  data: Record<string, any>
  /** data.json 的 project.revision（缺失按 0） */
  revision: number
  mtimeMs: number
  size: number
}

/** 写入冲突：调用方读到的版本已被别人推进 */
export class ProjectConflictError extends Error {
  readonly code = 'revision_conflict'
  readonly expected: number
  readonly current: number
  constructor(expected: number, current: number) {
    super(`项目已被其他插件修改（期望 revision ${expected}，磁盘为 ${current}），请刷新后重试`)
    this.name = 'ProjectConflictError'
    this.expected = expected
    this.current = current
  }
}

const LOCK_STALE_MS = 15_000
const LOCK_TIMEOUT_MS = 4_000

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

export function projectDataFile(dataDir: string, projectId: string): string {
  return join(dataDir, 'projects', projectId, 'data.json')
}

function lockPathOf(dataFile: string): string {
  return dataFile + '.lock'
}

/** 取锁，返回释放函数 */
function acquireLock(dataFile: string): () => void {
  const lp = lockPathOf(dataFile)
  mkdirSync(dirname(lp), { recursive: true })
  const deadline = Date.now() + LOCK_TIMEOUT_MS
  for (;;) {
    try {
      const fd = openSync(lp, 'wx')
      try { writeFileSync(fd, `${process.pid}:${Date.now()}`) } finally { closeSync(fd) }
      return () => { try { unlinkSync(lp) } catch { /* 已被回收 */ } }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
      try {
        const st = statSync(lp)
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
          rmSync(lp, { force: true })
          continue
        }
      } catch { /* 锁刚被释放，重试 */ }
      if (Date.now() > deadline) {
        throw new Error('项目文件被其他进程占用（等待 4s 超时），请稍后重试')
      }
      sleepSync(20)
    }
  }
}

function parseState(raw: string, mtimeMs: number, size: number): ProjectFileState {
  const data = JSON.parse(raw) as Record<string, any>
  if (!data || typeof data !== 'object') throw new Error('data.json 结构非法')
  if (!data.project || typeof data.project !== 'object') data.project = {}
  const rev = (data.project as { revision?: unknown }).revision
  return { data, revision: typeof rev === 'number' && Number.isFinite(rev) ? rev : 0, mtimeMs, size }
}

/** 读取项目文件（不加锁，用于展示；写入请用 mutate/write） */
export function readProjectFile(dataDir: string, projectId: string): ProjectFileState {
  const f = projectDataFile(dataDir, projectId)
  if (!existsSync(f)) throw new Error(`项目不存在: ${projectId}`)
  const st = statSync(f)
  return parseState(readFileSync(f, 'utf8'), st.mtimeMs, st.size)
}

function atomicWriteJson(file: string, value: unknown): void {
  const tmp = file + '.tmp'
  writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
  renameSync(tmp, file)
}

export interface WriteOptions {
  /** 期望的起始 revision；提供且不匹配则抛 ProjectConflictError */
  expectedRevision?: number
  /** 写入方标识，仅用于日志/排障 */
  source?: string
  /** false = 不改 project.updatedAt（迁移类写入） */
  touch?: boolean
}

/**
 * 读-改-写：在锁内基于**最新盘面**应用 mutator，成功后 revision+1。
 * 补丁型写入（改某个人物/某条地理）一律用这个，避免整包覆盖。
 */
export function mutateProjectFile<T>(
  dataDir: string,
  projectId: string,
  mutator: (data: Record<string, any>, ctx: { revision: number }) => T,
  opts: WriteOptions = {},
): { result: T; revision: number } {
  const f = projectDataFile(dataDir, projectId)
  const release = acquireLock(f)
  try {
    if (!existsSync(f)) throw new Error(`项目不存在: ${projectId}`)
    const st = statSync(f)
    const state = parseState(readFileSync(f, 'utf8'), st.mtimeMs, st.size)
    if (typeof opts.expectedRevision === 'number' && state.revision !== opts.expectedRevision) {
      throw new ProjectConflictError(opts.expectedRevision, state.revision)
    }
    const result = mutator(state.data, { revision: state.revision })
    const nextRev = state.revision + 1
    const project = state.data.project as { revision?: number; updatedAt?: string }
    project.revision = nextRev
    if (opts.touch !== false) project.updatedAt = new Date().toISOString()
    atomicWriteJson(f, state.data)
    return { result, revision: nextRev }
  } finally {
    release()
  }
}

/**
 * 整包写入（小说工坊 Store.save 专用）：以 CAS 保护，revision 统一由本模块推进。
 * `data` 会被就地更新 revision 字段，调用方的内存缓存因此保持同步。
 */
export function writeProjectFile(
  dataDir: string,
  projectId: string,
  data: Record<string, any>,
  opts: WriteOptions = {},
): { revision: number } {
  const f = projectDataFile(dataDir, projectId)
  const release = acquireLock(f)
  try {
    if (!existsSync(f)) throw new Error(`项目不存在: ${projectId}`)
    const st = statSync(f)
    const state = parseState(readFileSync(f, 'utf8'), st.mtimeMs, st.size)
    if (typeof opts.expectedRevision === 'number' && state.revision !== opts.expectedRevision) {
      throw new ProjectConflictError(opts.expectedRevision, state.revision)
    }
    const nextRev = state.revision + 1
    const project = data.project as { revision?: number; updatedAt?: string }
    project.revision = nextRev
    if (opts.touch !== false) project.updatedAt = new Date().toISOString()
    atomicWriteJson(f, data)
    return { revision: nextRev }
  } finally {
    release()
  }
}
