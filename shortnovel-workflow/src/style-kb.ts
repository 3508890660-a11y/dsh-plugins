/**
 * 文风知识库（style-kb）读写适配模块（复用于短篇工作流）。
 *
 * 职责：扫描 `<styleKbRoot>/cards/*.md`（文风卡 / 手法卡），解析 frontmatter + 章节结构，
 * 把长篇卡片蒸馏成紧凑、可直接注入写作 prompt 的「文风指引块」，并支持按 文件名/key /
 * 标题 / 作者·作品 模糊检索与解析。
 *
 * 短篇工作流内由两块共用：
 *  - `shortnovel_style_kb` 工具（tools.ts）：list / get / bind / unbind / set_enabled / preview；
 *  - 生成引擎（generator.ts）：把项目绑定（或本次生成覆盖）的卡片蒸馏块拼进各阶段 system prompt。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export interface StyleCardInfo {
  /** 绑定 id：文件名去 .md（唯一、稳定，供持久化引用） */
  key: string
  /** 卡片文件名（含 .md） */
  file: string
  /** frontmatter title，如 `文风·米泽穗信（冰菓/寻狗事务所）`（检索主键） */
  title: string
  category: string
  tags: string[]
  kind: '文风' | '手法' | '其他'
}

export interface StyleCard extends StyleCardInfo {
  /** frontmatter 之后的正文 markdown */
  body: string
}

interface Split { meta: string; body: string }

/** 把文件拆成 frontmatter（meta）+ 正文（body）；无 frontmatter 返回 null。剥 BOM。 */
function splitFrontmatter(raw: string): Split | null {
  let t = raw.replace(/^\uFEFF/, '')
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(t)
  if (!m) return { meta: '', body: t }
  return { meta: m[1], body: t.slice(m[0].length) }
}

/** 浅解析 frontmatter：title / category / tags / source（其余忽略） */
function parseFrontmatter(meta: string): { title: string; category: string; tags: string[]; source: string } {
  const res = { title: '', category: '', tags: [] as string[], source: '' }
  for (const line of meta.split(/\r?\n/)) {
    const m = /^([a-zA-Z_]+)\s*:\s*(.*)$/.exec(line)
    if (!m) continue
    const [k, v] = [m[1], m[2].replace(/^['"]|['"]$/g, '').trim()]
    if (k === 'title') res.title = v
    else if (k === 'category') res.category = v
    else if (k === 'source') res.source = v
    else if (k === 'tags') {
      const arr = v.trim()
      const am = /^\[([\s\S]*)\]$/.exec(arr)
      if (am) res.tags = am[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
      else res.tags = arr ? [arr] : []
    }
  }
  return res
}

function kindOfTitle(title: string): StyleCard['kind'] {
  if (title.startsWith('手法·')) return '手法'
  if (title.startsWith('文风·')) return '文风'
  return '其他'
}

/** 是否是可绑定的真卡片（文风卡/手法卡），排除目录/索引（_moc-、catalog-、标题含「目录」）等非卡片文件 */
function isBindable(meta: { title: string; category: string; tags: string[] }): boolean {
  const kind = kindOfTitle(meta.title)
  if (meta.title.includes('目录') || meta.title.startsWith('文风知识库·藏书')) return false
  if (kind === '文风' || kind === '手法') return true
  if (meta.category === '文风知识库' && meta.tags.includes('文风')) return true
  if (kind === '其他' && meta.title.includes('文风') && meta.tags.includes('文风')) return true
  return false
}

/** 把正文按 `## 标题` 拆成章节表 */
function parseSections(body: string): Map<string, string> {
  const map = new Map<string, string>()
  let current: string | null = null
  let buf: string[] = []
  for (const line of body.split(/\r?\n/)) {
    const m = /^##\s+(.+?)\s*$/.exec(line)
    if (m) {
      if (current !== null) map.set(current, buf.join('\n').trim())
      current = m[1].trim()
      buf = []
    } else if (current !== null) {
      buf.push(line)
    }
  }
  if (current !== null) map.set(current, buf.join('\n').trim())
  return map
}

/** 压缩章节文本：去空行过多、压缩多空格、按 char 截断保尾。 */
function compact(sec: string, cap: number): string {
  const t = sec
    .split(/\r?\n/)
    .map(l => l.replace(/\s+/g, l.trim() ? ' ' : '').trimEnd())
    .filter(l => l.trim() !== '')
    .join('\n')
  if (t.length <= cap) return t
  let cut = t.slice(0, cap)
  const nl = cut.lastIndexOf('\n')
  if (nl > Math.floor(cap * 0.5)) cut = cut.slice(0, nl)
  return cut.replace(/\n+$/, '') + '\n……'
}

/** 单节加入蒸馏块（带「■ 标题」前缀），超长截断 */
function pushSection(out: string[], sections: Map<string, string>, name: string, cap: number): void {
  if (!sections.has(name) && ![...sections.keys()].some(k => k.includes(name))) return
  const key = sections.has(name) ? name : [...sections.keys()].find(k => k.includes(name))!
  const val = sections.get(key) ?? ''
  if (!val.trim()) return
  out.push(`■ ${name}\n${compact(val, cap)}`)
}

/**
 * 蒸馏：把一张长篇卡片的「生成相关」章节浓缩成紧凑指引块（capChars 上限，不含指令头）。
 * 文风卡保留：一句话定位 / 题材与叙事 / 文风指纹 / 适用场景；
 * 手法卡保留：一句话定位 / 核心手法 / 可套用句式骨架 / 反模式。
 * 剔除：原文采样、语法信息/语料信息、参考卡、source 等元数据。
 */
export function distillCard(card: StyleCard, capChars: number): string {
  const sections = parseSections(card.body)
  const lines: string[] = []
  const cap = Math.max(120, Math.floor(capChars / 4))
  lines.push(`● 文风卡：${card.title}${card.tags.length ? `（${card.tags.join('、')}）` : ''}`)
  if (card.kind === '文风') {
    pushSection(lines, sections, '一句话定位', cap)
    pushSection(lines, sections, '题材与叙事', cap)
    pushSection(lines, sections, '文风指纹', cap * 2)
    pushSection(lines, sections, '适用场景', cap)
  } else if (card.kind === '手法') {
    pushSection(lines, sections, '一句话定位', cap)
    pushSection(lines, sections, '核心手法', cap * 2)
    pushSection(lines, sections, '可套用句式', cap * 2)
    pushSection(lines, sections, '反模式', cap)
  } else {
    pushSection(lines, sections, '一句话定位', cap)
    pushSection(lines, sections, '文风指纹', cap * 2)
  }
  let out = lines.join('\n')
  if (out.length > capChars) out = out.slice(0, capChars) + '\n……'
  return out
}

/** 归一化检索词：去空白、去书名号/引号、小写 */
function norm(s: string): string {
  return s.replace(/[《》「」『』“”"\s]/g, '').toLowerCase()
}

export class StyleKb {
  private cardsDir: string
  private cache: StyleCardInfo[] | null = null

  /** rootDir 为 style-kb 根目录（含 cards/ 子目录）；空或不可达 → available=false */
  constructor(rootDir?: string) {
    this.cardsDir = rootDir ? join(rootDir, 'cards') : ''
  }

  get available(): boolean {
    return this.cardsDir !== '' && existsSync(this.cardsDir)
  }

  get rootDir(): string { return this.cardsDir.replace(/[\\/]cards$/, '') }
  get cardsDirname(): string { return this.cardsDir }

  private scan(): StyleCardInfo[] {
    if (this.cache) return this.cache
    if (!this.available) { this.cache = []; return this.cache }
    const out: StyleCardInfo[] = []
    for (const entry of readdirSync(this.cardsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue
      const full = join(this.cardsDir, entry.name)
      let raw: string
      try { raw = readFileSync(full, 'utf8') } catch { continue }
      const fm = splitFrontmatter(raw)
      if (!fm) continue
      const meta = parseFrontmatter(fm.meta)
      const key = entry.name.replace(/\.md$/i, '')
      if (/^[_]|^catalog-/.test(key)) continue
      if (!isBindable(meta)) continue
      const title = meta.title || key
      out.push({
        key,
        file: entry.name,
        title,
        category: meta.category,
        tags: meta.tags,
        kind: kindOfTitle(title),
      })
    }
    out.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'))
    this.cache = out
    return out
  }

  /** 列出卡片；可按 tag / 标题·作者·作品子串过滤 */
  list(opts?: { tag?: string; q?: string }): StyleCardInfo[] {
    let items = this.scan()
    if (opts?.tag?.trim()) {
      const t = opts.tag.trim()
      items = items.filter(c => c.tags.includes(t) || c.title.includes(t))
    }
    if (opts?.q?.trim()) {
      const q = norm(opts.q)
      items = items.filter(c =>
        norm(c.title).includes(q) || norm(c.key).includes(q) || c.tags.some(x => norm(x).includes(q)),
      )
    }
    return items
  }

  get count(): number { return this.scan().length }

  /** 读取单卡完整内容；key=文件名去 .md */
  read(key: string): StyleCard | null {
    const info = this.scan().find(c => c.key === key)
    if (!info || !this.available) return null
    let raw: string
    try { raw = readFileSync(join(this.cardsDir, key + '.md'), 'utf8') } catch { return null }
    const fm = splitFrontmatter(raw)
    return { ...info, body: fm ? fm.body : raw }
  }

  /**
   * 柔性解析用户输入 → 卡片 key：
   * 1) 精确 key/file/title；2) 归一化后唯一前缀匹配（title 或 key）。
   * 返回 { key, matched }；无匹配或歧义时 matched=false 并给 hint。
   */
  resolve(ref: string): { key: string; matched: boolean; hint?: string } {
    const r = ref.trim()
    if (!r) return { key: '', matched: false, hint: '卡片引用为空' }
    const all = this.scan()
    const exact = all.find(c => c.key === r || c.file === r || c.title === r)
    if (exact) return { key: exact.key, matched: true }
    const nr = norm(r)
    const hits = all.filter(c => norm(c.title).includes(nr) || norm(c.key).includes(nr))
    if (hits.length === 1) return { key: hits[0].key, matched: true }
    if (hits.length > 1) {
      return { key: '', matched: false, hint: `「${r}」命中多张卡（${hits.map(h => h.title).slice(0, 5).join('、')}…），请用 list 取精确 key` }
    }
    return { key: '', matched: false, hint: `「${r}」未在文风知识库中匹配到卡片，可用 shortnovel_style_kb action=list 查看全部，或加 q 检索` }
  }

  /** 把一组 key 蒸馏成注入块；miss 的 key 跳过；超过 maxCards 的 key 追加提示。返回 '' 表示无可注入内容 */
  distillKeys(keys: string[], capChars = 700, maxCards = 3): string {
    const valid = keys.filter(Boolean)
    const used = valid.slice(0, maxCards)
    const blocks: string[] = []
    for (const key of used) {
      const card = this.read(key)
      if (card) blocks.push(distillCard(card, capChars))
    }
    if (blocks.length === 0) return ''
    const tail = valid.length > maxCards
      ? `\n\n（另有 ${valid.length - maxCards} 张绑定文风卡未注入——单次默认最多 ${maxCards} 张，可分批启用，或用 generate 的 styleCards 指定本次注入）`
      : ''
    return blocks.join('\n\n') + tail
  }
}