/**
 * 数据模型：项目 / 大纲 / 伏笔 / 人物 / 世界观 / 章节 / 记忆。
 * 所有实体带 id + createdAt/updatedAt，JSON 持久化于 dataDir/projects/<id>/。
 */

export type OutlineNodeType = 'volume' | 'chapter' | 'beat'
export type OutlineStatus = 'planned' | 'writing' | 'done'
export type CharacterRole = 'protagonist' | 'supporting' | 'antagonist' | 'minor'
export type WorldviewCategory = 'geography' | 'history' | 'rules' | 'culture' | 'power-system' | 'other'
export type ForeshadowingStatus = 'open' | 'resolved' | 'abandoned'
export type ChapterStatus = 'draft' | 'final'

/** 项目绑定的一张文风卡（style-kb/cards 里的卡片 key） */
export interface StyleCardBinding {
  /** 卡片 key（style-kb cards 文件名去 .md，如 `c085-yonezawa-honobu`） */
  key: string
  /** 是否启用：写入生成时可被注入（enable 的合集即默认注入集） */
  enabled: boolean
}

export interface ProjectMeta {
  id: string
  name: string
  genre: string
  style: string
  premise: string
  /** 项目绑定的文风卡（可多张并存；enabled 控制默认写作时是否注入选中文风） */
  styleCards: StyleCardBinding[]
  createdAt: string
  updatedAt: string
}

export interface OutlineNode {
  id: string
  projectId: string
  type: OutlineNodeType
  title: string
  summary: string
  parentId: string | null
  order: number
  status: OutlineStatus
  /** 章节情节拍（type=chapter 专用）：本章要发生的情节序列 */
  beats: string[]
  createdAt: string
  updatedAt: string
}

export interface Foreshadowing {
  id: string
  projectId: string
  description: string
  plantedChapterId: string | null
  resolvedChapterId: string | null
  status: ForeshadowingStatus
  notes: string
  createdAt: string
  updatedAt: string
}

export interface CharacterRelation {
  targetId: string
  description: string
}

export interface CharacterArcStage {
  stage: string
  description: string
}

export interface CharacterState {
  location: string
  condition: string
  possessions: string[]
  notes: string
}

export interface Character {
  id: string
  projectId: string
  name: string
  aliases: string[]
  role: CharacterRole
  appearance: string
  personality: string
  background: string
  goal: string
  /** 人格档案（九型/MBTI/大五等结构化人格设定，由角色设定工作坊 dsh-character-maker 生成，可选） */
  personalityProfile: string
  relationships: CharacterRelation[]
  arc: CharacterArcStage[]
  currentState: CharacterState
  createdAt: string
  updatedAt: string
}

export interface WorldviewEntry {
  id: string
  projectId: string
  category: WorldviewCategory
  title: string
  content: string
  createdAt: string
  updatedAt: string
}

/** 地理类型（独立地理库；worldview.geography 旧条目迁移后归入） */
export type GeoType = 'country' | 'region' | 'city' | 'terrain' | 'building' | 'other'

export const GEO_TYPES: GeoType[] = ['country', 'region', 'city', 'terrain', 'building', 'other']

export const GEO_TYPE_LABELS: Record<GeoType, string> = {
  country: '国家/势力',
  region: '区域/大陆',
  city: '城市/城镇',
  terrain: '地形/山川/水系',
  building: '建筑/据点',
  other: '其他',
}

/**
 * 独立地理条目（从世界观拆出，与地图插件联动）：
 * 名称/类型/描述 + 可选地图坐标（mapX/mapY，0-1 归一化，供 mapforge 出图标注相对位置）。
 */
export interface GeoEntry {
  id: string
  projectId: string
  name: string
  aliases: string[]
  type: GeoType
  description: string
  /** 归一化坐标（0-1）；null=未标注 */
  mapX: number | null
  mapY: number | null
  createdAt: string
  updatedAt: string
}

/** 物品类别 */
export type ItemCategory = 'weapon' | 'artifact' | 'tool' | 'material' | 'drug' | 'document' | 'other'

export const ITEM_CATEGORIES: ItemCategory[] = ['weapon', 'artifact', 'tool', 'material', 'drug', 'document', 'other']

export const ITEM_CATEGORY_LABELS: Record<ItemCategory, string> = {
  weapon: '武器',
  artifact: '法器/宝物',
  tool: '器具',
  material: '材料',
  drug: '药物',
  document: '书证/情报',
  other: '其他',
}

/**
 * 独立物品档案（独立于章节记忆 items 的持久物品库）：
 * 名称/类别/描述 + 持有者 + 所在地 + 状态；生成章节时注入上下文。
 */
export interface ItemRecord {
  id: string
  projectId: string
  name: string
  aliases: string[]
  category: ItemCategory
  description: string
  /** 当前持有者（人物名/组织名；空=无主/未知） */
  owner: string
  /** 所在地（对应 GeoEntry.name 或自由文本；供地图联动做地标） */
  location: string
  /** 状态：正常/损坏/失窃/封印/遗失等自由文本 */
  status: string
  createdAt: string
  updatedAt: string
}

/** 每章动态记忆：摘要 + 事件 + 人物状态变化 + 物品 + 伏笔变化 */
export interface ChapterMemory {
  chapterId: string
  summary: string
  events: string[]
  characterUpdates: { name: string; change: string }[]
  items: string[]
  foreshadowingPlanted: string[]
  foreshadowingResolved: string[]
}

export interface ChapterRecord {
  id: string
  projectId: string
  title: string
  order: number
  status: ChapterStatus
  wordCount: number
  /** 所属卷：大纲中 type=volume 的节点 id；null=未分卷（旧数据由 store.load 迁移推导，大纲为唯一事实来源） */
  volumeId: string | null
  summary: string
  events: string[]
  characterUpdates: { name: string; change: string }[]
  items: string[]
  foreshadowingPlanted: string[]
  foreshadowingResolved: string[]
  createdAt: string
  updatedAt: string
}

/** 一个项目的全部数据（内存态；章节正文另存 chapters/<id>.md） */
export interface ProjectData {
  project: ProjectMeta
  outline: OutlineNode[]
  foreshadowings: Foreshadowing[]
  characters: Character[]
  worldview: WorldviewEntry[]
  geo: GeoEntry[]
  items: ItemRecord[]
  chapters: ChapterRecord[]
}

export const WORLDVIEW_CATEGORY_LABELS: Record<WorldviewCategory, string> = {
  'geography': '地理',
  'history': '历史',
  'rules': '规则',
  'culture': '文化',
  'power-system': '力量体系',
  'other': '其他',
}

export const CHARACTER_ROLE_LABELS: Record<CharacterRole, string> = {
  protagonist: '主角',
  supporting: '配角',
  antagonist: '反派',
  minor: '路人',
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function uid(prefix: string): string {
  return prefix + '-' + crypto.randomUUID().slice(0, 8)
}

/** 全部卷节点（按 order 排序） */
export function volumesSorted(data: ProjectData): OutlineNode[] {
  return data.outline.filter(n => n.type === 'volume').sort((a, b) => a.order - b.order)
}

/** 章节所属卷：以大纲为唯一事实来源（chapter 节点 parentId → volume 节点） */
export function chapterVolume(data: ProjectData, chapterNodeId: string): OutlineNode | null {
  const node = data.outline.find(n => n.id === chapterNodeId && n.type === 'chapter')
  if (!node || !node.parentId) return null
  const vol = data.outline.find(n => n.id === node.parentId && n.type === 'volume')
  return vol ?? null
}

/** 卷内相对章号（按 order 排序，1 起） */
export function chapterIndexInVolume(data: ProjectData, chapterNodeId: string): number {
  const node = data.outline.find(n => n.id === chapterNodeId && n.type === 'chapter')
  if (!node || !node.parentId) return 0
  const siblings = data.outline
    .filter(n => n.type === 'chapter' && n.parentId === node.parentId)
    .sort((a, b) => a.order - b.order)
  return siblings.findIndex(n => n.id === chapterNodeId) + 1
}

/** 章节与其所在卷的可见标题（用于工具返回/导出）：`【第三卷】卷标题` 或空 */
export function volumeTitleOf(data: ProjectData, chapterNodeId: string): string {
  const vol = chapterVolume(data, chapterNodeId)
  if (!vol) return ''
  const vIdx = volumesSorted(data).findIndex(v => v.id === vol.id) + 1
  const cIdx = chapterIndexInVolume(data, chapterNodeId)
  return `第${vIdx}卷《${vol.title}》${cIdx > 0 ? `（本卷第${cIdx}章）` : ''}`
}

/** 地理条目（按类型分组，名称排序） */
export function geoGrouped(data: ProjectData): Map<GeoType, GeoEntry[]> {
  const m = new Map<GeoType, GeoEntry[]>()
  for (const g of (data.geo ?? []).slice().sort((a, b) => a.name.localeCompare(b.name))) {
    const list = m.get(g.type) ?? []
    list.push(g)
    m.set(g.type, list)
  }
  return m
}

/** 归一化坐标 → 四舍五入百分比（null 安全） */
export function geoCoordLabel(x: number | null, y: number | null): string {
  if (x === null || y === null) return ''
  const px = Math.round(x * 100)
  const py = Math.round(y * 100)
  return `（坐标 ${px}%,${py}%）`
}
