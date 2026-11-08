/* eslint-disable */
// ⚠️ 自动生成，请勿直接修改。
// 源文件：shared/dsh-workbench-kit/src/workbench-context.ts
// 同步命令：node tools/sync-workbench-kit.mjs
/**
 * dsh-workbench-kit / workbench-context
 *
 * 跨面板共享的「当前项目 / 章节 / 角色」上下文。
 *
 * ⚠️ 本文件是唯一源文件，由 `tools/sync-workbench-kit.mjs` 复制到各插件的
 *    `src/client/workbench-context.ts`。**不要直接改插件里的副本**，
 *    改这里后跑：node tools/sync-workbench-kit.mjs
 *
 * 为什么不用插件间 API：面板可能被渲染在不同文档里，也可能同文档。
 *  - 同文档：localStorage 的 `storage` 事件不触发，用 CustomEvent；
 *  - 跨文档：CustomEvent 不跨文档，用 `storage` 事件。
 * 两条通道都监听，写入时都发，天然覆盖两种情况。
 */
import { useEffect, useState } from 'react'

export interface WorkbenchContext {
  projectId: string
  chapterId: string
  characterId: string
  characterName: string
  /** 最近一次写入的时间戳（ms） */
  updatedAt: number
  /** 写入方插件 id，用于避免自己写自己读的回环 */
  source: string
}

const STORAGE_KEY = 'dsh-workbench-ctx-v1'
const EVENT_NAME = 'dsh-workbench-ctx-change'

const EMPTY: WorkbenchContext = {
  projectId: '',
  chapterId: '',
  characterId: '',
  characterName: '',
  updatedAt: 0,
  source: '',
}

function normalize(raw: unknown): WorkbenchContext {
  if (!raw || typeof raw !== 'object') return { ...EMPTY }
  const o = raw as Record<string, unknown>
  const str = (v: unknown): string => (typeof v === 'string' ? v : '')
  return {
    projectId: str(o.projectId),
    chapterId: str(o.chapterId),
    characterId: str(o.characterId),
    characterName: str(o.characterName),
    updatedAt: typeof o.updatedAt === 'number' ? o.updatedAt : 0,
    source: str(o.source),
  }
}

/** 读取当前共享上下文（localStorage 不可用时返回空值） */
export function readContext(): WorkbenchContext {
  try {
    return normalize(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null'))
  } catch {
    return { ...EMPTY }
  }
}

/** 落盘 + 广播（内部使用） */
function commit(next: WorkbenchContext): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* 隐私模式/配额满：退化为仅同文档广播 */
  }
  try {
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: next }))
  } catch {
    /* 老环境无 CustomEvent 构造器 */
  }
}

/**
 * 切换「当前项目」：项目变了就顺带清空章节/角色。
 * 一次写入完成，避免先清后设产生两个中间态事件。
 */
export function setProjectContext(projectId: string, source: string): void {
  if (!projectId) return
  const cur = readContext()
  if (cur.projectId === projectId) return
  commit({
    ...cur,
    projectId,
    chapterId: '',
    characterId: '',
    characterName: '',
    updatedAt: Date.now(),
    source,
  })
}

/**
 * 合并写入共享上下文。
 * 只覆盖传入的非空字段；值无变化时不写、不发事件（避免面板之间来回刷）。
 */
export function patchContext(patch: Partial<WorkbenchContext>, source: string): void {
  const cur = readContext()
  const next: WorkbenchContext = { ...cur }
  let changed = false
  for (const key of ['projectId', 'chapterId', 'characterId', 'characterName'] as const) {
    const v = patch[key]
    if (typeof v === 'string' && v && v !== cur[key]) {
      next[key] = v
      changed = true
    }
  }
  if (!changed) return
  next.updatedAt = Date.now()
  next.source = source
  commit(next)
}

/** 清空章节/角色（例如切换项目时） */
export function clearContextFields(fields: Array<'chapterId' | 'characterId' | 'characterName'>, source: string): void {
  const cur = readContext()
  const next: WorkbenchContext = { ...cur }
  let changed = false
  for (const f of fields) {
    if (next[f]) {
      next[f] = ''
      changed = true
    }
  }
  if (!changed) return
  next.updatedAt = Date.now()
  next.source = source
  commit(next)
}

/** 订阅共享上下文变化，返回取消订阅函数 */
export function subscribeContext(fn: (ctx: WorkbenchContext) => void): () => void {
  const onCustom = (e: Event): void => {
    const detail = (e as CustomEvent).detail
    fn(detail ? normalize(detail) : readContext())
  }
  const onStorage = (e: StorageEvent): void => {
    if (e.key !== null && e.key !== STORAGE_KEY) return
    fn(readContext())
  }
  window.addEventListener(EVENT_NAME, onCustom)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(EVENT_NAME, onCustom)
    window.removeEventListener('storage', onStorage)
  }
}

/**
 * React hook：拿到共享上下文，并在其他面板改动时重渲染。
 * `source` 用于标记本面板写入来源；返回的第二个值是写入函数。
 */
export function useWorkbenchContext(source: string): [WorkbenchContext, (patch: Partial<WorkbenchContext>) => void] {
  const [ctx, setCtx] = useState<WorkbenchContext>(() => readContext())
  useEffect(() => subscribeContext(setCtx), [])
  const publish = (patch: Partial<WorkbenchContext>): void => patchContext(patch, source)
  return [ctx, publish]
}
