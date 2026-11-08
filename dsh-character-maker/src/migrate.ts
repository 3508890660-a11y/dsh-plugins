/**
 * §8.2 数据 schema 迁移：把旧版 dsh-character-maker 写出的 characters.json
 * 迁移到当前 schemaVersion（见 store.ts 的 SCHEMA_VERSION）。
 *
 * 旧数据的典型漂移（技术分析 §8.2）：
 *  - `enneagram` 文案与当前知识库不一致（5 号 virtue「放下 / 清明」vs 现「超然 / 知足」、
 *    wingNick「思想家」vs 现「反传统者」、subtypeLabel「知己(反)」等）；
 *  - 多出 `persona` / `keywords` 等新代码不读不写的遗留字段；
 *  - `enneagram.presence/catchphrase/triggers/stressResponse/growthResponse` 五个字段
 *    新代码只读不写（旧数据里有、新写入路径缺失）；
 *  - 缺 9 级细分的 `levelBand` 之外的 `levelName`。
 *
 * 迁移策略：**保留用户自由文本与实测数据，重推导知识库派生字段**。
 *  - 保留：name/role/appearance/background/goal/stateNotes、mbti/bigfive/testsNote、
 *          library（六节画像）、source（novel 联动）、id/时间戳、ipipFacets/scales、作答实测标记。
 *  - 重推导：enneagram 的知识库文案（coreName/coreEn/center/fear/desire/traits/virtue/vice、
 *            箭头/wingNick/subtype/levelBand/levelName）+ behaviors/arcAdvice 模板。
 *  - 迁移掉：persona/keywords 等遗留字段挪进 `library.legacy`（不丢数据但不污染模型）。
 */
import type { CharacterModel, CharacterRole, Subtype } from './types.js'
import { buildCharacterModel, levelInfo } from './engine.js'

const ROLES: CharacterRole[] = ['protagonist', 'supporting', 'antagonist', 'minor']
const SUBTYPES: Subtype[] = ['sp', 'sx', 'so']

/**
 * 幂等「自愈」：补齐后续版本新增的**派生字段**（不改动用户数据与既有值）。
 * 与版本迁移分开——即使 schemaVersion 已是最新，也能修好早期迁移漏掉的字段。
 * 当前补齐：enneagram.levelName（§8.14 新增的 9 级细分名）。
 * @returns 是否发生了修改
 */
export function healCharacter(raw: any): boolean {
  if (!raw || typeof raw !== 'object') return false
  const e = raw.enneagram
  if (!e || typeof e !== 'object') return false
  let changed = false
  if (!e.levelName) {
    try {
      e.levelName = levelInfo(typeof e.level === 'number' ? e.level : 4).name
      changed = true
    } catch { /* 忽略 */ }
  }
  return changed
}

/** 规范化主型（1-9，缺失/非法 → 5） */
export function getCore(raw: any): number {
  const n = Number(raw?.enneagram?.core)
  return Number.isFinite(n) && n >= 1 && n <= 9 ? Math.round(n) : 5
}

/** 规范化健康层级（1-9，缺失/非法 → 4） */
export function getLevel(raw: any): number {
  const n = Number(raw?.enneagram?.level)
  return Number.isFinite(n) && n >= 1 && n <= 9 ? Math.round(n) : 4
}

/** 规范化副型（sp/sx/so，缺失/非法 → sp） */
export function getSubtype(raw: any): Subtype {
  const s = raw?.enneagram?.subtype
  return SUBTYPES.includes(s) ? s : 'sp'
}

/** 侧翼归一：接受 4 / '5w4' / 'w4' 等写法，返回相邻型号数字或 undefined */
export function getWing(raw: any, core: number): number | undefined {
  const w = raw?.enneagram?.wing
  const adjacent = core === 1 ? [9, 2] : core === 9 ? [8, 1] : [core - 1, core + 1]
  if (typeof w === 'number' && adjacent.includes(w)) return w
  if (typeof w === 'string') {
    const m = w.match(/(\d)\s*w\s*(\d)/i)
    if (m && Number(m[1]) === core && adjacent.includes(Number(m[2]))) return Number(m[2])
    const only = w.match(/^(\d)$/)
    if (only && adjacent.includes(Number(only[1]))) return Number(only[1])
  }
  return undefined
}

/**
 * 迁移单个角色。就地修改 `raw` 并返回是否发生了变化。
 * @param note 迁移说明收集器（用于在 /status 里告知用户改了什么）
 */
export function migrateCharacter(raw: any, note: (m: string) => void): boolean {
  if (!raw || typeof raw !== 'object') return false
  const core = getCore(raw)
  const level = getLevel(raw)
  const subtype = getSubtype(raw)
  const wing = getWing(raw, core)
  const name = String(raw.name ?? '').trim() || '未命名角色'
  const role: CharacterRole = ROLES.includes(raw.role) ? raw.role : 'supporting'

  const oldEn = raw.enneagram ?? {}
  const before = JSON.stringify({
    coreName: oldEn.coreName, virtue: oldEn.virtue, vice: oldEn.vice,
    wingNick: oldEn.wingNick, subtypeLabel: oldEn.subtypeLabel, levelName: oldEn.levelName,
  })

  // 用当前知识库重建派生字段（自由文本与实测数据随后原样盖回）
  const rebuilt = buildCharacterModel({
    name,
    role,
    appearance: raw.appearance,
    background: raw.background,
    goal: raw.goal,
    stateNotes: raw.stateNotes,
    enneagram: { core, wing, subtype, level },
    mbti: raw.mbti,
    bigfive: raw.bigfive,
  })

  // 旧 enneagram 里由 LLM/旧版写入的 5 个附加字段（§8.17）——存在则保留
  const extras: Record<string, unknown> = {}
  for (const k of ['presence', 'catchphrase', 'triggers', 'stressResponse', 'growthResponse'] as const) {
    if (oldEn[k] !== undefined && oldEn[k] !== null) extras[k] = oldEn[k]
  }
  Object.assign(rebuilt.enneagram, extras)

  // 保留用户自由文本 / 实测数据 / 关联
  const keep: Partial<CharacterModel> = {
    mbtiDetail: raw.mbtiDetail,
    mbtiSource: raw.mbtiSource,
    bigfiveSource: raw.bigfiveSource,
    testsNote: raw.testsNote,
    library: raw.library,
    source: raw.source,
    ipipFacets: raw.ipipFacets,
    ipipFacetLabel: raw.ipipFacetLabel,
    scales: raw.scales,
  }
  for (const [k, v] of Object.entries(keep)) {
    if (v !== undefined) (rebuilt as any)[k] = v
  }

  // 遗留字段 persona/keywords → library.legacy（不丢数据、不再污染模型顶层）
  const legacy: Record<string, unknown> = {}
  for (const k of ['persona', 'keywords'] as const) {
    if (raw[k] !== undefined && raw[k] !== null) legacy[k] = raw[k]
  }
  if (Object.keys(legacy).length) {
    rebuilt.library = { ...(rebuilt.library ?? {}), legacy: { ...(rebuilt.library as any)?.legacy, ...legacy } } as any
    note(`角色「${name}」的遗留字段 ${Object.keys(legacy).join('/')} 已移入 library.legacy`)
  }

  // 写回：保留原 id / 时间戳；其余整体替换为迁移后模型
  rebuilt.id = raw.id || rebuilt.id
  rebuilt.createdAt = raw.createdAt || rebuilt.createdAt
  rebuilt.updatedAt = raw.updatedAt || rebuilt.updatedAt

  const after = JSON.stringify({
    coreName: rebuilt.enneagram.coreName, virtue: rebuilt.enneagram.virtue, vice: rebuilt.enneagram.vice,
    wingNick: rebuilt.enneagram.wingNick, subtypeLabel: rebuilt.enneagram.subtypeLabel, levelName: rebuilt.enneagram.levelName,
  })
  for (const k of Object.keys(raw)) {
    if (!(k in rebuilt)) delete raw[k]
  }
  Object.assign(raw, rebuilt)
  if (before !== after) {
    note(`角色「${name}」九型文案已按当前知识库刷新（${core}号 ${rebuilt.enneagram.wing ?? ''}）`)
    return true
  }
  return false
}
