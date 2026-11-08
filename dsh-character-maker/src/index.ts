/**
 * @dsh-external/dsh-character-maker — 角色设定工作坊（重建·旧版思路）。
 *
 * 独立能力：填写资料 / 跑人格问卷 / 基于已有档案完善角色模型，输出：
 *   九型人格为主干（主型→侧翼→本能副型→健康层级）+ MBTI 与大五(BFI-2) 为补充；
 *   角色人格详析、角色特质、思维与行为模式、情景样例（LLM 深度画像六节）。
 *
 * 联动：webServer API + 工具可从 dsh-novel-writer 项目拉人物档案（完善九型），
 *       并把九型角色模型写回其 personalityProfile（生成章节时自动注入【人物档案】）。
 *
 * ⚠️ 输出约定（AGENTS.md）：所有工具 output.render 返回值必须是
 *   `[{ type: 'text', text }]` 结构（content 数组），禁止裸字符串，否则前端崩溃。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import type LlmService from '@deepseek-ai/dsh-llm'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { mkdirSync, readFileSync, existsSync, realpathSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { CharacterStore, SCHEMA_VERSION } from './store.js'
import type { CharacterModel, QuestionnaireKind, Interaction, InteractionDirection, RelationshipGraph, RelationNode, RelationEdge, QuestionnaireResult, CharacterEssentials } from './types.js'
import {
  buildCharacterModel, scoreEnneagram108, scoreEnneagram144, scoreMultifactor,
  scoreMbti, scoreBigfive, scoreIpipNeo120, scoreLikertBank, enneagram90Type,
  guessEnneagramFromText, guessEnneagramScored, deriveCoreWing, levelInfo, mbtiCrossAxisItems,
  ENNEAGRAM_PROFILES, WING_NICK, SUBTYPE_KEYWORDS,
  subtypeProfile, subtypeTitle, SUBTYPE_FULL, SUBTYPE_PROFILES,
  TRIAD_SYSTEMS, triadMembership, triadLabels, triadFactsLine, triadWritingHooks, triadGroupOf,
  FLAW_TYPES, flawTypesLine, flawSeed, characterDynamics, TYPE_DYNAMICS,
} from './engine.js'
import type { QuestionBank, LikertBank } from './engine.js'
import { NovelLink } from './novel-link.js'
import type { NovelCharacter } from './novel-link.js'

export const name = '@dsh-external/dsh-character-maker'
export const inject = ['tools', 'webServer', 'llm']

export interface Config {
  dataDir: string
  novelDataDir: string
  provider: string
  model: string
}

export const Config = z.object({
  dataDir: z.string().default(''),
  novelDataDir: z.string().default(''),
  provider: z.string().default('ark-coding-plan'),
  model: z.string().default('ark-code-latest'),
})

function resolveDataDir(configDir: string, defaultName: string): string {
  if (configDir) return configDir
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    const pkgRoot = realpathSync(join(here, '..'))
    return join(dirname(pkgRoot), defaultName)
  } catch { /* realpath 失败 */ }
  return join(process.env.DSH_HOME || join(homedir(), '.dsh'), defaultName)
}

/**
 * 定位 novel-writer 的数据根目录。
 * §8.16 修复：移除硬编码的 `F:\producing\tool\writer\novel-writer-data` 兜底（可移植性差）。
 * 现在的顺序：显式配置 → NOVEL_DATA_DIR 环境变量 → 工作区相对启发式
 * → 在工作区父目录下按目录名自动发现 novel-writer-data 子目录 → DSH_HOME。
 */
function resolveNovelDataDir(configDir: string): string {
  if (configDir) return configDir
  const envDir = process.env.NOVEL_DATA_DIR
  if (envDir && looksLikeNovelRoot(envDir)) return envDir
  const candidates: string[] = []
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    const pkgRoot = realpathSync(join(here, '..'))
    const workspace = dirname(dirname(pkgRoot))
    candidates.push(join(workspace, 'writer', 'novel-writer-data'))
    candidates.push(join(workspace, 'novel-writer-data'))
    // 工作区父目录下自动发现（同级可能叫 writer/、novel/ 等任意目录名）
    const parent = dirname(workspace)
    try {
      for (const entry of readdirSync(parent, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        candidates.push(join(parent, entry.name, 'novel-writer-data'))
        candidates.push(join(parent, entry.name, 'writer', 'novel-writer-data'))
      }
    } catch { /* 父目录不可读 */ }
  } catch { /* 启发式失败 */ }
  candidates.push(join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'novel-writer-data'))
  for (const cand of candidates) {
    if (looksLikeNovelRoot(cand)) return cand
  }
  return ''
}

function looksLikeNovelRoot(dir: string): boolean {
  try {
    return existsSync(dir) && existsSync(join(dir, 'projects'))
  } catch {
    return false
  }
}

function loadQuestionBank(): QuestionBank {
  let base: string
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    base = join(realpathSync(join(here, '..')), 'assets')
  } catch {
    base = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'dsh-character-maker-assets')
  }
  const read = (f: string): any => {
    const raw = readFileSync(join(base, f), 'utf8')
    return JSON.parse(raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw)
  }
  return {
    enneagram108: read('enneagram-108.json'),
    enneagram144: read('enneagram-144.json'),
    multifactor: read('enneagram-multifactor-zh.json').items,
    mbti: read('mbti-93-questions.json'),
    bfi: read('bigfive-bfi2.json').items,
    mbti16: read('mbti-16types.json'),
    ipip: read('ipip-neo-120.json'),
    enneagram90: read('enneagram-90.json'),
    hexaco24: read('hexaco-24.json'),
    sd3: read('sd3.json'),
    ecr12: read('ecr-12.json'),
    locus24: read('locus-24.json'),
    mfq30: read('mfq-30.json'),
    pvq21: read('pvq-21.json'),
    disc32: read('disc-32.json'),
    eq22: read('eq-22.json'),
  }
}

// ── MBTI 16 型档案解析（角色卡附带的 MBTI 解析）──
interface Mbti16Entry { type: string; subtitle: string; description: string; contentHtml: string }

function htmlToText(html: string): string {
  return String(html ?? '')
    .replace(/<h3[^>]*>/gi, '\n§ ')
    .replace(/<\/h3>/gi, ' §\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 取 contentHtml 的某个 h3 小节文本（标题可能有别名，按候选顺序匹配） */
function mbtiSection(html: string, titles: string[]): string {
  const src = String(html ?? '')
  for (const title of titles) {
    const m = src.match(new RegExp(`<h3>${title}</h3>([\\s\\S]*?)(?=<h3>|$)`, 'i'))
    if (m) return htmlToText(m[1]).slice(0, 220)
  }
  return ''
}

/** 按句子边界截断（避免半字/半句） */
function cutSentences(text: string, maxLen: number): string {
  const t = String(text ?? '').trim()
  if (t.length <= maxLen) return t
  const cut = t.slice(0, maxLen)
  const lastStop = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('；'), cut.lastIndexOf('！'), cut.lastIndexOf('？'))
  return (lastStop > maxLen * 0.5 ? cut.slice(0, lastStop + 1) : cut) + '……'
}

/** MBTI 解析摘要：subtitle + 概览要点 + 特点小节 */
export function mbtiAnalysis(code: string, bank: QuestionBank): string {
  const entry = (bank.mbti16 as Mbti16Entry[] | undefined)?.find(x => x.type?.toUpperCase() === String(code ?? '').toUpperCase())
  if (!entry) return ''
  const parts: string[] = []
  parts.push(entry.subtitle ? `【${entry.subtitle}】` : '')
  const desc = htmlToText(entry.description)
    .replace(/^概览\s*/i, '')
    .replace(/\n+/g, ' ')
    .trim()
  if (desc) parts.push(cutSentences(desc, 150))
  const character = mbtiSection(entry.contentHtml, ['性格特点', '类型特点', '特点'])
  if (character) parts.push(`特点：${cutSentences(character, 120)}`)
  const blind = mbtiSection(entry.contentHtml, ['盲点'])
  if (blind) parts.push(`盲点：${cutSentences(blind, 100)}`)
  return parts.join(' ')
}

/** 大五数字 → 人话叙事 */
function bigfiveNarrative(b5: Record<string, number>, core: number): string[] {
  const out: string[] = []
  const band = (v: number) => (v >= 66 ? '偏高' : v <= 34 ? '偏低' : '居中')
  const dims: [string, string, string, string][] = [
    ['Openness', '开放性', '想象力、对新鲜与美的接受度', '爱幻想、审美敏锐、不安分'],
    ['Conscientiousness', '尽责性', '条理、自律、目标感', '有条不紊、说到做到、怕失控'],
    ['Extraversion', '外向性', '从人群/独处中充电的方式', '爱交际、带节奏'],
    ['Agreeableness', '宜人性', '信任、合作、体谅的程度', '宽厚圆融 / 竞争好斗'],
    ['Neuroticism', '神经质', '情绪敏感度与焦虑基线', '情绪起伏、容易紧张'],
  ]
  for (const [k, zh, desc, highW] of dims) {
    const v = b5[k]
    if (v === undefined) continue
    out.push(`${zh}${v}(${band(v)})：${desc}——对${core}号而言，这放大了他「${highW}」的一面（${v >= 66 ? '是可被激发的伏笔' : v <= 34 ? '反而是他的缓冲/压抑' : '整体还算均衡'}）`)
  }
  const o = b5.Openness ?? 50, c = b5.Conscientiousness ?? 50,
    ex = b5.Extraversion ?? 50, n = b5.Neuroticism ?? 50
  const combos: string[] = []
  if (n >= 60 && o >= 60) combos.push('「焦虑×开放」＝敏感到能看见别人看不见的美，也给自己造出无穷内耗（典型文艺/悲剧底色）')
  if (c >= 60 && (b5.Agreeableness ?? 50) >= 60) combos.push('「尽责×宜人」＝靠谱又温柔，是替大家兜底的人，但容易把自己掏空')
  if (ex >= 60 && c >= 60) combos.push('「外向×尽责」＝行动力极强的领导者气质，人群里的发动机')
  if (n >= 60 && ex <= 40) combos.push('「高神经质×低外向」＝独处时更容易反复琢磨，热闹不易真正进入内心')
  if (combos.length) out.push(`组合重叠：${combos.join('；')}`)
  return out
}

/** 角色书写的正面参考 + OOC 防线 */
function buildOocNote(e: CharacterModel['enneagram']): string[] {
  return [
    `【情感钢印】${e.core}号的心结是「${e.fear[0]}」，任何情节只要戳中它，情绪就顺理成章地强烈。`,
    `【台词语气】让他开口带着 ${e.coreName} 的味道，而不是一个纸片标签。`,
    `【健康↔病态】同是${e.core}号：健康时是「${e.virtue}」显现，黑化/疲态时是「${e.vice}」显形；别让${e.level}级（${e.levelBand}档 · ${levelInfo(e.level).name}）的角色长期演出反方向的档位。`,
    `【OOC 预警】除非给了足够诱因让他压力向${e.stressArrow}号 / 成长向${e.growthArrow}号移动，否则别让他做出违背核心恐惧「${e.fear[0]}」、核心欲望「${e.desire[0]}」的选择。`,
  ]
}

/** 渲染完整角色卡（人格详析 / 特质 / 思维行为 / 样例） */
function renderCharacterModel(ch: CharacterModel, bank?: QuestionBank): string {
  const e = ch.enneagram
  const out: string[] = []
  // 副型实时取自 27 亚型表（兼容旧数据里存的老标签）
  const st = subtypeProfile(e.core, e.subtype)
  // §8.18/§8.19：四大三元组归属（旧数据无 triads 字段时按主型现查；四组交集可反推唯一型号）
  const tr = e.triads ?? triadLabels(e.core)

  out.push(`╔═ 角色卡 · ${ch.name} ${({ protagonist: '【主角】', supporting: '【配角】', antagonist: '【反派】', minor: '【路人】' })[ch.role] || ''}`)
  out.push(`║ ${e.wing ? `${e.wing}（${e.wingNick}）` : ''}${e.core}号【${e.coreName}】`)
  // 人格摘要行：九型 + 副型 + 三元组 + MBTI + 大五核心，保证下游（如 novel-writer 注入截断）仍能拿到五者
  const summaryParts = [
    `九型 ${e.wing || e.core}号 ${e.coreName}`,
    `副型 ${e.subtype.toUpperCase()}·${st.name}${st.isCounter ? '(反型)' : ''}`,
    `三元组 ${tr.hornevian}/${tr.harmonic}`,
    ch.mbti ? `MBTI ${ch.mbti}` : '',
    (ch.bigfive && Object.keys(ch.bigfive).length) ? `大五 ${(['Openness', 'Conscientiousness', 'Extraversion', 'Agreeableness', 'Neuroticism'] as const).filter(k => ch.bigfive?.[k] !== undefined).map(k => `${BMAP[k]}=${ch.bigfive?.[k]}`).join('/')}` : '',
  ].filter(Boolean)
  out.push(`║ 人格摘要：${summaryParts.join(' · ')}`)
  out.push('║ —— 人物内核：')
  out.push(`║ 他是${e.core}号【${e.coreName}】(${e.coreEn})。向外，他渴望「${e.desire[0]}」；向内，他恐惧「${e.fear[0]}」——这是他一切选择的地基。`)
  out.push(`║ 自洽（健康档）时显现「${e.virtue}」底色；被压力压垮时，被「${e.vice}」劫持。${ch.goal ? `他把力气用在「${ch.goal}」上，表面上在追目标，内里其实是绕着那颗恐惧的心打转。` : ''}`)

  out.push('║ —— 人格指纹：')
  // §8.14：健康层级显示 9 级细分（级名 + 描述），不再是只给 3 档
  const lv = levelInfo(e.level)
  out.push(`║ 主型 ${e.core}号 ｜ 侧翼 ${e.wing}（${e.wingNick}）｜ 副型 ${e.subtype.toUpperCase()} · ${st.name}${st.isCounter ? '（反型）' : ''}｜ 健康层级 ${e.level}级(${lv.band}档 · ${lv.name}）`)
  out.push(`║ 层级解读：${lv.desc}`)
  out.push(`║ 副型倾向：${st.keyword}——${st.traits[0]}`)
  // §8.18/§8.19：三元组四套归属 + 逐组解读（写作落点）
  out.push(`║ 三元组：${tr.center} ｜ 姿态 ${tr.hornevian} ｜ 应对 ${tr.harmonic} ｜ 客体关系 ${tr.harmony}`)
  for (const { system, group } of triadMembership(e.core)) {
    const tag: Record<string, string> = { centers: '中心', hornevian: '姿态', harmonic: '应对', harmony: '客体关系' }
    out.push(`║ · ${tag[system.key] ?? system.zh}｜${group.zh}：${group.desc}`)
  }
  // §8.22：人格变化 / 动态（整合↔压力箭头、健康层级、翼型摆动）——弧光写作的地图
  const dyn = e.dynamics ?? characterDynamics(e.core, e.wing, e.level)
  if (dyn) {
    out.push('║ —— 人格变化/动态（弧光地图）：')
    out.push(`║ 整合方向 → ${dyn.integration.to}号【${dyn.integration.toName}】：${dyn.integration.look}${dyn.integration.risk ? `（待久风险：${dyn.integration.risk}）` : ''}`)
    out.push(`║ 压力方向 → ${dyn.stress.to}号【${dyn.stress.toName}】：${dyn.stress.look}${dyn.stress.resource ? `（当工具能用到：${dyn.stress.resource}）` : ''}`)
    out.push(`║ 健康层级 ${dyn.level.level}级（${dyn.level.band}档）｜翼型摆动：${dyn.wingSwing}`)
  }
  // §8.20：三要素（动机 / 缺陷 / 细节）——创作层详实块
  const es = ch.essentials
  if (es?.motivation || es?.flaw || es?.detail?.length) {
    out.push('║ —— 三要素（动机/缺陷/细节）：')
    if (es.motivation) {
      const src = es.motivation.source === 'auto' ? '（自动锚定项目大纲）' : es.motivation.source === 'manual' ? '（制作者主导）' : ''
      out.push(`║ 动机${src}：主动机「${es.motivation.primary}」（长期）｜ 次动机「${es.motivation.secondary}」（当下）`)
      if (es.motivation.urgency) out.push(`║ · 紧迫感：${es.motivation.urgency}`)
      if (es.motivation.trigger?.length) out.push(`║ · 触发器：${es.motivation.trigger.join(' / ')}`)
      if (es.motivation.crossLine) out.push(`║ · 越界开关：${es.motivation.crossLine}`)
    }
    if (es.flaw) {
      out.push(`║ 缺陷（${es.flaw.type}${es.flaw.kind ? `/${es.flaw.kind}` : ''}）：${es.flaw.name}——${es.flaw.cost}`)
      if (es.flaw.conflictWithMotivation) out.push(`║ · 与动机冲突：${es.flaw.conflictWithMotivation}`)
      if (es.flaw.keepsCharm) out.push(`║ · 保魅力：${es.flaw.keepsCharm}`)
      if (es.flaw.growth) out.push(`║ · 成长后：${es.flaw.growth}`)
    }
    if (es.detail?.length) {
      const hooks = es.detail.filter(x => x.hook)
      const cores = es.detail.filter(x => x.core)
      out.push(`║ 细节（${es.detail.length} 处${hooks.length ? `，含 ${hooks.length} 处剧情钩子` : ''}${cores.length ? `，核心 ${cores.length} 处` : ''}）：`)
      for (const it of es.detail) out.push(`║ · [${it.aspect}${it.hook ? '·钩子' : ''}${it.core ? '·核心' : ''}] ${it.desc}`)
    }
  }
  out.push(`║ 亚型画像：${st.keyword}${st.isCounter ? ' · 反型（表现与同型号相反，易被误判）' : ''}`)
  for (const t of st.traits) out.push(`║ · ${t}`)
  if (e.presence) out.push(`║ 气质/肢体：${e.presence}`)

  // §8.17：声音五件套（LLM 写入路径已补，旧数据也保留）
  if (e.catchphrase?.length) {
    out.push('║ —— 个性化口头禅（含使用场合）：')
    for (const c of e.catchphrase) out.push(`║ · ${String(c).replace(/「|」/g, '')}`)
  }
  if (e.triggers?.length) out.push(`║ —— 情绪雷区：${e.triggers.join('；')}`)
  if (e.stressResponse?.length) out.push(`║ —— 压力反应：${e.stressResponse.join('；')}`)
  if (e.growthResponse?.length) out.push(`║ —— 成长/整合：${e.growthResponse.join('；')}`)

  // ── MBTI 解析（16 型档案：类型别名 + 概览要点 + 特点/盲点） ──
  if (ch.mbti) {
    const src = ch.mbtiSource === 'quiz' ? '问卷实测' : ch.mbtiSource === 'inferred' ? 'AI 依角色资料推断' : ''
    out.push(`║ —— MBTI ${ch.mbti}${src ? `（${src}）` : ''}：`)
    const mbtiText = (bank ? mbtiAnalysis(ch.mbti, bank) : '') || (ch.mbtiDetail ?? '')
    if (mbtiText) {
      for (const seg of mbtiText.split(/(?<=[。！？；])/)) {
        const t = seg.trim()
        if (!t) continue
        for (let i = 0; i < t.length; i += 80) out.push(`║ · ${t.slice(i, i + 80)}`)
      }
    } else out.push(`║ · （16 型档案未收录，可在 character_questionnaire 跑 mbti-93 复核）`)
  }

  // ── 大五解析（维度解读 + 组合重叠叙事） ──
  const b5 = ch.bigfive
  if (b5 && Object.keys(b5).length) {
    const src = ch.bigfiveSource === 'quiz' ? '问卷实测' : ch.bigfiveSource === 'inferred' ? 'AI 依角色资料推断' : ''
    out.push(`║ —— 大五人格（0-100${src ? ` · ${src}` : ''}）：${(['Openness', 'Conscientiousness', 'Extraversion', 'Agreeableness', 'Neuroticism'] as const)
      .map(k => `${BMAP[k] ?? k}=${b5[k] ?? '?'}`).join(' ')}`)
    for (const line of bigfiveNarrative(b5, e.core)) out.push(`║ · ${line}`)
  }
  // IPIP-NEO-120 的 30 子维度画像
  // §8.3：ipipFacets / ipipFacetLabel 已是 CharacterModel 的正式字段（不再是 (ch as any)）
  const ipipF = ch.ipipFacets
  const ipipL = ch.ipipFacetLabel
  if (ipipF && typeof ipipF === 'object' && Object.keys(ipipF).length) {
    out.push('║ —— 大五·30 子维度（IPIP-NEO-120）：')
    for (const d of ['N', 'E', 'O', 'A', 'C'] as const) {
      const dimLabel: Record<string, string> = { N: '神经质', E: '外向性', O: '开放性', A: '宜人性', C: '尽责性' }
      for (let f = 1; f <= 6; f++) {
        const k = `${d}.f${f}`
        const v = ipipF[k]
        if (typeof v !== 'number') continue
        const label = ipipL?.[k] ?? `${dimLabel[d]}·f${f}`
        out.push(`║ · ${label}=${v}${v >= 66 ? '（偏高）' : v <= 34 ? '（偏低）' : '（均衡）'}`)
      }
    }
  }
  // 通用维度问卷额外量表（HEXACO/SD3/依恋/控制点/道德/价值观/DISC/同理心）
  // §8.3：scales 已是 CharacterModel 的正式字段
  const scales = ch.scales
  if (scales && Object.keys(scales).length) {
    for (const [sk, sv] of Object.entries(scales)) {
      if (!sv || typeof sv !== 'object' || !sv.scores || !Object.keys(sv.scores).length) continue
      out.push(`║ —— ${sv.name || sk}：`)
      for (const [dimId, v] of Object.entries(sv.scores)) {
        if (typeof v !== 'number') continue
        const label = sv.labels?.[dimId] ?? dimId
        const band = v >= 66 ? '偏高' : v <= 34 ? '偏低' : '均衡'
        out.push(`║ · ${label}=${v}（${band}）`)
        const ins = SCALE_INSIGHT[`${sk}:${dimId}`] ?? SCALE_INSIGHT[`${sk}:${label}`]
        if (ins) out.push(`║   └ ${v >= 66 ? ins.high : v <= 34 ? ins.low : (band === '偏高' ? ins.high : v <= 66 && v >= 34 ? `均衡：${ins.high} 与 ${ins.low}` : '')}`)
      }
    }
  }
  if (ch.testsNote) out.push(`║ —— 测试推断依据：${ch.testsNote}`)

  if (ch.behaviors.length) out.push(`║ —— 行为特征：${ch.behaviors.join('；')}`)

  if (ch.arcAdvice.length) { out.push('║ —— 弧光/成长设计：'); for (const a of ch.arcAdvice) out.push(`║ · ${a}`) }

  const nar = ch.library?.narrative
  if (nar && nar.trim()) {
    out.push('║ ═══════════════════════════════')
    out.push('║ ★ 深度人格画像（六节 · 角色专属）：')
    for (const line of String(nar).split('\n')) {
      const t = line.trim()
      if (!t) continue
      if (/^#{1,4}\s/.test(t)) out.push(`║ ${t.replace(/^#{1,4}\s*/, '▍')}`)
      else if (/^[-*]\s|^\d+[.、]/.test(t)) out.push(`║  · ${t.replace(/^[-*]\s+/, '').replace(/^\d+[.、]\s*/, '')}`)
      else out.push(`║ ${t}`)
    }
  }

  out.push('║ —— 写作注意：')
  for (const n of buildOocNote(e)) out.push(`║ ${n}`)

  out.push('╚══')
  return out.join('\n')
}

const BMAP: Record<string, string> = {
  Openness: '开放性', Conscientiousness: '尽责性', Extraversion: '外向性', Agreeableness: '宜人性', Neuroticism: '神经质',
}

/**
 * 量表各维度「高分/低分」的创作解读（写作时用）。key = `${kind}:${dimId}`。
 * 不求全，覆盖已接入的主要量表维度。
 */
const SCALE_INSIGHT: Record<string, { high: string; low: string }> = {
  // HEXACO
  'hexaco-24:honesty_humility': { high: '高诚实：忠于原则、难以腐蚀，是可信赖的队友，但可能因过于耿直而显得不近人情', low: '低诚实（机巧）：善于钻营、取舍灵活，适合写有灰色道德观或会“抄近道”的角色' },
  'hexaco-24:emotionality': { high: '高情绪性：情感丰沛、易恐惧依赖，哭点和恐惧反应都外露', low: '低情绪性（冷淡）：泰山崩于前而不变色，罕见软肋' },
  'hexaco-24:extraversion': { high: '高外向：人群中的发光体，靠社交与赞美充电', low: '低外向：独处回血，热闹是消耗，内心戏丰富' },
  'hexaco-24:agreeableness': { high: '高宜人：宽厚包容、不计较，容易被辜负也容易原谅', low: '低宜人：强硬较真、敢于冲突，护己也护自己人' },
  'hexaco-24:conscientiousness': { high: '高尽责：靠谱自律、说到做到，是团队兜底的人', low: '低尽责：随性拖延、自由散漫，灵感型和混乱型角色的底色' },
  'hexaco-24:openness': { high: '高开放：想象力与审美丰富、拥抱新事物', low: '低开放：务实守旧，安于已知，对变化迟钝或抗拒' },
  // SD3 黑暗三合一
  'sd3:machiavellianism': { high: '高马基：运筹帷幄、把人当棋子的谋略家，长线经营人心', low: '低马基：坦率正直，不搞心机算计' },
  'sd3:narcissism': { high: '高自恋：以自我为中心、渴望被仰望，玻璃心又强撑体面', low: '低自恋：谦逊低调，不抢风头' },
  'sd3:psychopathy': { high: '高冷淡（精神病态）：对他人痛苦无感、冲动冷酷，危险的反派坯子', low: '低冷淡：心软共情，见不得人受苦' },
  // ECR 依恋
  'ecr-12:attachment_anxiety': { high: '高依恋焦虑：害怕被抛弃、需要反复确认心意，患得患失', low: '低依恋焦虑：不担心分离，安全感稳定' },
  'ecr-12:attachment_avoidance': { high: '高依恋回避：抗拒亲密与依赖，习惯推开靠近的人', low: '低依恋回避：愿意亲近，能坦然接受爱与被爱' },
  // 控制点
  'locus-24:loc_internal': { high: '高内控：相信命在自己手里，主动果决', low: '低内控：认命随波，宿命感强' },
  'locus-24:loc_powerful_others': { high: '高他人控制：觉得被有权势者摆布，对强者敏感或敬畏', low: '低他人控制：不太在意别人掌不掌权' },
  'locus-24:loc_chance': { high: '高机遇主导：相信成败靠运气天命，爱赌一把', low: '低机遇主导：不信命，重计划与因果' },
  // 道德基础
  'mfq-30:care': { high: '高关怀：强烈不忍见人受伤害，悲天悯人', low: '低关怀：对他人苦痛相对钝感' },
  'mfq-30:fairness': { high: '高公平：极重公道，无法容忍不公', low: '低公平：灵活对待对错，规则可谈判' },
  'mfq-30:loyalty': { high: '高忠诚：团队与圈子的归属感极强，护短', low: '低忠诚：超然于团体，更看重个人立场' },
  'mfq-30:authority': { high: '高权威：尊重秩序与传统，服从上下级', low: '低权威：反权威、质疑规则' },
  'mfq-30:sanctity': { high: '高纯洁：对神圣/贞洁/洁净有强烈信念，嫉恶如仇', low: '低纯洁：对“不可污染”无感，更功利' },
  // DISC
  'disc-32:disc_d': { high: '高支配：强势直接、结果导向、敢拍板，天生的破局者', low: '低支配：随和退让，不愿主导' },
  'disc-32:disc_i': { high: '高影响：热情感染力强、爱表现，是气氛担当与说服者', low: '低影响：低调安静，不抢话语权' },
  'disc-32:disc_s': { high: '高稳健：耐心沉稳、重稳定和谐，可靠的后盾', low: '低稳健：急切求变，耐不住一成不变' },
  'disc-32:disc_c': { high: '高尽责（严谨）：重细节与流程、较真，质量把关者', low: '低尽责：随性少较真，重当下感觉' },
  // 同理心
  'eq-22:empathy_quotient': { high: '高同理心：极擅感知他人情绪，温柔却易被情绪卷入', low: '低同理心：对他人感受迟钝，更理性或更冷漠' },
  // 价值观（高频绘制用）
  'pvq-21:self_direction': { high: '高自主：重独立与自我选择，不愿被操控', low: '低自主：随大流、重他人看法' },
  'pvq-21:power': { high: '高权力：重地位与支配，野心勃勃', low: '低权力：淡泊名利' },
  'pvq-21:benevolence': { high: '高仁慈：善待身边人，乐于奉献', low: '低仁慈：自我中心、利己' },
  'pvq-21:security': { high: '高安全：求稳避险、重秩序与保护', low: '低安全：敢冒险、拥抱不确定' },
}

/** 标准 content 块数组（严禁裸字符串） */
function tx(text: string): { type: 'text', text: string }[] {
  return [{ type: 'text', text }]
}

// ════════════════════════════════════════════════════════════
// §8.8 作答完整性校验
// ════════════════════════════════════════════════════════════

/** 各问卷的题目键清单（用于完整性校验；ipip 优先用题目 uuid，兼容题序） */
export function bankPositions(kind: QuestionnaireKind, bank: QuestionBank): (number | string)[] {
  switch (kind) {
    case 'enneagram-108': return bank.enneagram108.map(q => q.n)
    case 'enneagram-144': return bank.enneagram144.map(q => q.n)
    case 'enneagram-multifactor': return bank.multifactor.map(q => q.no)
    case 'mbti-93': return bank.mbti.map((q, i) => q.n ?? (i + 1))
    case 'bigfive-60': return bank.bfi.map(q => q.n)
    case 'ipip-neo-120': return (bank.ipip ?? []).map(it => it.id)
    case 'enneagram-90': return bank.enneagram90?.items.map(i => i.position) ?? []
    case 'hexaco-24': return bank.hexaco24?.items.map(i => i.position) ?? []
    case 'sd3': return bank.sd3?.items.map(i => i.position) ?? []
    case 'ecr-12': return bank.ecr12?.items.map(i => i.position) ?? []
    case 'locus-24': return bank.locus24?.items.map(i => i.position) ?? []
    case 'mfq-30': return bank.mfq30?.items.map(i => i.position) ?? []
    case 'pvq-21': return bank.pvq21?.items.map(i => i.position) ?? []
    case 'disc-32': return bank.disc32?.items.map(i => i.position) ?? []
    case 'eq-22': return bank.eq22?.items.map(i => i.position) ?? []
    default: return []
  }
}

export interface AnswerCheck {
  total: number
  answered: number
  missing: number[]
  /** 缺失比例（0-1） */
  ratio: number
  ok: boolean
  note: string
}

/**
 * 校验作答完整性（§8.8）。
 * 判定「缺题」时同时接受：题号数字键、题号字符串键、题序（1..N，用于无题号的 mbti-93 与 ipip uuid 题库）。
 * `tolerance` 为允许的缺失比例上限（默认 0.1 = 10%）。
 */
export function checkAnswers(
  kind: QuestionnaireKind,
  bank: QuestionBank,
  ans: Record<string | number, any>,
  tolerance = 0.1,
): AnswerCheck {
  const positions = bankPositions(kind, bank)
  const missing: number[] = []
  let answered = 0
  positions.forEach((p, idx) => {
    const seq = idx + 1
    const has = ans[p as any] !== undefined || ans[String(p)] !== undefined || ans[seq] !== undefined
    if (has) answered += 1
    else missing.push(seq)
  })
  const total = positions.length
  const ratio = total === 0 ? 0 : missing.length / total
  const ok = ratio <= tolerance
  const note = total === 0
    ? '题库未加载，跳过完整性校验'
    : ok
      ? `作答完整（${answered}/${total}）`
      : `作答不完整：${answered}/${total}，缺 ${missing.length} 题（${(ratio * 100).toFixed(1)}%）`
  return { total, answered, missing, ratio, ok, note }
}

/** 把缺题清单压缩成可读片段（最多展示 24 个） */
export function formatMissing(missing: number[]): string {
  if (!missing.length) return '无'
  const head = missing.slice(0, 24).join(', ')
  return missing.length > 24 ? `${head} …（共 ${missing.length} 题）` : head
}

// ════════════════════════════════════════════════════════════
// §8.13 UI 问卷作答：把题库规范化为前端可直接渲染的题目列表
// ════════════════════════════════════════════════════════════

export interface UiQuestion {
  /** 作答键（数字题号；ipip 用题序，计分器兼容） */
  no: number
  text: string
  /** bool=是/否；ab=二选一；scale=李克特量表 */
  type: 'bool' | 'ab' | 'scale'
  /** ab 题的两个选项文本 */
  a?: string
  b?: string
  scaleMin?: number
  scaleMax?: number
  scaleLabels?: string[]
  dimension?: string
}

/** 全部 15 种问卷的元信息（UI 下拉用） */
export function listQuizMeta(bank: QuestionBank): { id: QuestionnaireKind; name: string; count: number }[] {
  const L = (id: QuestionnaireKind, name: string, b?: LikertBank, count?: number) => ({
    id, name, count: count ?? b?.items.length ?? 0,
  })
  return [
    L('enneagram-90', '九型人格·90题李克特（每型10题，最稳）', bank.enneagram90),
    L('enneagram-multifactor', '九型·深度多功能39题（出主型+翼+本能+tritype）', undefined, bank.multifactor.length),
    L('enneagram-144', '九型·144题二选一迫选', undefined, bank.enneagram144.length),
    L('enneagram-108', '九型·108题是/否自评', undefined, bank.enneagram108.length),
    L('ipip-neo-120', '大五·IPIP-NEO-120（5域+30子维度）', undefined, bank.ipip?.length ?? 0),
    L('bigfive-60', '大五·BFI-2 60题', undefined, bank.bfi.length),
    L('mbti-93', 'MBTI·93题二选一（含1道跨轴题自动跳过）', undefined, bank.mbti.length),
    L('hexaco-24', 'HEXACO 六维 24题', bank.hexaco24),
    L('sd3', '黑暗三合一 SD3 27题', bank.sd3),
    L('ecr-12', '成人依恋 ECR-S 12题', bank.ecr12),
    L('locus-24', '控制点 IPC 24题', bank.locus24),
    L('mfq-30', '道德基础 MFQ-30', bank.mfq30),
    L('pvq-21', '价值观 PVQ-21', bank.pvq21),
    L('disc-32', 'DISC 行为风格 32题', bank.disc32),
    L('eq-22', '同理心 EQ 22题', bank.eq22),
  ]
}

/** 把某问卷的题库规范化为 UI 题目列表（可选区间分页 --from/--to，1 基） */
export function buildUiQuestions(kind: QuestionnaireKind, bank: QuestionBank, from = 1, to = 0): UiQuestion[] {
  const all: UiQuestion[] = []
  switch (kind) {
    case 'enneagram-108':
      for (const q of bank.enneagram108) all.push({ no: q.n, text: q.question, type: 'bool' })
      break
    case 'enneagram-144':
      for (const q of bank.enneagram144) all.push({ no: q.n, text: q.question, type: 'ab', a: q.choice_a?.text, b: q.choice_b?.text })
      break
    case 'enneagram-multifactor':
      for (const it of bank.multifactor) all.push({ no: it.no, text: it.stem_zh, type: 'ab', a: it.option_a?.text_zh, b: it.option_b?.text_zh, dimension: it.section })
      break
    case 'mbti-93':
      bank.mbti.forEach((q, i) => all.push({ no: q.n ?? (i + 1), text: q.question, type: 'ab', a: q.choice_a?.text, b: q.choice_b?.text }))
      break
    case 'bigfive-60':
      for (const it of bank.bfi) all.push({ no: it.n, text: it.item, type: 'scale', scaleMin: 1, scaleMax: 5, scaleLabels: ['非常不同意', '不同意', '中立', '同意', '非常同意'], dimension: it.dimension })
      break
    case 'ipip-neo-120':
      (bank.ipip ?? []).forEach((it, i) => all.push({
        no: i + 1, text: it.text, type: 'scale', scaleMin: 1, scaleMax: 5,
        scaleLabels: ['非常不同意', '不同意', '中立', '同意', '非常同意'],
        dimension: `${it.domainZh ?? it.domain}${it.facetZh ? '·' + it.facetZh : ''}`,
      }))
      break
    default: {
      const lkb: LikertBank | undefined =
        kind === 'enneagram-90' ? bank.enneagram90
          : kind === 'hexaco-24' ? bank.hexaco24
            : kind === 'sd3' ? bank.sd3
              : kind === 'ecr-12' ? bank.ecr12
                : kind === 'locus-24' ? bank.locus24
                  : kind === 'mfq-30' ? bank.mfq30
                    : kind === 'pvq-21' ? bank.pvq21
                      : kind === 'disc-32' ? bank.disc32
                        : kind === 'eq-22' ? bank.eq22
                          : undefined
      if (lkb) {
        const dimLabel = (id: string) => lkb.dimLabelZh?.[id] ?? lkb.dimensions.find(d => d.id === id)?.label ?? id
        for (const it of lkb.items) {
          all.push({
            no: it.position, text: it.text, type: 'scale',
            scaleMin: lkb.scaleMin, scaleMax: lkb.scaleMax,
            scaleLabels: (lkb as any).scaleLabels,
            dimension: dimLabel(it.dimension),
          })
        }
      }
      break
    }
  }
  const lo = Math.max(1, from)
  const hi = to > 0 ? Math.min(to, all.length) : all.length
  return all.slice(lo - 1, hi)
}

/**
 * §8.10 互动登记入参校验。
 * 返回错误信息字符串表示校验失败，返回 null 表示通过。
 */export function validateInteractionInput(body: any): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return '请求体必须是 JSON 对象'
  const a = typeof body.a === 'string' ? body.a.trim() : ''
  const b = typeof body.b === 'string' ? body.b.trim() : ''
  if (!a) return '缺少参数 a（角色 A 的 id 或名字）'
  if (!b) return '缺少参数 b（角色 B 的 id 或名字）'
  if (a.length > 120 || b.length > 120) return '角色标识过长（上限 120 字符）'
  if (a === b) return '角色 A 与角色 B 不能相同'
  if (body.projectId !== undefined && body.projectId !== null && typeof body.projectId !== 'string') return 'projectId 必须是字符串'
  if (body.weight !== undefined && body.weight !== null && !Number.isFinite(Number(body.weight))) return 'weight 必须是数字'
  if (body.direction !== undefined && body.direction !== null && !['a->b', 'b->a', 'a<->b'].includes(body.direction)) {
    return "direction 只能是 'a->b' | 'b->a' | 'a<->b'"
  }
  if (body.tags !== undefined && body.tags !== null && !Array.isArray(body.tags)) return 'tags 必须是字符串数组'
  if (body.analysis !== undefined && body.analysis !== null && typeof body.analysis !== 'string') return 'analysis 必须是字符串'
  return null
}

// ════════════════════════════════════════════════════════════
// §8.9 LLM JSON 解析：带校验的严格提取（失败不静默写坏数据）
// ════════════════════════════════════════════════════════════

/** 从 LLM 输出里提取第一个 JSON 对象（容忍代码块与前后缀文字） */
export function extractJsonObject<T = any>(raw: string): T | null {  const text = String(raw ?? '')
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fenced ? fenced[1] : text
  const start = body.indexOf('{')
  if (start < 0) return null
  // 括号配平扫描，避免贪婪正则跨越多个对象
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < body.length; i++) {
    const c = body[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') { inStr = true; continue }
    if (c === '{') depth += 1
    else if (c === '}') {
      depth -= 1
      if (depth === 0) {
        try { return JSON.parse(body.slice(start, i + 1)) as T } catch { return null }
      }
    }
  }
  return null
}

async function callLlm(
  llm: LlmService,
  system: string,
  prompt: string,
  opts: { maxTokens?: number; temperature?: number; route?: { provider: string; model: string } | null },
): Promise<string> {
  const candidates: { provider: string; model: string }[] = []
  let registered = new Set<string>()
  try { registered = new Set(llm.listProviders().map((p: any) => p.id)) } catch { /* 列表失败 */ }
  const push = (provider: string, model: string) => {
    if (!provider || !model) return
    // 只在 provider 注册表非空时校验（列表不可用则照走，失败会记入 attempts）
    if (registered.size && !registered.has(provider)) return
    if (candidates.some(c => c.provider === provider && c.model === model)) return
    candidates.push({ provider, model })
  }
  // 1) 主会话/配置路由优先（通常是生效模型）
  if (opts?.route?.provider && opts?.route?.model) push(opts.route.provider, opts.route.model)
  // 2) 探测：每个已注册 provider 的自身 id / default / latest
  for (const id of registered) {
    push(id, id)
    push(id, 'default')
    push(id, 'latest')
  }

  let lastErr: unknown = null
  const attempts: string[] = []
  for (const route of candidates.slice(0, 16)) {
    try {
      let text = ''
      let finish = ''
      let failMsg = ''
      const stream = llm.stream({
        provider: route.provider,
        model: route.model,
        system,
        messages: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: prompt }] })],
        temperature: opts?.temperature ?? 0.7,
        maxTokens: opts?.maxTokens ?? 1600,
      })
      for await (const chunk of stream) {
        if (chunk.type === 'text-delta') text += chunk.text
        else if (chunk.type === 'finish') {
          const r = chunk.reason as { kind?: string; failure?: { message?: string } }
          finish = r?.kind ?? ''
          failMsg = r?.failure?.message ?? ''
        }
      }
      if (text.trim()) return text.trim()
      attempts.push(`${route.provider}/${route.model}: finish=${finish || 'none'}${failMsg ? ` ${failMsg}` : ''}`)
      lastErr = new Error(`模型 ${route.provider}/${route.model} 返回为空`)
    } catch (e) {
      attempts.push(`${route.provider}/${route.model}: ${String((e as any)?.message ?? e).slice(0, 120)}`)
      lastErr = e
    }
  }
  throw new Error('LLM 调用失败。尝试候选:\n' + attempts.join('\n'))
}

/** 深度画像 system 提示（六节：人格详析/特质/思维/行为/样例/解读） */
/**
 * §8.20/§8.21：三要素 → 简报（供 personaFacts / 深析上下文 / 角色卡标题行复用）。
 * 动机自动锚定项目大纲时，会带上「锚定：premise/outline」来源说明。
 */
function essentialsBrief(es: CharacterEssentials): string {
  if (!es) return ''
  const m = es.motivation
  const f = es.flaw
  const d = es.detail
  const mo = m ? `主动机「${m.primary}」+次动机「${m.secondary}」（${m.urgency ? '紧迫：' + m.urgency + '；' : ''}触发：${m.trigger.join('、')}；越界：${m.crossLine}${m.source ? `；来源:${m.source}` : ''}）` : ''
  const fl = f ? `「${f.name}」（${f.type}${f.kind ? `/${f.kind}` : ''}）：${f.cost}${f.conflictWithMotivation ? `；与动机冲突→${f.conflictWithMotivation}` : ''}` : ''
  const cores = d?.filter(x => x.core)?.length ?? 0
  const de = d?.length ? `${d.length} 处细节（核心 ${cores} 处${d.some(x => x.hook) ? `，含 ${d.filter(x => x.hook).length} 处剧情钩子` : ''}）` : ''
  return `三要素（动机/缺陷/细节）：${[mo, fl, de].filter(Boolean).join(' ｜ ')}`
}

const DEEP_SYS = `你是资深角色设计师兼深度心理侧写师。请基于角色【已知资料】与【人格档案】（九型 + 三元组 + MBTI + 大五 + 三要素），产出一份贴合这个角色独有经历的结构化深度分析，绝不套模板、绝不说空话。严格按六节 markdown 输出：
## 一、特质与性格详析（2-3条最有区分度的关键词，从这段经历如何塑造成他解释，区分得意/受挫/独处）
## 二、常见思维模式（3-5条他大脑里运转的默认认知脚本）
## 三、常见行动模式（3-5条他的外显自动反应）
## 四、情景例子（3个他专属的场景，各2-3句，用只属于他的细节与台词）
## 五、个性化口头禅（写4-6句只会从这张嘴里说出来的话。必须源于他的职业、伤疤、执念或贴身物件，逐句标注"什么时候/对谁说"。彻底抛开"你们不懂这种感受"这类通用人格公式句）
## 六、逐维度创作解读（对下面每个维度，结合他独有的经历各写2-3句："这个标签在他身上具体长什么样＋写作时怎么用"，不要复述通用定义）：①核心恐惧与欲望 ②善德/恶习的两端 ③情绪雷区 ④压力反应 ⑤成长整合 ⑥大五组合 ⑦盲点 ⑧三元组四套归属（智慧中心的核心情绪如何驱动他、与人相处时的社交姿态、面对冲突的第一反应、以及建立亲密关系的客体关系模式——四条各写"在他身上长什么样"，别抄定义）⑨动机（主动机是长期主驱动、次动机是当下的一步、紧迫感来自哪里、什么会触发他动、什么事会让他越过底线——动机要强到能逼他走完故事线，别写成通用欲望）⑩缺陷（哪个性格/能力/生理上的毛病会让他或身边人付出代价、它如何与动机顶牛、对正派角色怎么保魅力、成长后补上什么）⑪细节（围绕他的性格与过往，1-2 处核心细节作全书回响的锚点，其余为锦上添花的补充——并点出哪几个是该被剧情回收的钩子）⑫人格变化轨迹（整合方向他健康时像哪一号、压力失衡时滑向哪一号、健康层级随经历怎么降档/升档、主导翼在成长/受压时如何摆动——写出一条"随故事从坏到好或崩坏"的真实变化弧）
【三元组使用要求】三元组是"行为层的定位坐标"，不是新标签。禁止直接写"他是退缩组所以……"这类术语句；必须把它翻译成具体动作、距离感、台词气口与冲突时的选择。若给出了问卷实测的三元组得分，主型理论归属与实测主导不一致时，要解释这种张力（例如"理论上属拒绝型，实测却偏向依附型"意味着什么），这往往是最有戏剧性的部分。
【三要素使用要求】动机/缺陷/细节同样是创作坐标而非标签。动机必须接到这条故事线（大纲梗概/他的目标）；缺陷要写它会具体在哪件事哪段关系上让人付出代价；细节要能用一两个字眼在全书反复回响、可被写作时随时调用。
语言中文，全文约 900-1300 字。`

/**
 * §8.17：EnneagramModel 里 presence/catchphrase/triggers/stressResponse/growthResponse
 * 五个字段此前是「死字段」（新代码无写入路径，只有旧数据里存在）。
 * 这里补上写入路径：一次 LLM 调用产出"角色声音五件套"，严格 JSON。
 */
const VOICE_SYS = `你是角色台词与气质设计师。基于角色档案，产出这个角色专属的「声音五件套」。必须落到他的职业、伤疤、执念或贴身物件，禁止通用人格公式句。
【三元组落地要求】压力反应（stressResponse）与情绪雷区（triggers）要贴合他的冲突应对组：正面展望组用转移/乐观化来自我安抚、能力组先压情绪讲道理、反应组则当场把情绪推出去；气质（presence）要贴合他的社交姿态组（顺从组靠近、进攻组压上、退缩组退开）的距离感。禁止用"退缩组""能力组"这类术语，全部翻译成动作与台词。
严格只输出一行 JSON（禁止 markdown 代码块、禁止多余文字）：
{"presence":"气质与肢体语言：1-2 句，写具体的动作/习惯/距离感，不要形容词堆砌","catchphrase":["4-6 句只会从这张嘴里说出来的话，逐句用括号标注使用场合，如「（被逼问时，先笑一下）」"],"triggers":["3-4 条情绪雷区：具体到什么情境会让他失控/关闭"],"stressResponse":["3-4 条压力下的自动反应（外显行为）"],"growthResponse":["3-4 条成长/整合时的表现（他变好的样子）"]}`

export function apply(ctx: Context & { tools: any; webServer: WebServer; llm: LlmService }, config: Config): void {
  const dataDir = resolveDataDir(config.dataDir, 'character-maker-data')
  mkdirSync(dataDir, { recursive: true })
  const store = new CharacterStore(dataDir)
  const bank = loadQuestionBank()
  const novelLink = new NovelLink(resolveNovelDataDir(config.novelDataDir))

  const disposers: (() => void)[] = []
  const t = (spec: any) => disposers.push(ctx.tools.register(defineTool(spec)))

  let lastRoute: { provider: string; model: string } | null =
    config.provider && config.model ? { provider: config.provider, model: config.model } : null
  ctx.on('llm/stream', (options: any, next: any) => {
    lastRoute = { provider: options.provider, model: options.model }
    return next()
  })

  // ════════════════════════════════════════════════════════════
  // 角色互动（关系网）—— 参与方解析 / 档案摘要 / LLM 关系深析
  // ════════════════════════════════════════════════════════════
  type Participant = { key: string; name: string; model?: CharacterModel; nc?: NovelCharacter }

  function refFromKey(key: string): string {
    if (key.startsWith('novel:')) return key.split(':')[2] ?? key
    if (key.startsWith('local:')) return key.slice(6)
    if (key.startsWith('raw:')) return key.slice(4)
    return key
  }

  /** 解析一个角色引用（id 或名字）→ 稳定 key + 展示名 + 档案（优先 novel 项目内，其次本地库） */
  function resolveParticipant(ref: string, projectId?: string): Participant {
    const r = String(ref ?? '').trim()
    if (!r) return { key: 'raw:未知', name: '未知' }
    if (projectId) {
      const chars = novelLink.listCharacters(projectId)
      const nc = chars.find(c => c.id === r) ?? chars.find(c => c.name === r)
      if (nc) {
        const local = store.findBySource(projectId, nc.id)
        let model: CharacterModel | undefined = local ?? undefined
        if (!model) {
          const guess = guessEnneagramFromText([nc.personality, nc.background, nc.goal, (nc.currentState?.notes ?? '')].join(' '))
          model = buildCharacterModel({
            name: nc.name, role: (nc.role as any) ?? 'supporting', appearance: nc.appearance,
            background: nc.background, goal: nc.goal, stateNotes: nc.currentState?.notes,
            enneagram: { core: guess[0] || 1, level: 4 }, mbti: '',
          })
          model.source = { kind: 'novel', projectId, characterId: nc.id }
        }
        return { key: `novel:${projectId}:${nc.id}`, name: nc.name, model, nc }
      }
    }
    const locals = store.listCharacters()
    const local = locals.find(c => c.id === r) ?? locals.find(c => c.name === r)
    if (local) return { key: `local:${local.id}`, name: local.name, model: local }
    return { key: `raw:${r}`, name: r }
  }

  /** 把参与方压缩成一段给 LLM 的档案摘要 */
  function participantBrief(p: Participant): string {
    const m = p.model
    if (m) {
      const e = m.enneagram
      const roleLabel: Record<string, string> = { protagonist: '主角', supporting: '配角', antagonist: '反派', minor: '路人' }
      // §8.19：三元组压缩串——关系深析用它判断双方"社交姿态/冲突应对"是否错位（错位处最出戏）
      const tr = e.triads ?? triadLabels(e.core)
      const triStr = `｜三元组 ${tr.center}/${tr.hornevian}/${tr.harmonic}/${tr.harmony}`
      return `- ${m.name}（${roleLabel[m.role] ?? m.role}）：九型${e.core}号【${e.coreName}】${e.wing ? `侧翼${e.wing}` : ''}｜副型${e.subtype.toUpperCase()}(${e.subtypeLabel})｜${e.levelBand}档${triStr}；MBTI ${m.mbti || '?'}；背景：${(m.background || '无').slice(0, 120)}；目标：${(m.goal || '无').slice(0, 80)}；状态：${(m.stateNotes || '无').slice(0, 80)}${m.library?.narrative ? `；画像摘录：${m.library.narrative.replace(/[#\n\r]/g, ' ').trim().slice(0, 160)}` : ''}`
    }
    if (p.nc) {
      return `- ${p.nc.name}（${p.nc.role || '角色'}）：性格：${(p.nc.personality || '').slice(0, 140)}；背景：${(p.nc.background || '无').slice(0, 120)}；目标：${(p.nc.goal || '无').slice(0, 80)}；当前状态：${(p.nc.currentState?.notes || '').slice(0, 80)}`
    }
    return `- ${p.name}（暂无档案，仅名字）`
  }

  /** 参与方 key → 图形节点 id（同一 key 在全图复用为同一节点） */

  /** 组装某作用域的关系网（项目 or 本地/共享） */
  function buildGraph(projectId?: string): RelationshipGraph {
    const nodes = new Map<string, RelationNode>()
    const edges: RelationEdge[] = []
    const addNode = (n: RelationNode) => { if (!nodes.has(n.id)) nodes.set(n.id, n) }
    if (projectId) {
      for (const nc of novelLink.listCharacters(projectId)) {
        const m = store.findBySource(projectId, nc.id)
        addNode({
          id: `novel:${projectId}:${nc.id}`, name: nc.name, role: nc.role,
          core: m?.enneagram.core, coreName: m?.enneagram.coreName,
          group: ({ protagonist: 0, supporting: 1, antagonist: 2, minor: 3 } as any)[nc.role] ?? 4,
        })
      }
    } else {
      for (const c of store.listCharacters()) {
        const id = c.source ? `novel:${c.source.projectId}:${c.source.characterId}` : `local:${c.id}`
        addNode({ id, name: c.name, role: c.role, core: c.enneagram.core, coreName: c.enneagram.coreName, group: ({ protagonist: 0, supporting: 1, antagonist: 2, minor: 3 } as any)[c.role] ?? 4 })
      }
    }
    for (const it of store.listInteractions(projectId)) {
      addNode({ id: it.aKey, name: it.aName })
      addNode({ id: it.bKey, name: it.bName })
      edges.push({ id: it.id, source: it.aKey, target: it.bKey, type: it.type, stance: it.stance, direction: it.direction, weight: it.weight })
    }
    return { nodes: [...nodes.values()], edges }
  }

  /** 关系类型常用候选项（供 UI 输入框/工具提示） */
  const REL_TYPE_HINTS =
    '敌手/宿敌/恋人/单恋/暧昧/师徒/血亲/结拜/盟友/合伙人/上司/下属/同级/朋友/知交/情敌/仇人/恩人/利用/依附/陌路/同门/伙伴'

  /** 关系深析 system 指令（输出严格 JSON） */
  const REL_SYS = `你是资深小说角色关系分析师。请基于【双方角色档案】，深入分析这组互动，产出：
1. type：最贴切的关系类型（从：${REL_TYPE_HINTS} 中挑，或给更贴合的）
2. stance：情感立场（敌对/亲近/利用/暧昧/复杂/敬畏/依赖/疏远/欣赏/戒备…）
3. direction：谁主导这段关系、谁的姿态更明显（"a->b"=a 对 b 为主要、"b->a"=b 对 a 为主要、"a<->b"=双向对等）
4. weight：联结强度 0-10 整数（越强联结越高，敌对也可能高）
5. summary：一句话（≤20 字）概括关系本质
6. tags：2-5 个关键词
7. analysis：200-350 字 markdown 互动深析，论述这段关系如何由双方人格（核心恐惧/欲望/副型/健康层级/经历/三元组）相互作用而成、两人最容易爆发的矛盾、以及剧情上最戏剧化的张力点。必须落到具体人物，不说空话。
【三元组用法】重点看双方"社交姿态"（顺从·靠近 / 进攻·压上 / 退缩·退开）与"冲突应对"（正面展望 / 能力 / 反应）是否错位：姿态相反或应对错位之处就是摩擦的引擎——例如一方退缩、另一方进攻时，"追与逃"的循环如何具体发生在他们身上；一方用能力组"先解决情绪稍后再说"对上反应组"要的是被看见"，误会从哪一句话开始。禁止写"因为他是退缩组"这类术语句，全部翻译成动作与台词。
严格只输出一行 JSON（禁止 markdown 代码块、禁止多余文字）：
{"type":"敌手","stance":"敌对","direction":"a->b","weight":7,"summary":"志同道合的仇敌","tags":["对峙","惺惺相惜"],"analysis":"…"}`

  /**
   * LLM 深析一对：产出 JSON 关系参数 + 深析文本。
   * §8.9 修复：解析改为括号配平的 extractJsonObject，并**严格校验**——
   *   `valid=false` 表示模型没给出可用结果；调用方**不得**把这种结果落库
   *   （原实现会静默写入「互动/复杂/强度5」这类无意义边）。
   */
  async function analyzeInteraction(
    aRef: string, bRef: string, projectId?: string,
  ): Promise<{
    aKey: string; bKey: string; type: string; stance: string; direction: InteractionDirection
    weight: number; summary: string; tags: string[]; analysis: string
    valid: boolean; reason?: string
  }> {
    const pa = resolveParticipant(aRef, projectId)
    const pb = resolveParticipant(bRef, projectId)
    if (pa.key === pb.key) throw new Error('不能把同一个角色当作双方互动')
    const prompt = `【角色 A】\n${participantBrief(pa)}\n\n【角色 B】\n${participantBrief(pb)}\n\n请分析「${pa.name}」与「${pb.name}」的互动关系并输出 JSON。`
    const raw = await callLlm(ctx.llm, REL_SYS, prompt, { maxTokens: 900, temperature: 0.7, route: lastRoute })
    const j = extractJsonObject<any>(raw)

    let type = '', stance = '', direction: InteractionDirection = 'a<->b', weight = 5, summary = '', analysis = ''
    let tags: string[] = []
    if (j && typeof j === 'object') {
      if (typeof j.type === 'string' && j.type.trim()) type = j.type.trim()
      if (typeof j.stance === 'string' && j.stance.trim()) stance = j.stance.trim()
      if (typeof j.direction === 'string' && ['a->b', 'b->a', 'a<->b'].includes(j.direction)) direction = j.direction
      const w = Number(j.weight); if (Number.isFinite(w)) weight = Math.max(0, Math.min(10, Math.round(w)))
      if (typeof j.summary === 'string' && j.summary.trim()) summary = j.summary.trim()
      if (Array.isArray(j.tags)) tags = j.tags.filter((x: any) => typeof x === 'string').map((x: any) => x.trim()).filter(Boolean).slice(0, 6)
      if (typeof j.analysis === 'string' && j.analysis.trim()) analysis = j.analysis.trim()
    }

    // 校验：关系类型 / 立场 / 深析三者缺一即视为无效结果
    const missing: string[] = []
    if (!type) missing.push('type')
    if (!stance) missing.push('stance')
    if (!analysis || analysis.length < 30) missing.push('analysis(过短)')
    const valid = missing.length === 0
    if (!valid) {
      return {
        aKey: pa.key, bKey: pb.key, type: type || '互动', stance: stance || '复杂', direction, weight,
        summary: summary || `${pa.name}──${pb.name}`, tags, analysis,
        valid: false,
        reason: `模型未返回可用结果（缺 ${missing.join('/')}）。原始输出片段：${String(raw).slice(0, 160)}`,
      }
    }
    if (!summary) summary = `${pa.name}──${pb.name}之间的${type}关系`
    return { aKey: pa.key, bKey: pb.key, type, stance, direction, weight, summary, tags, analysis, valid: true }
  }

  // ── 1. 新建角色 ──
  t({
    name: 'character_new',
    description: '新建角色（可仅填基础资料，后续用 character_profile / character_trait_writer 完善）。必填 name。可选 enneagram.core(1-9号)/wing/subtype/level、mbti、bigfive。',
    parameters: {
      name: { type: 'string', description: '角色姓名', required: true },
      role: { type: 'string', enum: ['protagonist', 'supporting', 'antagonist', 'minor'], description: '定位' },
      appearance: { type: 'string', description: '外貌' },
      background: { type: 'string', description: '背景经历' },
      goal: { type: 'string', description: '核心目标/动机' },
      stateNotes: { type: 'string', description: '当前状态备注' },
      enneagram: {
        type: 'object', description: '九型设定（核心）', additionalProperties: false,
        properties: {
          core: { type: 'number', description: '主型 1-9' },
          wing: { type: 'number', description: '侧翼型号（主型相邻）' },
          subtype: { type: 'string', enum: ['sp', 'sx', 'so'], description: '本能副型：sp 自保 / sx 一对一 / so 社交。与主型组合即 27 亚型之一（如 5号+sx=知己，反型），可用 character_subtypes 速查' },
          level: { type: 'number', description: '健康层级 1-9（默认4）' },
        },
      },
      mbti: { type: 'string', description: 'MBTI 四字母，如 INTJ' },
      bigfive: {
        type: 'object', description: '大五 0-100', additionalProperties: false,
        properties: {
          Openness: { type: 'number' }, Conscientiousness: { type: 'number' }, Extraversion: { type: 'number' },
          Agreeableness: { type: 'number' }, Neuroticism: { type: 'number' },
        },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true }, name: { type: 'string', required: true }, summary: { type: 'string', required: true } } },
      render: (_a: any, v: any) => tx(`角色「${(v as any).name}」已创建 (${(v as any).id})：\n${(v as any).summary}`),
    },
    async execute(args: any) {
      const model = buildCharacterModel({
        name: args.name, role: args.role, appearance: args.appearance, background: args.background,
        goal: args.goal, stateNotes: args.stateNotes,
        enneagram: args.enneagram, mbti: args.mbti, bigfive: args.bigfive,
      })
      const saved = store.upsertCharacter(model)
      return { id: saved.id, name: saved.name, summary: renderCharacterModel(saved, bank) }
    },
  })

  // ── 2. 跑问卷 ──
  t({
    name: 'character_questionnaire',
    description: '运行人格问卷。kind: enneagram-108(是/否自评) | enneagram-144(二选一迫选) | enneagram-multifactor(39题深度) | enneagram-90(90题Likert:每型10题×9面,最完善开源九型) | mbti-93 | bigfive-60 | ipip-neo-120(大五进阶120题:5域+30子维度) | hexaco-24(六维) | sd3(黑暗三合一) | ecr-12(成人依恋) | locus-24(控制点) | mfq-30(道德基础) | pvq-21(价值观) | disc-32(DISC行为风格) | eq-22(同理心)。answers: {题号: 值}，108值为true/false(或"yes"/"no")，144/multifactor/mbti值为"a"/"b"，其余值为各自量表的数字分。返回完整计分。可传 characterId 绑定到角色。',
    parameters: {
      kind: { type: 'string', enum: ['enneagram-108', 'enneagram-144', 'enneagram-multifactor', 'enneagram-90', 'mbti-93', 'bigfive-60', 'ipip-neo-120', 'hexaco-24', 'sd3', 'ecr-12', 'locus-24', 'mfq-30', 'pvq-21', 'disc-32', 'eq-22'], description: '问卷类型', required: true },
      answers: { type: 'object', description: '作答：{题号: 值}', additionalProperties: true },
      characterId: { type: 'string', description: '可选：绑定到已有角色' },
      allowPartial: { type: 'boolean', description: 'true=允许缺题计分（默认 false：缺题 >10% 会拒绝并列出缺题清单）' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        kind: { type: 'string', required: true }, summary: { type: 'string', required: true }, detail: { type: 'string', required: true },
      } },
      render: (_a: any, v: any) => tx(`${(v as any).kind}: ${(v as any).summary}\n${(v as any).detail}`),
    },
    // §8.13：主流程抽成 runQuestionnaire，工具与 HTTP /quiz-score（UI 问卷作答界面）共用同一套逻辑
    async execute(args: any) { return runQuestionnaire(args) },
  })

  /**
   * 问卷计分主流程（工具 character_questionnaire 与 HTTP POST /quiz-score 共用）。
   * 含 §8.8 完整性校验、各问卷计分、写回角色、§8.1 完整作答记录落库。
   */
  async function runQuestionnaire(args: any) {
      const kind = args.kind as QuestionnaireKind
      const answers = args.answers ?? {}
      const norm = (v: any) => typeof v === 'string' ? (v === 'true' ? true : v === 'yes' ? true : v === 'a' ? 'a' : v === 'b' ? 'b' : v) : v
      const ans: any = {}
      for (const k of Object.keys(answers)) { const n = Number(k); if (Number.isFinite(n)) ans[n] = norm(answers[k]) }

      // §8.8：先做完整性校验，缺题过多直接拒绝（不再静默出分）
      const check = checkAnswers(kind, bank, ans)
      if (!check.ok && args.allowPartial !== true) {
        throw new Error(
          `作答不完整，已拒绝计分：共 ${check.total} 题，仅 ${check.answered} 题有作答，缺 ${check.missing.length} 题（${(check.ratio * 100).toFixed(1)}% > 10%）。\n` +
          `缺失题号：${formatMissing(check.missing)}\n` +
          `补全后重试；若确认按部分作答计分，请显式传 allowPartial=true。`,
        )
      }

      let summary = ''
      let detail = ''
      let scoresForRecord: Record<string, unknown> = {}
      if (kind === 'enneagram-108') {
        const scores = scoreEnneagram108(bank, ans)
        // §8.6：108 也推翼（原来只出主型、次高仅展示）
        const { core, wing, tie } = deriveCoreWing(scores)
        const sorted = scores.slice().sort((a, b) => (b.score - a.score) || (a.type - b.type))
        summary = `九型核心: ${core}号【${ENNEAGRAM_PROFILES[core].zh}】 侧翼: ${wing === core ? `未判定（相邻型均 0 分）` : `${core}w${wing}（${WING_NICK[`${core}w${wing}`] ?? ''}）`}${tie ? ' ⚠主型与次高平分' : ''}`
        detail = `各型得分：${sorted.map(s => `${s.type}号:${s.score}`).join(' | ')}\n` +
          `次高：${sorted[1]?.type ?? '-'}号(${sorted[1]?.score ?? 0})\n` +
          `注：108/144 题库不含本能题，副型无法由此问卷判定，请用 enneagram-multifactor / enneagram-90 或手动指定。`
        scoresForRecord = { scores, core, wing, tie }
      } else if (kind === 'enneagram-144') {
        const scores = scoreEnneagram144(bank, ans)
        const { core, wing, tie } = deriveCoreWing(scores)
        const sorted = scores.slice().sort((a, b) => (b.score - a.score) || (a.type - b.type))
        summary = `九型核心: ${core}号【${ENNEAGRAM_PROFILES[core].zh}】 侧翼: ${wing === core ? '未判定' : `${core}w${wing}（${WING_NICK[`${core}w${wing}`] ?? ''}）`}${tie ? ' ⚠主型与次高平分' : ''}`
        detail = `各型得分：${sorted.map(s => `${s.type}号:${s.score}`).join(' | ')}\n（144 为二选一迫选，同样不含本能题，副型需另测）`
        scoresForRecord = { scores, core, wing, tie }
      } else if (kind === 'enneagram-multifactor') {
        const r = scoreMultifactor(bank, ans)
        summary = `核心: ${r.wingKey}（${ENNEAGRAM_PROFILES[r.core].zh}）；Tritype: ${r.tritype}；本能叠序: ${r.stack}${r.tie ? ' ⚠主型平分' : ''}`
        // §8.5：补全题库文档化但此前未实现的派生指标
        // §8.18：按 2026-09 三元组资料正名——Harmonic 情绪应对 / Harmony(Daniels)=客体关系 / Hornevian 霍妮社交姿态
        const dz = r.dominantZh
        detail = `类型: ${r.typeScores.map(s => `${s.type}号:${s.score}`).join(' | ')}\n` +
          `本能: sp=${r.instincts.sp} sx=${r.instincts.sx} so=${r.instincts.so}；本能叠序: ${r.stackFull.join(' > ')}\n` +
          `智慧中心三元组: 腹(本能·愤怒)=${r.centers.body.toFixed(2)} 心(情感·羞耻)=${r.centers.heart.toFixed(2)} 脑(思维·恐惧)=${r.centers.head.toFixed(2)}（主导：${dz.center}）\n` +
          `Harmonic 情绪应对三元组: 反应组(4/6/8)=${r.harmonicGroups.reactive.toFixed(2)} 正面展望组(2/7/9)=${r.harmonicGroups.positive.toFixed(2)} 能力组(1/3/5)=${r.harmonicGroups.competency.toFixed(2)}（主导：${dz.harmonic}）\n` +
          `Harmony 和谐三元组/客体关系(Daniels·Gore): 实用主义者·依附(3/6/9)=${r.harmonyDaniels.pragmatist.toFixed(2)} 理想主义者·挫折(1/4/7)=${r.harmonyDaniels.idealist.toFixed(2)} 关系主义者·拒绝(2/5/8)=${r.harmonyDaniels.relationist.toFixed(2)}（主导：${dz.harmony}）\n` +
          `Hornevian 社交姿态(霍妮): 顺从组·朝人靠近(1/2/6)=${r.hornevianGroups.compliant.toFixed(2)} 进攻组·对抗(3/7/8)=${r.hornevianGroups.assertive.toFixed(2)} 退缩组·远离(4/5/9)=${r.hornevianGroups.withdrawn.toFixed(2)}（主导：${dz.hornevian}）\n` +
          `明暗六角: 光明=${r.lightDark.light.toFixed(2)} 黑暗=${r.lightDark.dark.toFixed(2)}（主导：${dz.lightDark}）`
        scoresForRecord = {
          core: r.core, wing: r.wing, wingKey: r.wingKey, tie: r.tie,
          types: r.types, instincts: r.instincts, stackFull: r.stackFull, tritype: r.tritype,
          centers: r.centers, harmonyTriads: r.harmonyTriads, objectRelations: r.objectRelations,
          hornevian: r.hornevian, lightDark: r.lightDark, dominant: r.dominant,
          harmonicGroups: r.harmonicGroups, harmonyDaniels: r.harmonyDaniels,
          hornevianGroups: r.hornevianGroups, dominantZh: r.dominantZh,
        }
        if (args.characterId) {
          const ch = store.getCharacter(args.characterId)
          if (ch) {
            const sub = (r.stackFull[0] as 'sp' | 'sx' | 'so') || ch.enneagram.subtype
            const model = buildCharacterModel({
              name: ch.name, role: ch.role, appearance: ch.appearance, background: ch.background,
              goal: ch.goal, stateNotes: ch.stateNotes,
              enneagram: { core: r.core, wing: r.wing, subtype: sub, level: ch.enneagram.level },
              mbti: ch.mbti, bigfive: ch.bigfive,
            })
            model.id = ch.id; model.createdAt = ch.createdAt; model.source = ch.source
            store.upsertCharacter(model)
          }
        }
      } else if (kind === 'enneagram-90') {
        const bank90 = bank.enneagram90
        if (!bank90) throw new Error('题库未加载: enneagram-90')
        const r = scoreLikertBank(bank90, ans)
        const t = enneagram90Type(r.scores)
        summary = `九型核心: ${t.core}号【${ENNEAGRAM_PROFILES[t.core].zh}】 最佳翼: ${t.wing}号${t.tie ? ' ⚠主型平分' : ''}`
        detail = `九型各型得分：${t.ranking.map(x => `${x.type}号=${x.score}`).join(' | ')}` +
          (r.missing.length ? `\n⚠缺题 ${r.missing.length} 题：${formatMissing(r.missing)}` : '')
        scoresForRecord = { scores: r.scores, rawScores: r.rawScores, core: t.core, wing: t.wing, tie: t.tie, ranking: t.ranking, missing: r.missing }
        if (args.characterId) {
          const ch = store.getCharacter(args.characterId)
          if (ch) {
            const model = buildCharacterModel({
              name: ch.name, role: ch.role, appearance: ch.appearance, background: ch.background,
              goal: ch.goal, stateNotes: ch.stateNotes,
              enneagram: { core: t.core, wing: t.wing, subtype: ch.enneagram.subtype, level: ch.enneagram.level },
              mbti: ch.mbti, bigfive: ch.bigfive,
            })
            model.id = ch.id; model.createdAt = ch.createdAt; model.source = ch.source
            store.upsertCharacter(model)
            summary += '（已写回角色）'
          }
        }
      } else if (kind === 'mbti-93') {
        const r = scoreMbti(bank, ans)
        summary = `MBTI: ${r.code}`
        detail = `各字母计数：${JSON.stringify(r.counts)}` +
          (r.ties.length ? `\n⚠平局轴：${r.ties.join('、')}（平局偏向 E/S/T/J）` : '') +
          (r.skipped.length ? `\n⚠已跳过跨轴题（题库 bug，第 ${r.skipped.join(',')} 题，两选项分属不同轴，计分会同时污染两个轴）` : '')
        scoresForRecord = { code: r.code, counts: r.counts, ties: r.ties, skipped: r.skipped, answered: r.answered }
        // 绑定角色：实测结果写回模型（来源标记 quiz，优先于 AI 推断）
        if (args.characterId) {
          const ch = store.getCharacter(args.characterId)
          if (ch) {
            ch.mbti = r.code
            ch.mbtiSource = 'quiz'
            ch.mbtiDetail = mbtiAnalysis(r.code, bank)
            store.upsertCharacter(ch)
            summary += '（已写回角色）'
          }
        }
      } else if (kind === 'bigfive-60') {
        const r = scoreBigfive(bank, ans)
        summary = `大五: ${(['Openness', 'Conscientiousness', 'Extraversion', 'Agreeableness', 'Neuroticism'] as const).map(k => `${BMAP[k]}=${r[k]}`).join(' ')}`
        detail = `各维 0-100 分：${JSON.stringify(r)}\n（原始均分 raw 见括号：${Object.entries(r.raw).map(([k, v]) => `${BMAP[k] ?? k}=${v}`).join(' ')}）`
        scoresForRecord = { ...r }
        if (args.characterId) {
          const ch = store.getCharacter(args.characterId)
          if (ch) {
            const b5: any = {}
            for (const k of ['Openness', 'Conscientiousness', 'Extraversion', 'Agreeableness', 'Neuroticism'] as const) {
              if (typeof r[k] === 'number') b5[k] = r[k]
            }
            if (Object.keys(b5).length) {
              ch.bigfive = b5
              ch.bigfiveSource = 'quiz'
              store.upsertCharacter(ch)
              summary += '（已写回角色）'
            }
          }
        }
      } else if (kind === 'ipip-neo-120') {
        const r = scoreIpipNeo120(bank, ans)
        const label = { Neuroticism: '神经质', Extraversion: '外向性', Openness: '开放性', Agreeableness: '宜人性', Conscientiousness: '尽责性' }
        summary = `大五(IPIP-NEO-120): ${(['Neuroticism', 'Extraversion', 'Openness', 'Agreeableness', 'Conscientiousness'] as const).map(k => `${label[k]}=${r.big[k] ?? '?'}`).join(' ')}`
        detail = '30 子维度：\n' + Object.entries(r.facets)
          .map(([k, v]) => `${r.facetLabel[k] ?? k}=${v}`)
          .join('\n')
        scoresForRecord = { big: r.big, facets: r.facets, facetLabel: r.facetLabel }
        // 绑定角色：写回大五总分
        if (args.characterId) {
          const ch = store.getCharacter(args.characterId)
          if (ch) {
            const b5: any = {}
            for (const k of ['Neuroticism', 'Extraversion', 'Openness', 'Agreeableness', 'Conscientiousness'] as const) {
              if (typeof r.big[k] === 'number') b5[{ Neuroticism: 'N', Extraversion: 'E', Openness: 'O', Agreeableness: 'A', Conscientiousness: 'C' }[k]] = r.big[k]
            }
            // bigfive 字段用英文 key 存（与 BFI 一致），同时存 30 子维度
            const b5en: any = {}
            for (const k of ['Neuroticism', 'Extraversion', 'Openness', 'Agreeableness', 'Conscientiousness'] as const) {
              if (typeof r.big[k] === 'number') b5en[k] = r.big[k]
            }
            if (Object.keys(b5en).length) {
              ch.bigfive = b5en
              ch.bigfiveSource = 'quiz'
              // §8.3：ipipFacets / ipipFacetLabel 为 CharacterModel 正式字段
              ch.ipipFacets = r.facets
              ch.ipipFacetLabel = r.facetLabel
              store.upsertCharacter(ch)
              summary += '（已写回角色）'
            }
          }
        }
      } else if (kind === 'hexaco-24' || kind === 'sd3' || kind === 'ecr-12' || kind === 'locus-24' || kind === 'mfq-30' || kind === 'pvq-21' || kind === 'disc-32' || kind === 'eq-22') {
        // 通用维度问卷（Likert），共用 scoreLikertBank
        const bankMap: any = {
          'hexaco-24': bank.hexaco24, 'sd3': bank.sd3, 'ecr-12': bank.ecr12,
          'locus-24': bank.locus24, 'mfq-30': bank.mfq30, 'pvq-21': bank.pvq21,
          'disc-32': bank.disc32, 'eq-22': bank.eq22,
        }
        const nameMap: Record<string, string> = {
          'hexaco-24': 'HEXACO 六维', 'sd3': '黑暗三合一', 'ecr-12': '成人依恋(ECR-S)',
          'locus-24': '控制点(IPC)', 'mfq-30': '道德基础(MFQ-30)', 'pvq-21': '价值观(PVQ-21)',
          'disc-32': 'DISC 行为风格', 'eq-22': '同理心(EQ)',
        }
        const lkb = bankMap[kind]
        if (!lkb) throw new Error('题库未加载: ' + kind)
        const r = scoreLikertBank(lkb, ans)
        summary = `${nameMap[kind]}: ${lkb.dimensions.map((d: any) => `${d.label}=${r.scores[d.id] ?? '?'}`).join(' ')}`
        detail = `${nameMap[kind]} 各维度(0-100)：\n` + lkb.dimensions.map((d: any) => `${d.label}=${r.scores[d.id] ?? '?'}（原始均分 ${r.rawScores[d.id] ?? '?'}）`).join('\n') +
          (r.missing.length ? `\n⚠缺题 ${r.missing.length} 题：${formatMissing(r.missing)}` : '')
        scoresForRecord = { scores: r.scores, rawScores: r.rawScores, dimLabels: r.dimLabels, missing: r.missing, scaleMin: lkb.scaleMin, scaleMax: lkb.scaleMax }
        if (args.characterId) {
          const ch = store.getCharacter(args.characterId)
          if (ch) {
            // §8.3：scales 已是 CharacterModel 的正式字段（不再是 (ch as any)）
            const scales = ch.scales ?? {}
            scales[kind] = { name: nameMap[kind], scores: r.scores, raw: r.rawScores, labels: r.dimLabels, scaleMin: lkb.scaleMin, scaleMax: lkb.scaleMax }
            ch.scales = scales
            store.upsertCharacter(ch)
            summary += '（已写回角色）'
          }
        }
      } else {
        throw new Error('未知问卷: ' + kind)
      }

      // §8.1：存完整作答记录（原始作答 + 计分明细 + 缺题），可复盘/重算/对比历史
      const rec = store.addQuizResult({
        kind,
        characterId: args.characterId,
        answers: answers as Record<string, unknown>,
        scores: scoresForRecord,
        summary,
        missing: check.missing.length ? check.missing : undefined,
      })
      if (!check.ok) summary += ` ⚠按部分作答计分（缺 ${check.missing.length} 题）`
      detail += `\n\n[作答记录 ${rec.id}] ${check.note}`
      return { kind, summary, detail, recordId: rec.id, missing: check.missing, checkNote: check.note, scores: scoresForRecord }
  }

  // ── 2b. 问卷作答历史 / 复盘 ──
  t({
    name: 'character_quiz_history',
    description: '查看问卷作答历史（§8.1：含原始作答与计分明细，可复盘/重算/对比）。可选 characterId 只看某角色，kind 只看某问卷；latest=true 只返回最近一条的完整原始作答与分数。',
    parameters: {
      characterId: { type: 'string', description: '可选：只看某角色' },
      kind: { type: 'string', description: '可选：只看某问卷类型' },
      latest: { type: 'boolean', description: 'true=只返回最近一条的完整明细（含原始作答 JSON）' },
      limit: { type: 'number', description: '返回条数（默认 20，最大 100）' },
    },
    output: { schema: { type: 'object', additionalProperties: false, properties: { list: { type: 'string', required: true } } }, render: (_a: any, v: any) => tx((v as any).list) },
    async execute(args: any) {
      let list = store.listQuizResults(args.characterId)
      if (args.kind) list = list.filter(q => q.kind === args.kind)
      if (list.length === 0) return { list: '（暂无作答记录）' }
      const nameOf = (id?: string) => (id ? (store.getCharacter(id)?.name ?? id) : '（未绑定角色）')
      if (args.latest) {
        const q = list[0]
        const answers = q.answers ?? {}
        return {
          list: `【最近一次作答】${q.kind} · ${nameOf(q.characterId)} · ${q.finishedAt}\n` +
            `记录 id：${q.id}\n摘要：${q.summary ?? '（无）'}\n` +
            (q.missing?.length ? `缺题：${formatMissing(q.missing)}\n` : '') +
            `\n原始作答（${Object.keys(answers).length} 项）：\n${JSON.stringify(answers)}\n\n` +
            `计分明细：\n${JSON.stringify(q.scores ?? {}, null, 2)}`,
        }
      }
      const limit = Math.min(Math.max(Number(args.limit ?? 20) || 20, 1), 100)
      return {
        list: list.slice(0, limit).map(q =>
          `- [${q.finishedAt.replace('T', ' ').slice(0, 19)}] ${q.kind} · ${nameOf(q.characterId)}${q.missing?.length ? `（缺 ${q.missing.length} 题）` : ''}${q.answers ? ' ✓含原始作答' : '（旧记录·无原始作答）'}\n  ${q.summary ?? ''} [${q.id}]`,
        ).join('\n') + `\n\n共 ${list.length} 条（显示前 ${Math.min(limit, list.length)} 条）。用 latest=true 看完整明细。`,
      }
    },
  })

  // ── 2c. 声音五件套（§8.17：给死字段补写入路径） ──
  t({
    name: 'character_voice',
    description: '为角色生成「声音五件套」：气质/肢体语言（presence）、个性化口头禅（catchphrase，含使用场合）、情绪雷区（triggers）、压力反应（stressResponse）、成长反应（growthResponse）。这些字段此前无写入路径（死字段），现由 LLM 依角色档案生成并写回角色。可传 characterId，或 novelProjectId+novelCharacterId 联动。force=true 强制重新生成（默认仅在缺失时生成）。',
    parameters: {
      characterId: { type: 'string', description: '本插件已有角色 id' },
      novelProjectId: { type: 'string', description: '联动：novel-writer 项目 id' },
      novelCharacterId: { type: 'string', description: '联动：novel-writer 人物 id' },
      force: { type: 'boolean', description: 'true=即使已有也重新生成（默认 false）' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true }, wrote: { type: 'string', required: true } } },
      render: (_a: any, v: any) => tx((v as any).text),
    },
    async execute(args: any) {
      let ch: CharacterModel | null = null
      let source: { kind: 'novel'; projectId: string; characterId: string } | null = null
      if (args.characterId) ch = store.getCharacter(args.characterId)
      else if (args.novelProjectId && args.novelCharacterId) {
        source = { kind: 'novel', projectId: args.novelProjectId, characterId: args.novelCharacterId }
        const nc = novelLink.getCharacter(args.novelProjectId, args.novelCharacterId)
        if (nc) {
          const existing = store.findBySource(args.novelProjectId, args.novelCharacterId)
          if (existing) ch = existing
          else {
            const guess = guessEnneagramFromText([nc.personality, nc.background, nc.goal].join(' '))
            ch = buildCharacterModel({
              name: nc.name, role: (nc.role as any) ?? 'supporting', appearance: nc.appearance,
              background: nc.background, goal: nc.goal, stateNotes: nc.currentState?.notes,
              enneagram: { core: guess[0] || 5, level: 4 }, mbti: '',
            })
            ch.source = source
          }
        }
      }
      if (!ch) throw new Error('需要 characterId，或 novelProjectId+novelCharacterId（且能取到角色资料）')
      const wrote = await fillVoice(ch, args.force === true)
      if (wrote.length) store.upsertCharacter(ch)
      const e = ch.enneagram
      const text = wrote.length === 0
        ? `角色「${ch.name}」已有声音五件套，未重新生成（需要覆盖请传 force=true）。\n` +
          `气质：${e.presence ?? '（无）'}\n口头禅：${e.catchphrase?.join(' ｜ ') ?? '（无）'}\n雷区：${e.triggers?.join('；') ?? '（无）'}\n压力反应：${e.stressResponse?.join('；') ?? '（无）'}\n成长反应：${e.growthResponse?.join('；') ?? '（无）'}`
        : `【${ch.name} · 声音五件套】（已写入 ${wrote.join('/')}）\n\n` +
          `▎气质/肢体：${e.presence ?? '（无）'}\n\n` +
          `▎个性化口头禅：\n${(e.catchphrase ?? []).map(x => '  · ' + x).join('\n') || '（无）'}\n\n` +
          `▎情绪雷区：\n${(e.triggers ?? []).map(x => '  · ' + x).join('\n') || '（无）'}\n\n` +
          `▎压力反应：\n${(e.stressResponse ?? []).map(x => '  · ' + x).join('\n') || '（无）'}\n\n` +
          `▎成长反应：\n${(e.growthResponse ?? []).map(x => '  · ' + x).join('\n') || '（无）'}`
      return { text, wrote: wrote.join(',') }
    },
  })

  // ── §8.20/§8.21 三要素：动机 / 缺陷 / 细节（创作层详实块） ──
  const ES_SYS = `你是小说角色的"高密度侧写师"。一次产出角色的三要素（MFD）：动机 / 缺陷 / 细节。目标不是贴标签，而是给出**能直接写进正文、能在后面好几章反复调用**的实体。禁止报菜名式人格术语（如"他是退缩组所以……"）、禁止"缺爱／自我救赎／内心孤独"这类空词——凡概念必须落到具体的人、事、物、场景、一句台词上。绝不套模板、绝不说空话。

三要素各自的地基（每一项都要接住【已知资料】和【故事大纲锚定】）：

一、动机 M —— 一枚分成主动机与次动机的"双齿轮"，并且要带紧迫感。
　主动机：长期主驱动，是整个故事线压在他背上最重的那块；必须足够强烈、能逼他走到底（尤其主角）。
　次动机：当下的短期目标/眼前的一步，常是主动机可被握住的那只手，让行动"今晚就能发生"。
　紧迫感：他为什么是现在、此刻动起来？拖不起、等不了的那个理由是什么。（主角若没有紧迫感，行动就会散。）
　触发器：3 个会让他当场动起来的开关（具体到情境）；越界开关：那根他平时绝不肯松、一旦被踩就破戒的弦。
　主动机与次动机之间最好有张力（长期想要的东西 / 眼前正做的事，未必一致）。

二、缺陷 F —— 一个会让他（或他身边的人）付出代价的灰度，且这个灰度要和动机顶牛。
　type 必须从【缺陷类型学】里选最贴的一个 key；kind 标注缺陷所在的维度（性格／能力／生理／习惯…，可不限于此）。
　cost 落到"在哪一段关系／哪一件事上会炸开"的具体事由，禁止写成"他太理性所以孤独"。
　conflictWithMotivation：这处缺陷与他动机的冲突点——动机越急着达成某件事，这处缺陷越会在关键处拖后腿/搞砸，矛盾处就是戏剧发动机。
　keepsCharm：对正派/主角，如何让这处缺陷"真实、能引发共鸣"又不损角色魅力——给他一个读者会心软的角度（他也在为此难受/为此挣扎，而不是单纯惹人厌）。
　growth：把这处缺陷补上后会变成什么，并挂进这条故事线的生存弧光。

三、细节 D —— 围绕他的性格与过往，以 1-2 处"核心细节"打底，其余为锦上添花的补充。
　core=true 的核心细节（1-2 处）：从性格内核与过往印记里长出来，全书反复回响、作者一提笔就能勾住读者的锚点。
　其余细节为补充（共 3-5 处），全部从他的身份／职业／外貌／持有物／经历／口头禅里长出来，不许凭空造。
　每处给 aspect + desc + hook；hook=true 表示"这是埋伏笔、后面该回收它"（1-2 处）。

只输出一行 JSON，字段名不许改，把下面的骨架占位替换为角色的真实内容：
{"motivation":{"primary":"主动机（长期主驱动，强烈到能逼他走完故事线）","secondary":"次动机（当下的短期目标/一步）","urgency":"紧迫感来源（为什么是现在、拖不起）","trigger":["触发器1","触发器2","触发器3"],"crossLine":"越界开关（被踩才破戒的弦）","source":"auto或manual"},"flaw":{"name":"缺陷名","type":"缺陷类型学里的一个key","kind":"性格/能力/生理/习惯等维度","cost":"会在哪个关系/哪件事上炸开（具体场景）","conflictWithMotivation":"它如何与动机顶牛（矛盾处即戏剧发动机）","keepsCharm":"正派保魅力的写法（真实共鸣又不招人厌）","growth":"补上后变成什么（挂进生存弧光）"},"detail":[{"core":true,"aspect":"small_action(小动作)/object(物件)/phrase_origin(口头禅由头)/body_mark(身体标记)/relation_code(关系密码)/plot_hook(剧情钩子)","desc":"可复现的一句话","hook":false}]}

质量红线（不达标即不合格）：
- 给了大纲/故事锚定，动机却写成通用欲望、或主动机不够强烈、没有紧迫感 → 不合格。
- 缺陷不与动机冲突、或只贴人格标签没落到"会炸开的某件事"、或让主角魅力受损 → 不合格。
- 细节脱离他的性格/过往/身份、或与核心细节同质堆砌、或无法被正文复用 → 不合格。
- 缺陷与动机正向冲突可以，甚至更好；但每一项内部必须自洽。

只输出那一行 JSON，禁止 markdown 代码块、禁止解释文字。`
  t({
    name: 'character_essentials',
    description: '为角色生成/刷新「三要素」：动机（自动读 novel-writer 项目大纲锚定故事线，可手动覆盖）、缺陷（会让人付出代价的灰度，带类型学）、细节（3-5 处可复现可回收的专属质感）。传 characterId，或 novelProjectId+novelCharacterId 联动；persist=true 时联动写回 novel。force=true 强制覆盖；motivationManual/flawManual/detailFocus 可手动主导。',
    parameters: {
      characterId: { type: 'string', description: '本插件已有角色 id' },
      novelProjectId: { type: 'string', description: '联动：novel-writer 项目 id' },
      novelCharacterId: { type: 'string', description: '联动：novel-writer 人物 id' },
      force: { type: 'boolean', description: 'true=即使已有也重新生成（默认 false，仅缺失时生成）' },
      motivationManual: { type: 'string', description: '手动指定动机（覆盖自动锚定）：如"他其实想逃离成为副本的主线，却在保护大家的过程中留下"', },
      flawManual: { type: 'string', description: '手动指定缺陷方向：如"过度理性化，分析一切包括爱人"' },
      detailFocus: { type: 'string', description: '细节聚焦方向：如"围绕他左腕的旧疤和收藏的旧书脊"' },
      persist: { type: 'boolean', description: '联动时是否写回 novel 角色 personalityProfile（默认 false）' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true }, wrote: { type: 'string', required: true } } },
      render: (_a: any, v: any) => tx((v as any).text),
    },
    async execute(args: any) {
      let ch: CharacterModel | null = null
      let projectCtx: { premise: string; genre: string; style: string; outlineText: string } | null = null
      if (args.characterId) ch = store.getCharacter(args.characterId)
      else if (args.novelProjectId && args.novelCharacterId) {
        const nc = novelLink.getCharacter(args.novelProjectId, args.novelCharacterId)
        const existing = store.findBySource(args.novelProjectId, args.novelCharacterId)
        if (nc) {
          if (existing) ch = existing
          else {
            const guess = guessEnneagramFromText([nc.personality, nc.background, nc.goal].join(' '))
            ch = buildCharacterModel({
              name: nc.name, role: (nc.role as any) ?? 'supporting', appearance: nc.appearance,
              background: nc.background, goal: nc.goal, stateNotes: nc.currentState?.notes,
              enneagram: { core: guess[0] || 5, level: 4 }, mbti: '',
            })
            ch.source = { kind: 'novel', projectId: args.novelProjectId, characterId: args.novelCharacterId }
          }
          projectCtx = novelLink.projectContext(args.novelProjectId)
        }
      }
      if (!ch) throw new Error('需要 characterId，或 novelProjectId+novelCharacterId（且能取到角色资料）')
      if (ch.essentials && args.force !== true && !args.motivationManual && !args.flawManual && !args.detailFocus) {
        const es = ch.essentials
        return { text: `角色「${ch.name}」已有三要素(更新于 ${es.updatedAt ?? '未知'})，未重新生成（要覆盖请传 force=true，或给 motivationManual/flawManual/detailFocus 定向重写）。\n${essentialsBrief(es)}`, wrote: '' }
      }
      const e = ch.enneagram
      const core = e.core
      const sub = e.subtype
      const facts: string[] = []
      if (ch.appearance) facts.push('外貌：' + ch.appearance)
      if (ch.background) facts.push('背景经历：' + ch.background)
      if (ch.goal) facts.push('目标/动机：' + ch.goal)
      if (ch.stateNotes) facts.push('当前状态：' + ch.stateNotes)
      if (e.traits?.length) facts.push(`性格特质：${e.traits.join('；')}`)
      facts.push(`型号 ${core}号【${e.coreName}】副型 ${e.subtype.toUpperCase()}·${e.subtypeLabel}`)
      // §8.20 优化：接入已有知识库，让 M/F/D 都有落点——
      // 三元组给"社交姿态/冲突应对/客体关系"的素材，口头禅给 detail 的 phrase_origin 由头
      facts.push(triadFactsLine(e.core))
      if (e.catchphrase?.length) facts.push('已有口头禅（细节可从此长出来）：' + e.catchphrase.map(x => x.replace(/「|」/g, '')).join(' ｜ '))
      if (e.triggers?.length) facts.push('已有情绪雷区（细节/越界开关可参考）：' + e.triggers.join('；'))
      // 缺陷候选 + 类型学
      const seed = flawSeed(core, sub)
      facts.push(`缺陷候选（从此挑/贴近，或自创）：${seed.map(s => `「${s.name}」→${s.cost}`).join(' ｜ ')}`)
      facts.push(`缺陷类型学：${flawTypesLine()}`)
      // 动机故事锚定
      let override = ''
      if (args.motivationManual) override += `\n【手动动机】${args.motivationManual}（以此为准，忽略自动）`
      if (args.flawManual) override += `\n【手动缺陷】${args.flawManual}`
      if (args.detailFocus) override += `\n【细节聚焦】${args.detailFocus}`
      let story = ''
      let motSource: 'auto' | 'manual' = 'manual'
      if (projectCtx?.premise || projectCtx?.outlineText) {
        story = `\n【故事大纲锚定】premise：${projectCtx.premise || '（无）'}（${projectCtx.genre || ''} / ${projectCtx.style || ''}）\n大纲概要：${projectCtx.outlineText || '（无）'}`
        motSource = 'auto'
      }
      const prompt = `角色：${ch.name}\n【已知资料】\n${facts.join('\n')}\n${story}${override}\n\n请产出三要素并输出 JSON：motivation.source 填「${motSource}」（${motSource === 'auto' ? '已给你大纲锚定，动机必须接住它' : '未给大纲锚定，动机从本人经历/目标里长出来'}）。`
      const raw = await callLlm(ctx.llm, ES_SYS, prompt, { maxTokens: 2200, temperature: 0.85, route: lastRoute })
      const j = extractJsonObject<any>(raw)
      if (!j || (!j.motivation && !j.flaw && !j.detail)) throw new Error('三要素解析失败（LLM 未给出可用 JSON）')
      ch.essentials = {
        motivation: j.motivation ?? ch.essentials?.motivation,
        flaw: j.flaw ?? ch.essentials?.flaw,
        detail: Array.isArray(j.detail) ? j.detail : ch.essentials?.detail,
        updatedAt: new Date().toISOString(),
      }
      store.upsertCharacter(ch)
      let wrote = ''
      if (args.persist === true && ch.source?.kind === 'novel') {
        const res = novelLink.writePersonalityProfile(ch.source.projectId, ch.source.characterId, renderCharacterModel(ch, bank))
        wrote = res.ok ? '已写回 novel' : ('写回失败:' + res.message)
      }
      return { text: renderCharacterModel(ch, bank), wrote }
    },
  })
  t({
    name: 'character_selftest',
    description: '插件自检：用合成作答跑全部 15 种问卷的计分器、校验九型/大五/关系派生逻辑、store 读写与 schema 版本，输出 PASS/FAIL 清单。用于改动后快速回归（不改动任何真实数据）。',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: false, properties: { report: { type: 'string', required: true }, failed: { type: 'number', required: true } } }, render: (_a: any, v: any) => tx((v as any).report) },
    async execute() {
      const { runSelfTest } = await import('./selftest.js')
      const r = runSelfTest(bank)
      return { report: r.report, failed: r.failed }
    },
  })
  t({
    name: 'character_profile',
    description: '基于已有角色（或 novel-writer 人物）完善角色模型：推断九型核心/副型，生成行为清单与弧光建议（含三元组社交姿态/冲突应对/客体关系），并用 LLM 产出六节深度人格画像（详析/思维/行为/样例/口头禅/解读）。传 characterId(本插件) 或 novelProjectId+novelCharacterId(联动)。可选 overrides 覆盖推断。返回完整角色卡文本。',
    parameters: {
      characterId: { type: 'string', description: '本插件已有角色 id' },
      novelProjectId: { type: 'string', description: '联动：novel-writer 项目 id' },
      novelCharacterId: { type: 'string', description: '联动：novel-writer 人物 id' },
      overrides: {
        type: 'object', description: '覆盖推断：{core, wing, subtype, level, mbti}', additionalProperties: false,
        properties: {
          core: { type: 'number' }, wing: { type: 'number' }, subtype: { type: 'string', enum: ['sp', 'sx', 'so'] },
          level: { type: 'number' }, mbti: { type: 'string' },
        },
      },
      persist: { type: 'boolean', description: 'true=写回 novel-writer personalityProfile（联动时）', default: true },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        model: { type: 'string', required: true }, profile: { type: 'string', required: true },
      } },
      render: (_a: any, v: any) => tx((v as any).profile),
    },
    async execute(args: any) {
      let ch: CharacterModel | null = null
      let novelChar: NovelCharacter | null = null
      if (args.characterId) ch = store.getCharacter(args.characterId)
      else if (args.novelProjectId && args.novelCharacterId) {
        const nc = novelLink.getCharacter(args.novelProjectId, args.novelCharacterId)
        if (nc) {
          novelChar = nc
          const existing = store.findBySource(args.novelProjectId, args.novelCharacterId)
          const guess = guessEnneagramFromText([nc.personality, nc.background, nc.goal, (nc.currentState?.notes ?? '')].join(' '))
          const core = Number(args.overrides?.core) || guess[0] || 1
          ch = buildCharacterModel({
            name: nc.name, role: (nc.role as any) ?? 'supporting', appearance: nc.appearance,
            background: nc.background, goal: nc.goal, stateNotes: nc.currentState?.notes,
            enneagram: { core, wing: Number(args.overrides?.wing) || undefined, subtype: args.overrides?.subtype, level: Number(args.overrides?.level) || 4 },
            mbti: args.overrides?.mbti || existing?.mbti || '',
          })
          ch.source = { kind: 'novel', projectId: args.novelProjectId, characterId: args.novelCharacterId }
          if (existing) ch.id = existing.id
        }
      }
      if (!ch) {
        if (!args.characterId && !(args.novelProjectId && args.novelCharacterId)) throw new Error('需要 characterId 或 novelProjectId+novelCharacterId')
        if (args.characterId) { const c = store.getCharacter(args.characterId); if (c) ch = c }
      }
      if (!ch) throw new Error('角色不存在')

      // §8.19：已有（本地）角色先按当前知识库 + overrides 重建派生字段，
      // 再进行 LLM 详析。旧实现只把 narrative 挂回原模型，导致：
      //   ① overrides 对本地角色静默失效；② behaviors/arcAdvice 永远停留在旧版
      //   （新增的三元组行为与弧光建议写不进去，而工具描述承诺了"生成行为清单与弧光建议"）。
      if (ch.source?.kind !== 'novel') {
        const ov = args.overrides ?? {}
        const before = ch
        const rebuilt = buildCharacterModel({
          name: before.name, role: before.role, appearance: before.appearance,
          background: before.background, goal: before.goal, stateNotes: before.stateNotes,
          enneagram: {
            core: Number(ov.core) || before.enneagram.core,
            wing: ov.wing ?? before.enneagram.wing,
            subtype: (ov.subtype as any) ?? before.enneagram.subtype,
            level: Number(ov.level) || before.enneagram.level,
          },
          mbti: ov.mbti || before.mbti,
          bigfive: before.bigfive,
        })
        // 既有资料与来源原样保留（只刷新派生字段）
        rebuilt.id = before.id
        rebuilt.createdAt = before.createdAt
        rebuilt.source = before.source
        rebuilt.library = before.library
        rebuilt.essentials = before.essentials
        rebuilt.mbtiSource = before.mbtiSource
        rebuilt.mbtiDetail = before.mbtiDetail
        rebuilt.bigfiveSource = before.bigfiveSource
        rebuilt.testsNote = before.testsNote
        rebuilt.ipipFacets = before.ipipFacets
        rebuilt.ipipFacetLabel = before.ipipFacetLabel
        rebuilt.scales = before.scales
        ch = rebuilt
      }

      // LLM 深度画像（六节）
      try {
        if (ctx.llm) {
          const e2 = ch.enneagram
          const facts: string[] = []
          if (ch.appearance) facts.push('外貌：' + ch.appearance)
          if (ch.background) facts.push('背景经历：' + ch.background)
          if (ch.goal) facts.push('目标/动机：' + ch.goal)
          if (ch.stateNotes) facts.push('当前状态备注：' + ch.stateNotes)
          const personaFacts = [
            `九型 ${e2.core}号【${e2.coreName}】 核心恐惧「${e2.fear[0]}」、核心欲望「${e2.desire[0]}」`,
            `侧翼 ${e2.wing}（${e2.wingNick}）｜ 压力方向 ${e2.core}→${e2.stressArrow}号；整合方向 ${e2.core}→${e2.growthArrow}号`,
            `本能副型 ${e2.subtype.toUpperCase()}·${e2.subtypeLabel}${e2.subtypeTraits?.length ? ` —— ${e2.subtypeTraits.join('；')}` : ''}｜ 健康层级 ${e2.level}级(${e2.levelBand}档)`,
            // §8.19：三元组四套归属（详析素材）
            triadFactsLine(e2.core),
            // §8.20：三要素（动机/缺陷/细节）
            ch.essentials ? essentialsBrief(ch.essentials) : '',
            ch.mbti ? `MBTI：${ch.mbti}` : '',
          ].filter(Boolean).join('\n')
          const triadHooks = triadWritingHooks(e2.core).map(h => `- ${h}`).join('\n')
          const deepPrompt = `角色：${ch.name}\n【已知资料】\n${facts.join('\n') || '（暂无具体背景填写）'}\n\n【人格档案】\n${personaFacts}\n\n【三元组写作落点】\n${triadHooks}\n请严格按 system 的六节结构输出。`
          const deep = await callLlm(ctx.llm, DEEP_SYS, deepPrompt, { maxTokens: 9000, temperature: 0.8, route: lastRoute })
          if (deep && deep.trim()) {
            ch.library = ch.library ?? {}
            ch.library.narrative = deep.trim()
          }
        }
      } catch { /* 深度生成失败不阻断基础卡 */ }

      // 其余量表（HEXACO/SD3/依恋/控制点/道德/价值观/DISC/同理心）缺失时由 AI 自动作答写入 ch.scales，随卡渲染
      try {
        const _r = await inferAllScales(ch)
      } catch { /* 失败不阻断基础卡 */ }

      const modelText = renderCharacterModel(ch, bank)
      const saved = store.upsertCharacter(ch)

      let profile = modelText
      if (args.persist !== false && args.novelProjectId && args.novelCharacterId) {
        const res = novelLink.writePersonalityProfile(args.novelProjectId, args.novelCharacterId, modelText)
        profile = modelText + (res.ok ? `\n[已联动写回 novel-writer: ${res.message}]` : `\n[联动写回失败: ${res.message}]`)
      }
      return { model: profile, profile }
    },
  })

  // ── 4/5. 角色管理 ──
  t({
    name: 'character_list',
    description: '列出已保存的角色模型（独立库）。',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: false, properties: { list: { type: 'string', required: true } } }, render: (_a: any, v: any) => tx((v as any).list) },
    async execute() {
      const list = store.listCharacters()
      return { list: list.length === 0 ? '（空）' : list.map(c => `- ${c.name} [${c.id}${c.source?.kind === 'novel' ? ' ←novel' : ''}] 九型${c.enneagram.core}号 ${c.mbti || ''}`).join('\n') }
    },
  })

  t({
    name: 'character_delete',
    description: '删除角色模型。',
    parameters: { characterId: { type: 'string', required: true } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true } } }, render: (_a: any, v: any) => tx((v as any).ok ? '已删除' : '未找到') },
    async execute(args: any) {
      return { ok: store.deleteCharacter(args.characterId) }
    },
  })

  // ── 27 亚型速查（本能副型 × 9 型号） ──
  t({
    name: 'character_subtypes',
    description: '查询九型人格 27 种本能副型（亚型）：9 型号 × 3 本能（sp 自保 / sx 一对一 / so 社交），含亚型名、关键词、特质与反型标注。可选 core 只看某型号的 3 个亚型。用于给角色挑副型、或解释"同一型号内部差异"。',
    parameters: {
      core: { type: 'number', description: '可选：主型 1-9，只看该型号的 3 个亚型' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { list: { type: 'string', required: true } } },
      render: (_a: any, v: any) => tx((v as any).list),
    },
    async execute(args: any) {
      const cores = args?.core && Number(args.core) >= 1 && Number(args.core) <= 9
        ? [Number(args.core)]
        : [1, 2, 3, 4, 5, 6, 7, 8, 9]
      const lines: string[] = []
      lines.push('九型 27 亚型（本能副型）＝ 9 型号 × 3 本能；★=反型（表现与同型号相反，易被误判）')
      lines.push('本能：sp 自保（安全/资源/舒适）｜sx 一对一（亲密/强度/联结）｜so 社交（归属/地位/群体）')
      for (const core of cores) {
        const prof = ENNEAGRAM_PROFILES[core]
        lines.push(`\n【${core}号 ${prof.zh}】`)
        for (const st of ['sp', 'sx', 'so'] as const) {
          const p = subtypeProfile(core, st)
          lines.push(`  ${st.toUpperCase()} ${p.name}${p.isCounter ? ' ★反型' : ''} —— ${p.keyword}`)
          for (const tr of p.traits) lines.push(`      · ${tr}`)
        }
      }
      return { list: lines.join('\n') }
    },
  })

  // ── §8.18 四大三元组速查（智慧中心 / Hornevian / Harmonic / Harmony 客体关系） ──
  t({
    name: 'character_triads',
    description: '查询九型人格四大三元组（Triads）：智慧中心（心/脑/腹·核心情绪）、Hornevian 社交姿态（顺从/进攻/退缩）、Harmonic 冲突应对（正面展望/能力/反应）、Harmony 和谐三元组=客体关系（理想主义者·挫折/关系主义者·拒绝/实用主义者·依附）。可选 core 只看某型号在四组中的归属。用途：定三元组比定单型号更快——中心→姿态→应对，三组交集锁定唯一型号。',
    parameters: {
      core: { type: 'number', description: '可选：主型 1-9，只看该型号在四大三元组中的归属' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { list: { type: 'string', required: true } } },
      render: (_a: any, v: any) => tx((v as any).list),
    },
    async execute(args: any) {
      const lines: string[] = []
      const coreArg = Number(args?.core)
      if (Number.isFinite(coreArg) && coreArg >= 1 && coreArg <= 9) {
        const prof = ENNEAGRAM_PROFILES[coreArg]
        lines.push(`【${coreArg}号 ${prof.zh}】在四大三元组中的归属：`)
        for (const { system, group } of triadMembership(coreArg)) {
          lines.push(`\n◆ ${system.zh}（${system.en}）——${system.question}`)
          lines.push(`  → ${group.zh}（${group.en}）：${group.desc}`)
        }
        lines.push('\n※ 反推用法：中心 × Hornevian 姿态 × Harmonic 应对，三组交集 = 唯一型号。')
      } else {
        lines.push('九型四大三元组（Triads）——四套独立三分法，各回答一个不同问题：')
        for (const sys of TRIAD_SYSTEMS) {
          lines.push(`\n◆ ${sys.zh}（${sys.en}）｜理论来源：${sys.source}`)
          lines.push(`  ${sys.question}`)
          for (const g of sys.groups) {
            lines.push(`  · ${g.zh}（${g.en}）＝ ${g.types.join('/')} 号`)
            lines.push(`    ${g.desc}`)
          }
        }
        lines.push('\n※ Tritype（Katherine Fauvre）：心/脑/腹三中心各取一型组成 27 种原型（如 478），由 enneagram-multifactor 问卷直接测出。')
        lines.push('※ 反推用法：中心 × Hornevian 姿态 × Harmonic 应对，三组交集 = 唯一型号。')
      }
      return { list: lines.join('\n') }
    },
  })

  // ── §8.22 人格变化 / 动态速查（整合↔压力箭头、健康层级、翼型摆动） ──
  t({
    name: 'character_dynamics',
    description: '查询九型人格"人格变化/动态"：整合方向（健康时借哪一号的健康特质）、压力/解离方向（失衡时滑向哪一号、以及把那号当工具能拿到什么资源）、健康层级怎么随经历降档/升档、翼型如何摆动（主导翼↔潜在翼互换或趋双翼均衡）。可选传角色 characterId 看个人化（按该角色 core+wing+level），或只传 core 看型号层面。用于写角色的成长弧/黑化弧真实的变化轨迹。',
    parameters: {
      characterId: { type: 'string', description: '可选：本插件已有角色 id（按其 core+wing+level 输出个人化动态）' },
      core: { type: 'number', description: '可选：主型 1-9（不传角色时用）' },
      wing: { type: 'string', description: '可选：翼，如 5w4' },
      level: { type: 'number', description: '可选：健康层级 1-9（默认 4）' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { list: { type: 'string', required: true } } },
      render: (_a: any, v: any) => tx((v as any).list),
    },
    async execute(args: any) {
      let core = Number(args?.core)
      let wing: string | undefined
      let level = Number(args?.level) || 4
      let name = ''
      if (args.characterId) {
        const ch = store.getCharacter(args.characterId)
        if (ch) { core = ch.enneagram.core; wing = ch.enneagram.wing; level = ch.enneagram.level || 4; name = ch.name + '：' }
      }
      if (!Number.isFinite(core) || core < 1 || core > 9) core = core ? Math.min(9, Math.max(1, Math.round(core))) : 5
      const d = characterDynamics(core, wing, level)
      const lines = [
        `【${name}${core}号 ${ENNEAGRAM_PROFILES[core].zh}${wing ? `·${wing}（${WING_NICK[wing] ?? ''}）` : ''}】人格变化/动态：`,
        ``,
        `◆ 整合方向 → ${d.integration.to}号【${d.integration.toName}】(健康端借来)`,
        `   ${d.integration.look}`,
        `   待久风险：${d.integration.risk}`,
        `◆ 压力/解离方向 → ${d.stress.to}号【${d.stress.toName}】(失衡端出走)`,
        `   ${d.stress.look}`,
        `   当工具能用到：${d.stress.resource}`,
        `◆ 健康层级：${d.level.level}级（${d.level.band}档）——健康端借整合特质、失衡端更"本型且更糟"再到借压力号`,
        `◆ 翼型摆动：${d.wingSwing}`,
        ``,
        `※ 写弧光：让角色沿"健康↔压力"这条轨迹真实地移动，别一步到位——黑化是渐次滑向 ${d.stress.to}号的过程，成长是反复退回再朝 ${d.integration.to}号迈进。`,
      ]
      return { list: lines.join('\n') }
    },
  })

  // ── LLM 深度特质稿 ──
  t({
    name: 'character_trait_writer',
    description: '[LLM 深度版] 结合角色已填写的具体资料与九型+三元组+MBTI+大五人格档案，生成一份贴合该角色独有经历的六节深度画像（人格详析/思维/行动/情景样例/个性化口头禅/逐维度解读，含三元组四套归属）。传 characterId，或 novelProjectId+novelCharacterId 联动。返回 markdown 稿。',
    parameters: {
      characterId: { type: 'string', description: '本插件已有角色 id' },
      novelProjectId: { type: 'string', description: '联动：novel-writer 项目 id' },
      novelCharacterId: { type: 'string', description: '联动：novel-writer 人物 id' },
      depth: { type: 'string', enum: ['standard', 'deep'], description: '深度：standard 约 900-1300 字；deep 约 1400-1900 字' },
      focus: { type: 'string', description: '可选：希望重点深挖的方向' },
      persist: { type: 'boolean', default: true, description: 'true=存回角色 library.narrative 或写回 novel personalityProfile' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { narrative: { type: 'string', required: true }, saved: { type: 'boolean', required: true } } },
      render: (_a: any, v: any) => tx((v as any).narrative),
    },
    async execute(args: any) {
      let ch: CharacterModel | null = null
      let source: { kind: 'novel'; projectId: string; characterId: string } | null = null
      if (args.characterId) ch = store.getCharacter(args.characterId)
      else if (args.novelProjectId && args.novelCharacterId) {
        const nc = novelLink.getCharacter(args.novelProjectId, args.novelCharacterId)
        source = { kind: 'novel', projectId: args.novelProjectId, characterId: args.novelCharacterId }
        if (nc) {
          const existing = store.findBySource(args.novelProjectId, args.novelCharacterId)
          const guess = guessEnneagramFromText([nc.personality, nc.background, nc.goal, (nc.currentState?.notes ?? '')].join(' '))
          const core = guess[0] || 1
          const existingMbti = existing?.mbti ?? ''
          ch = existing ?? buildCharacterModel({
            name: nc.name, role: (nc.role as any) ?? 'supporting', appearance: nc.appearance,
            background: nc.background, goal: nc.goal, stateNotes: nc.currentState?.notes,
            enneagram: { core, level: 4 }, mbti: existingMbti,
          })
          ch.source = source
        }
      }
      if (!ch) throw new Error('需要 characterId 或 novelProjectId+novelCharacterId，且未能取到角色资料')

      const e = ch.enneagram
      const facts: string[] = []
      if (ch.appearance) facts.push(`外貌：${ch.appearance}`)
      if (ch.background) facts.push(`背景经历：${ch.background}`)
      if (ch.goal) facts.push(`目标/动机：${ch.goal}`)
      if (ch.stateNotes) facts.push(`当前状态备注：${ch.stateNotes}`)
      const personaFacts = [
        `九型 ${e.core}号【${e.coreName}】核心恐惧「${e.fear[0]}」、核心欲望「${e.desire[0]}」`,
        e.wing ? `侧翼 ${e.wing}（${e.wingNick}）` : '',
        `压力方向 ${e.core}→${e.stressArrow}号；整合方向 ${e.core}→${e.growthArrow}号`,
        e.subtypeLabel ? `副型 ${e.subtype.toUpperCase()}·${e.subtypeLabel}${e.subtypeTraits?.length ? ` —— ${e.subtypeTraits.join('；')}` : ''}` : '',
        `健康层级 ${e.level}级(${e.levelBand}档)`,
        e.catchphrase?.length ? `口头禅（参考）：${e.catchphrase.map(x => x.replace(/「|」/g, '')).join(' ｜ ')}` : '',
        e.triggers?.length ? `情绪雷区：${e.triggers.join('；')}` : '',
        e.traits?.length ? `性格特质：${e.traits.join('；')}` : '',
        // §8.19：三元组四套归属（详析素材）
        triadFactsLine(e.core),
        // §8.20：三要素（动机/缺陷/细节）
        ch.essentials ? essentialsBrief(ch.essentials) : '',
        ch.mbti ? `MBTI：${ch.mbti}` : '',
        (ch.bigfive && Object.keys(ch.bigfive).length) ? `大五：${(['Openness', 'Conscientiousness', 'Extraversion', 'Agreeableness', 'Neuroticism'] as const).map(k => `${BMAP[k]}=${ch.bigfive?.[k]}`).join(' ')}` : '',
      ].filter(Boolean)

      const sys = DEEP_SYS + `\n全文${args.depth === 'deep' ? '约 1400-1900 字' : '约 900-1300 字'}。`
      const focus = args.focus ? `\n【重点深挖】${args.focus}` : ''
      const triadHooks = triadWritingHooks(e.core).map(h => `- ${h}`).join('\n')
      const prompt = `角色：${ch.name}\n【已知资料】\n${facts.join('\n') || '（暂无具体背景填写）'}\n\n【人格档案】\n${personaFacts.join('\n')}\n\n【三元组写作落点】\n${triadHooks}\n${focus}\n请严格按 system 指令的六节结构输出。`

      let narrative: string
      try {
        narrative = await callLlm(ctx.llm, sys, prompt, { maxTokens: args.depth === 'deep' ? 5600 : 4200, temperature: 0.8, route: lastRoute })
      } catch (err) {
        throw new Error('[LLM 生成失败] ' + String(err))
      }

      let saved = false
      if (args.persist !== false) {
        if (source) {
          const res = novelLink.writePersonalityProfile(source.projectId, source.characterId, narrative)
          saved = res.ok
        } else {
          ch.library = ch.library ?? {}
          ch.library.narrative = narrative
          store.upsertCharacter(ch)
          saved = true
        }
      }
      return { narrative, saved }
    },
  })

  // ── 角色互动（关系网）工具 ──
  t({
    name: 'character_relation_add',
    description: '登记角色之间的互动关系（关系网的一条边）。a/b 可为角色 id 或名字；可传 projectId 归入某个 novel-writer 项目作用域。type 关系类型、stance 情感立场、direction 方向、weight 强度(0-10)、summary 一句话概括、tags 关键词。可选 analysis 直接写互动深析；已有同对关系时覆盖更新。',
    parameters: {
      a: { type: 'string', description: '角色 A（id 或名字）', required: true },
      b: { type: 'string', description: '角色 B（id 或名字）', required: true },
      projectId: { type: 'string', description: 'optional：归入某 novel 项目作用域（不传视为本地/共享）' },
      type: { type: 'string', description: '关系类型（敌手/恋人/师徒/血亲/盟友…）' },
      stance: { type: 'string', description: '情感立场（敌对/亲近/利用/暧昧/复杂…）' },
      direction: { type: 'string', enum: ['a->b', 'b->a', 'a<->b'], description: '谁主导：a->b=对 b 为主要 / b->a=对 a 为主要 / a<->b=对等' },
      weight: { type: 'number', description: '联结强度 0-10（默认5）' },
      summary: { type: 'string', description: '一句话关系概括' },
      tags: { type: 'array', items: { type: 'string' }, description: '关键词 2-5 个' },
      analysis: { type: 'string', description: '互动深析（markdown，可选；留空则保留已有）' },
    },
    output: { schema: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', required: true }, summary: { type: 'string', required: true } } }, render: (_a: any, v: any) => tx((v as any).summary) },
    async execute(args: any) {
      const pa = resolveParticipant(args.a, args.projectId)
      const pb = resolveParticipant(args.b, args.projectId)
      if (pa.key === pb.key) return { id: '', summary: '❌ 两个端点解析到了同一个角色，无法建立互动。' }
      const existing = store.findInteraction(pa.key, pb.key, args.projectId)
      const now = new Date().toISOString()
      const it: Interaction = existing ?? { id: '', aKey: pa.key, aName: pa.name, bKey: pb.key, bName: pb.name, projectId: args.projectId, type: '互动', stance: '复杂', direction: 'a<->b', weight: 5, summary: '', createdAt: now, updatedAt: now } as any
      it.aName = pa.name; it.bName = pb.name
      it.projectId = args.projectId ?? it.projectId
      if (args.type) it.type = String(args.type)
      if (args.stance) it.stance = String(args.stance)
      if (args.direction && ['a->b', 'b->a', 'a<->b'].includes(args.direction)) it.direction = args.direction as InteractionDirection
      if (typeof args.weight === 'number' && Number.isFinite(args.weight)) it.weight = Math.max(0, Math.min(10, Math.round(args.weight)))
      if (args.summary) it.summary = String(args.summary)
      if (Array.isArray(args.tags)) it.tags = args.tags.map((x: any) => String(x)).filter(Boolean)
      if (args.analysis) it.analysis = String(args.analysis)
      const saved = store.upsertInteraction(it)
      return { id: saved.id, summary: `已登记互动：${saved.aName} ─${saved.type}(${saved.stance})→ ${saved.bName}（强度 ${saved.weight}）${saved.summary ? '\n' + saved.summary : ''}` }
    },
  })

  t({
    name: 'character_relation_list',
    description: '列出已登记的角色互动（关系网边）。可传 projectId 只看某项目作用域。',
    parameters: { projectId: { type: 'string', description: 'optional：只看某项目' } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { list: { type: 'string', required: true } } }, render: (_a: any, v: any) => tx((v as any).list) },
    async execute(args: any) {
      const list = store.listInteractions(args.projectId)
      if (list.length === 0) return { list: '（暂无互动，可用 character_relation_add 登记，或 character_interaction_analyze 让 AI 分析）' }
      return { list: list.map(it =>
        `- ${it.aName} ─${it.type}(${it.stance},${(it.direction || 'a<->b').replace('a<->b', '对等')}.w${it.weight}${it.projectId ? ` [${it.projectId}]` : ''})→ ${it.bName}${it.summary ? `：${it.summary}` : ''}${it.analysis ? '（有深析）' : ''} [${it.id}]`)
        .join('\n') }
    },
  })

  t({
    name: 'character_relation_delete',
    description: '删除一条角色互动（按 id，见 character_relation_list）。',
    parameters: { id: { type: 'string', description: '互动 id', required: true } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true } } }, render: (_a: any, v: any) => tx((v as any).ok ? '已删除互动' : '未找到该互动') },
    async execute(args: any) { return { ok: store.deleteInteraction(args.id) } },
  })

  t({
    name: 'character_interaction_analyze',
    description: '让 AI 深度分析两个角色之间的互动关系并登记为关系网边：产出关系类型/情感立场/方向/强度/一句话概括/关键词/互动深析(markdown)。传 a+b（id/名字）+ 可选 projectId；或传 id（已有互动）对它重新分析。persist=false 只返回不落库。',
    parameters: {
      a: { type: 'string', description: '角色 A（id 或名字；与 id 二选一）' },
      b: { type: 'string', description: '角色 B（id 或名字）' },
      projectId: { type: 'string', description: 'optional：项目作用域' },
      id: { type: 'string', description: 'optional：对已有互动重新分析（用它的端点）' },
      persist: { type: 'boolean', description: 'true=登记/更新到关系网并落库（默认 true）' },
    },
    output: { schema: { type: 'object', additionalProperties: false, properties: { type: { type: 'string', required: true }, text: { type: 'string', required: true } } }, render: (_a: any, v: any) => tx((v as any).text) },
    async execute(args: any) {
      let aRef = args.a, bRef = args.b, projectId: string | undefined = args.projectId
      if (args.id) {
        const ex = store.getInteraction(args.id)
        if (ex) {
          aRef = refFromKey(ex.aKey); bRef = refFromKey(ex.bKey)
          projectId = args.projectId ?? ex.projectId
        }
      }
      if (!aRef || !bRef) throw new Error('需要 a+b 或 id 指定要分析的互动')
      const pa = resolveParticipant(aRef, projectId)
      const pb = resolveParticipant(bRef, projectId)
      const res = await analyzeInteraction(aRef, bRef, projectId)
      // §8.9：模型没给出可用结果时**不落库**，明确报错而不是写一条「互动/复杂/5」垃圾边
      if (!res.valid) {
        return {
          type: 'invalid',
          text: `❌ 互动分析未产出可用结果，已跳过落库（避免写入无意义的关系边）。\n${res.reason ?? ''}\n\n建议：稍后重试，或先用 character_relation_add 手工登记这条关系。`,
        }
      }
      let savedNote = ''
      if (args.persist !== false) {
        const existing = store.findInteraction(res.aKey, res.bKey, projectId)
        const now = new Date().toISOString()
        const it: Interaction = existing ?? { id: '', projectId, aKey: res.aKey, aName: pa.name, bKey: res.bKey, bName: pb.name, type: '', stance: '', direction: 'a<->b', weight: 5, summary: '', createdAt: now, updatedAt: now } as any
        it.aName = pa.name; it.bName = pb.name
        it.type = res.type; it.stance = res.stance; it.direction = res.direction; it.weight = res.weight
        it.summary = res.summary; it.tags = res.tags; it.analysis = res.analysis
        const saved = store.upsertInteraction(it)
        savedNote = `（已登记互动 [${saved.id}]）`
      }
      const tagsS = res.tags.length ? `\n关键词：${res.tags.map(x => '#' + x).join(' ')}` : ''
      return {
        type: res.type,
        text: `【互动分析】${pa.name} ─${res.type}(${res.stance} · ${res.direction === 'a<->b' ? '对等' : res.direction === 'a->b' ? 'A 主导' : 'B 主导'} · 强度${res.weight})→ ${pb.name}${savedNote}\n${res.summary}${tagsS}\n\n${res.analysis}`,
      }
    },
  })

  // ── 联动列表 ──
  t({
    name: 'novel_characters_link',
    description: '列出 novel-writer 项目与各项目下的角色及其人格档案状态（角色库 ↔ 小说项目联动清单）',
    parameters: { projectId: { type: 'string', description: '可选：只看某项目' }, characterOnlyName: { type: 'string', description: '可选：按名字过滤' } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { list: { type: 'string', required: true } } }, render: (_a: any, v: any) => tx((v as any).list) },
    async execute(args: any) {
      const projects = novelLink.listProjects()
      const lines: string[] = []
      for (const p of projects) {
        if (args.projectId && p.id !== args.projectId) continue
        const chars = novelLink.listCharacters(p.id)
        lines.push(`【${p.name}】(${p.id}) ${p.genre} 人物${p.characterCount}`)
        for (const c of chars) {
          if (args.characterOnlyName && !c.name.includes(args.characterOnlyName)) continue
          lines.push(`  - ${c.name} (${c.id}) ${c.personalityProfile ? '✓有人格档案' : '(待完善)'}`)
        }
      }
      return { list: lines.length ? lines.join('\n') : '（无项目或无匹配人物）' }
    },
  })

  /**
   * 生成六节角色详析（Pro9 提炼）：输入角色模型 → LLM 产出深度画像 → 落库/写回 novel。
   * 供 character_trait_writer 工具与 HTTP /analyze 端点共用（UI 面板「生成详析」）。
   */
  /**
   * 各量表维度 id → 中文名（AI 自动作答全部量表的写入目标）。
   * 与 renderCharacterModel 的 scales[kind] 渲染、SCALE_INSIGHT 判读对齐。
   */
  const SCALE_DEFS: Record<string, { name: string; dims: Record<string, string> }> = {
    'hexaco-24': { name: 'HEXACO 六维', dims: { honesty_humility: '诚实-谦逊', emotionality: '情绪性', extraversion: '外向性', agreeableness: '宜人性', conscientiousness: '尽责性', openness: '开放性' } },
    'sd3': { name: '黑暗三合一(SD3)', dims: { machiavellianism: '马基雅维利主义', narcissism: '自恋', psychopathy: '精神病态' } },
    'ecr-12': { name: '成人依恋(ECR-S)', dims: { attachment_anxiety: '依恋焦虑', attachment_avoidance: '依恋回避' } },
    'locus-24': { name: '控制点(IPC)', dims: { loc_internal: '内控点', loc_powerful_others: '他人控制', loc_chance: '机遇' } },
    'mfq-30': { name: '道德基础(MFQ-30)', dims: { care: '关怀', fairness: '公平', loyalty: '忠诚', authority: '权威', sanctity: '圣洁' } },
    'pvq-21': { name: '价值观(PVQ-21)', dims: { self_direction: '自我导向', stimulation: '刺激', hedonism: '享乐', achievement: '成就', power: '权力', security: '安全', conformity: '遵从', tradition: '传统', benevolence: '仁爱', universalism: '普世' } },
    'disc-32': { name: 'DISC 行为风格', dims: { disc_d: '支配力(D)', disc_i: '影响力(I)', disc_s: '稳健性(S)', disc_c: '尽责性(C)' } },
    'eq-22': { name: '同理心(EQ)', dims: { empathy_quotient: '同理心' } },
  }

  /**
   * AI 自动作答「其余量表」（大五之外的 HEXACO / SD3 / 依恋 / 控制点 / 道德 / 价值观 / DISC / 同理心）。
   * 以该角色本人视角给每维度 0-100 分，写入 ch.scales[kind]（renderCharacterModel 会渲染），
   * 已有实测分数(quiz)不覆盖。返回写入了哪些量表。失败不抛异常。
   */
  async function inferAllScales(ch: CharacterModel): Promise<{ wrote: string[] }> {
    const e = ch.enneagram
    const facts = [
      ch.appearance ? `外貌：${ch.appearance}` : '',
      ch.background ? `背景经历：${ch.background}` : '',
      ch.goal ? `目标/动机：${ch.goal}` : '',
      ch.stateNotes ? `当前状态：${ch.stateNotes}` : '',
      `九型：${e.core}号【${e.coreName}】${e.wing ? ` ${e.wing}` : ''}｜副型 ${e.subtype.toUpperCase()}（${e.subtypeLabel}）｜${e.levelBand}档`,
      ch.mbti ? `MBTI：${ch.mbti}` : '',
      (ch.bigfive && Object.keys(ch.bigfive).length) ? `大五：${(['Openness', 'Conscientiousness', 'Extraversion', 'Agreeableness', 'Neuroticism'] as const).map(k => `${BMAP[k]}=${ch.bigfive?.[k]}`).join(' ')}` : '',
    ].filter(Boolean)
    const lines = Object.entries(SCALE_DEFS).map(([kind, def]) =>
      `"${kind}"{ ${Object.entries(def.dims).map(([id, zh]) => `"${id}":${zh}`).join(', ')} }`)
    const sys = `你是人格测评师。请"以这个角色本人的身份"完成以下各量表测评（不是评价他，而是像他那样作答），每个维度给 0-100 整数分，须体现该角色的性格差异（不要都取中间值，高分低分要拉开）。
各量表及维度（维度id对应中文名）：
${Object.entries(SCALE_DEFS).map(([kind, def]) => `${kind}: ${Object.entries(def.dims).map(([id, zh]) => `"${id}"(${zh})`).join(', ')}`).join('\n')}
严格只输出一行 JSON（不要任何多余文字、不要 markdown 代码块），结构为：
{"hexaco-24":{"honesty_humility":65,"emotionality":…}, "sd3":{…}, "ecr-12":{…}, "locus-24":{…}, "mfq-30":{…}, "pvq-21":{…}, "disc-32":{…}, "eq-22":{…}}`
    const prompt = `角色：${ch.name}\n${facts.join('\n')}\n请以他本人的身份完成以上全部量表测评并输出 JSON。`
    try {
      const raw = await callLlm(ctx.llm, sys, prompt, { maxTokens: 2500, temperature: 0.4, route: lastRoute })
      const m = raw.match(/\{[\s\S]*\}/)
      if (!m) return { wrote: [] }
      const a = JSON.parse(m[0])
      const scales: any = ch.scales && typeof ch.scales === 'object' ? { ...(ch.scales as any) } : {}
      const wrote: string[] = []
      for (const kind of Object.keys(SCALE_DEFS)) {
        // 已有问卷实测则跳过
        if (scales[kind] && scales[kind].source === 'quiz') continue
        const obj = a[kind]
        if (!obj || typeof obj !== 'object') continue
        const scores: Record<string, number> = {}
        const labels: Record<string, string> = {}
        let ok = false
        for (const dimId of Object.keys(SCALE_DEFS[kind].dims)) {
          const v = Number((obj as any)[dimId])
          if (Number.isFinite(v)) { scores[dimId] = Math.max(0, Math.min(100, Math.round(v))); labels[dimId] = SCALE_DEFS[kind].dims[dimId]; ok = true }
        }
        if (ok) { scales[kind] = { name: SCALE_DEFS[kind].name, scores, labels, scaleMin: 0, scaleMax: 100, source: 'inferred' }; wrote.push(kind) }
      }
      ch.scales = scales as any
      return { wrote }
    } catch { return { wrote: [] } }
  }

  /**
   * AI 模拟作答 MBTI-93 与 BFI-2-60（角色详析附带两项测试）。
   * 以「该角色本人作答」的视角推断四字母类型与五维分数，输出严格 JSON。
   */
  async function inferTests(ch: CharacterModel): Promise<{ mbti?: string; bigfive?: Record<string, number>; note?: string }> {
    const e = ch.enneagram
    const facts = [
      ch.appearance ? `外貌：${ch.appearance}` : '',
      ch.background ? `背景经历：${ch.background}` : '',
      ch.goal ? `目标/动机：${ch.goal}` : '',
      ch.stateNotes ? `当前状态：${ch.stateNotes}` : '',
      `九型：${e.core}号【${e.coreName}】${e.wing ? ` ${e.wing}` : ''}｜副型 ${e.subtype.toUpperCase()}（${e.subtypeLabel}）｜${e.levelBand}档`,
      e.traits?.length ? `特质：${e.traits.join('；')}` : '',
    ].filter(Boolean)
    const sys = `你是人格测评师。请"以这个角色本人的身份"完成两项人格测评（不是评价他，而是像他那样作答）：
1) MBTI：判定四维倾向（E/I、S/N、T/F、J/P），给出四字母类型。
2) 大五 BFI-2：给出五维分数（0-100，整数），须体现差异，不要都取中间值。
严格只输出一行 JSON（不要任何多余文字、不要 markdown 代码块）：
{"mbti":"ENFJ","mbtiNote":"一句话依据","bigfive":{"Openness":65,"Conscientiousness":70,"Extraversion":80,"Agreeableness":90,"Neuroticism":50},"bigfiveNote":"一句话依据"}`
    const prompt = `角色：${ch.name}\n${facts.join('\n')}\n请以他本人的身份完成 MBTI 与 BFI-2 两项测评并输出 JSON。`
    const raw = await callLlm(ctx.llm, sys, prompt, { maxTokens: 700, temperature: 0.4, route: lastRoute })
    const m = raw.match(/\{[\s\S]*\}/)
    if (!m) return {}
    try {
      const j = JSON.parse(m[0])
      const mbti = typeof j.mbti === 'string' && /^[EI][SN][TF][JP]$/i.test(j.mbti.trim()) ? j.mbti.trim().toUpperCase() : undefined
      const b5raw = j.bigfive && typeof j.bigfive === 'object' ? j.bigfive : null
      const bigfive: Record<string, number> = {}
      if (b5raw) {
        for (const k of ['Openness', 'Conscientiousness', 'Extraversion', 'Agreeableness', 'Neuroticism'] as const) {
          const v = Number(b5raw[k])
          if (Number.isFinite(v)) bigfive[k] = Math.max(0, Math.min(100, Math.round(v)))
        }
      }
      const note = [j.mbtiNote, j.bigfiveNote].filter((x: any) => typeof x === 'string' && x.trim()).join('；')
      return { mbti, bigfive: Object.keys(bigfive).length ? bigfive : undefined, note: note || undefined }
    } catch { return {} }
  }

  async function analyzeCharacter(
    ch: CharacterModel,
    source: { kind: 'novel'; projectId: string; characterId: string } | null,
    opts: { depth?: 'standard' | 'deep'; focus?: string; persist?: boolean },
  ): Promise<{ narrative: string; saved: boolean; card: string }> {
    const e = ch.enneagram
    // 角色详析附带两项测试：MBTI / 大五缺失时由 AI 以角色身份模拟作答（已有问卷实测则不覆盖）
    const hasB5 = Boolean(ch.bigfive && Object.keys(ch.bigfive).length)
    if (!ch.mbti || !hasB5) {
      try {
        const t = await inferTests(ch)
        if (!ch.mbti && t.mbti) { ch.mbti = t.mbti; ch.mbtiSource = 'inferred' }
        if (!hasB5 && t.bigfive) { ch.bigfive = t.bigfive as any; ch.bigfiveSource = 'inferred' }
        if (t.note) ch.testsNote = t.note
      } catch { /* 推断失败不阻断详析 */ }
    }
    // 其余量表（HEXACO/SD3/依恋/控制点/道德/价值观/DISC/同理心）缺失时由 AI 自动作答写入 ch.scales
    try {
      const r = await inferAllScales(ch)
      if (r.wrote.length) { /* 已写入 ch.scales，renderCharacterModel 会渲染 */ }
    } catch { /* 失败不阻断详析 */ }

    const facts: string[] = []
    if (ch.appearance) facts.push(`外貌：${ch.appearance}`)
    if (ch.background) facts.push(`背景经历：${ch.background}`)
    if (ch.goal) facts.push(`目标/动机：${ch.goal}`)
    if (ch.stateNotes) facts.push(`当前状态备注：${ch.stateNotes}`)
    const personaFacts = [
      `九型 ${e.core}号【${e.coreName}】核心恐惧「${e.fear[0]}」、核心欲望「${e.desire[0]}」`,
      e.wing ? `侧翼 ${e.wing}（${e.wingNick}）` : '',
      `压力方向 ${e.core}→${e.stressArrow}号；整合方向 ${e.core}→${e.growthArrow}号`,
      e.subtypeLabel ? `副型 ${e.subtype.toUpperCase()}·${e.subtypeLabel}${e.subtypeTraits?.length ? ` —— ${e.subtypeTraits.join('；')}` : ''}` : '',
      `健康层级 ${e.level}级(${e.levelBand}档)`,
      e.catchphrase?.length ? `口头禅（参考）：${e.catchphrase.map(x => x.replace(/「|」/g, '')).join(' ｜ ')}` : '',
      e.triggers?.length ? `情绪雷区：${e.triggers.join('；')}` : '',
      e.traits?.length ? `性格特质：${e.traits.join('；')}` : '',
      // §8.19：三元组四套归属（详析素材）
      triadFactsLine(e.core),
      // §8.20：三要素（动机/缺陷/细节）
      ch.essentials ? essentialsBrief(ch.essentials) : '',
      ch.mbti ? `MBTI：${ch.mbti}` : '',
      (ch.bigfive && Object.keys(ch.bigfive).length) ? `大五：${(['Openness', 'Conscientiousness', 'Extraversion', 'Agreeableness', 'Neuroticism'] as const).map(k => `${BMAP[k]}=${ch.bigfive?.[k]}`).join(' ')}` : '',
    ].filter(Boolean)

    const sys = DEEP_SYS + `\n全文${opts.depth === 'deep' ? '约 1400-1900 字' : '约 900-1300 字'}。`
    const focus = opts.focus ? `\n【重点深挖】${opts.focus}` : ''
    const triadHooks = triadWritingHooks(e.core).map(h => `- ${h}`).join('\n')
    const prompt = `角色：${ch.name}\n【已知资料】\n${facts.join('\n') || '（暂无具体背景填写）'}\n\n【人格档案】\n${personaFacts.join('\n')}\n\n【三元组写作落点】\n${triadHooks}\n${focus}\n请严格按 system 指令的六节结构输出。`

    const narrative = await callLlm(ctx.llm, sys, prompt, { maxTokens: opts.depth === 'deep' ? 5600 : 4200, temperature: 0.8, route: lastRoute })

    // 先组装完整角色卡（含 MBTI/大五解析 + 六节画像），再落库/写回——
    // 写回 novel-writer 的是整张卡（用户要求角色详析保留角色卡），而非仅六节文本。
    ch.library = ch.library ?? {}
    ch.library.narrative = narrative
    // §8.17：顺带补全「声音五件套」（presence/口头禅/雷区/压力/成长），缺省才补，失败不阻断
    await fillVoice(ch, false)
    const card = renderCharacterModel(ch, bank)

    let saved = false
    if (opts.persist !== false) {
      if (source) {
        const res = novelLink.writePersonalityProfile(source.projectId, source.characterId, card)
        saved = res.ok
        // 模型也入本地库（novel-status 徽章/后续复用需要九型/MBTI 元数据）
        try {
          if (!ch.id) ch.id = 'c-' + Math.random().toString(36).slice(2, 10)
          ch.source = source
          store.upsertCharacter(ch)
        } catch { /* 本地入库失败不阻断 */ }
      } else {
        store.upsertCharacter(ch)
        saved = true
      }
    }
    return { narrative, saved, card }
  }

  /**
   * §8.17：为角色补全「声音五件套」（presence/catchphrase/triggers/stressResponse/growthResponse）。
   * 这些字段此前是全代码库都不写的死字段，现在有了正式写入路径。
   * @returns 写入的字段名列表（失败返回空数组，不抛异常）
   */
  async function fillVoice(ch: CharacterModel, force = false): Promise<string[]> {
    const e = ch.enneagram
    const hasAny = Boolean(e.presence || e.catchphrase?.length || e.triggers?.length || e.stressResponse?.length || e.growthResponse?.length)
    if (hasAny && !force) return []
    const facts = [
      ch.appearance ? `外貌：${ch.appearance}` : '',
      ch.background ? `背景经历：${ch.background}` : '',
      ch.goal ? `目标/动机：${ch.goal}` : '',
      ch.stateNotes ? `当前状态：${ch.stateNotes}` : '',
      `九型 ${e.core}号【${e.coreName}】${e.wing ? ` ${e.wing}（${e.wingNick}）` : ''}｜副型 ${e.subtype.toUpperCase()}·${e.subtypeLabel}｜健康层级 ${e.level}级(${e.levelBand}${e.levelName ? '·' + e.levelName : ''})`,
      e.subtypeTraits?.length ? `亚型特质：${e.subtypeTraits.join('；')}` : '',
      // §8.19：三元组（声音五件套：气质贴合社交姿态、压力反应贴合冲突应对组）
      triadFactsLine(e.core),
      ch.mbti ? `MBTI：${ch.mbti}` : '',
    ].filter(Boolean)
    const prompt = `角色：${ch.name}\n${facts.join('\n')}\n请产出他的「声音五件套」并输出 JSON。`
    let raw = ''
    try {
      raw = await callLlm(ctx.llm, VOICE_SYS, prompt, { maxTokens: 1400, temperature: 0.85, route: lastRoute })
    } catch {
      return []
    }
    const j = extractJsonObject<any>(raw)
    if (!j || typeof j !== 'object') return []
    const wrote: string[] = []
    const arr = (v: any, cap = 8): string[] =>
      Array.isArray(v) ? v.filter(x => typeof x === 'string' && x.trim()).map((x: string) => x.trim().slice(0, 200)).slice(0, cap) : []
    if (typeof j.presence === 'string' && j.presence.trim()) {
      e.presence = j.presence.trim().slice(0, 400); wrote.push('presence')
    }
    const cp = arr(j.catchphrase); if (cp.length) { e.catchphrase = cp; wrote.push('catchphrase') }
    const tr = arr(j.triggers); if (tr.length) { e.triggers = tr; wrote.push('triggers') }
    const sr = arr(j.stressResponse); if (sr.length) { e.stressResponse = sr; wrote.push('stressResponse') }
    const gr = arr(j.growthResponse); if (gr.length) { e.growthResponse = gr; wrote.push('growthResponse') }
    return wrote
  }

  // ── HTTP API（UI 面板数据源） ──
  disposers.push(ctx.webServer.register({
    kind: 'prefix',
    path: '/@dsh-external/dsh-character-maker/api',
    handler: async (req: any, res: any) => {
      const url = new URL(req.url ?? '/', 'http://local')
      const route = url.pathname.replace('/@dsh-external/dsh-character-maker/api', '').replace(/^\//, '')
        .split('?')[0] || 'status'
      const send = (body: any, code = 200) => {
        res.statusCode = code
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify(body))
      }
      const readBody = async (): Promise<any> => {
        let raw = ''
        for await (const chunk of req) raw += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
        try { return raw ? JSON.parse(raw) : {} } catch { return {} }
      }
      try {
        const q = Object.fromEntries(url.searchParams)
        if (route === 'status') {
          send({
            ok: true,
            dataDir,
            schemaVersion: SCHEMA_VERSION,
            migrationNotes: store.getMigrationNotes(),
            novelLinked: novelLink.listProjects().length,
            novelDataDir: novelLink.root,
            revision: store.getRevision(),
            characters: store.listCharacters(),
            interactions: store.listInteractions().length,
            quizResults: store.listQuizResults().length,
          })
        } else if (route === 'characters') {
          send({ ok: true, characters: store.listCharacters() })
        } else if (route === 'character') {
          send({ ok: true, character: store.getCharacter(q.id) })
        } else if (route === 'card') {
          // 完整角色卡文本（面板「展开详卡」用：含九型/MBTI解析/大五解析/六节画像）
          const ch = store.getCharacter(q.id)
          send(ch ? { ok: true, name: ch.name, card: renderCharacterModel(ch, bank) } : { ok: false, error: '角色不存在' })
        } else if (route === 'novel-projects') {
          send({ ok: true, projects: novelLink.listProjects() })
        } else if (route === 'novel-characters') {
          send({ ok: true, characters: novelLink.listCharacters(q.projectId) })
        } else if (route === 'novel-status') {
          // dshnw 面板批量映射端点：一次返回该项目全部角色的详析状态（徽章/按钮用）
          const chars = novelLink.listCharacters(q.projectId)
          const profiles: Record<string, any> = {}
          for (const nc of chars) {
            const m = store.findBySource(q.projectId, nc.id)
            profiles[nc.id] = {
              name: nc.name,
              core: m?.enneagram.core ?? null,
              wing: m?.enneagram.wing ?? null,
              wingNick: m?.enneagram.wingNick ?? null,
              coreName: m?.enneagram.coreName ?? null,
              mbti: m?.mbti ?? '',
              hasProfile: Boolean(nc.personalityProfile),
              hasModel: Boolean(m),
            }
          }
          send({ ok: true, projectId: q.projectId, profiles })
        } else if (route === 'banks') {
          send({ ok: true, bank: { enneagram108: bank.enneagram108, enneagram144: bank.enneagram144, multifactor: bank.multifactor, mbti: bank.mbti, bfi: bank.bfi } })
        } else if (route === 'analyze' && req.method === 'POST') {
          // 为本地角色或 novel-writer 联动角色生成六节角色详析并（可选）写回
          const body = await readBody()
          const { projectId, characterId, depth, focus, persist } = body ?? {}
          let ch: CharacterModel | null = null
          let source: { kind: 'novel'; projectId: string; characterId: string } | null = null
          if (projectId && characterId) {
            const nc = novelLink.getCharacter(projectId, characterId)
            if (nc) {
              source = { kind: 'novel', projectId, characterId }
              const existing = store.findBySource(projectId, characterId)
              const guess = guessEnneagramFromText([nc.personality, nc.background, nc.goal, (nc.currentState?.notes ?? '')].join(' '))
              const core = guess[0] || 1
              const existingMbti = existing?.mbti ?? ''
              ch = existing ?? buildCharacterModel({
                name: nc.name, role: (nc.role as any) ?? 'supporting', appearance: nc.appearance,
                background: nc.background, goal: nc.goal, stateNotes: nc.currentState?.notes,
                enneagram: { core, level: 4 }, mbti: existingMbti,
              })
              ch.source = source
            }
          } else if (characterId) {
            ch = store.getCharacter(characterId)
          }
          if (!ch) return send({ ok: false, error: '未找到角色（需 projectId+characterId 或 characterId）' }, 404)
          try {
            const r = await analyzeCharacter(ch, source, { depth, focus, persist: persist !== false })
            return send({ ok: true, name: ch.name, narrative: r.narrative, card: r.card, saved: r.saved })
          } catch (err) {
            return send({ ok: false, error: '[LLM 生成失败] ' + String(err) }, 500)
          }
        } else if (route === 'interactions') {
          // GET=列表；POST=登记/更新一条互动
          if (req.method === 'POST') {
            const body = await readBody()
            // §8.10：输入校验——端点必填、长度上限、类型约束
            const bad = validateInteractionInput(body)
            if (bad) return send({ ok: false, error: bad }, 400)
            const pa = resolveParticipant(body.a, body.projectId)
            const pb = resolveParticipant(body.b, body.projectId)
            if (pa.key === pb.key) return send({ ok: false, error: '两个端点解析为同一个角色' }, 400)
            const existing = store.findInteraction(pa.key, pb.key, body.projectId)
            const now = new Date().toISOString()
            const it: Interaction = existing ?? { id: '', aKey: pa.key, aName: pa.name, bKey: pb.key, bName: pb.name, projectId: body.projectId, type: '互动', stance: '复杂', direction: 'a<->b', weight: 5, summary: '', analysis: '', createdAt: now, updatedAt: now } as any
            it.aName = pa.name; it.bName = pb.name; it.projectId = body.projectId ?? it.projectId
            if (body.type) it.type = String(body.type).slice(0, 40)
            if (body.stance) it.stance = String(body.stance).slice(0, 40)
            if (body.direction && ['a->b', 'b->a', 'a<->b'].includes(body.direction)) it.direction = body.direction
            if (body.weight !== undefined && Number.isFinite(Number(body.weight))) it.weight = Math.max(0, Math.min(10, Math.round(Number(body.weight))))
            if (body.summary) it.summary = String(body.summary).slice(0, 200)
            if (Array.isArray(body.tags)) it.tags = body.tags.map((x: any) => String(x).slice(0, 24)).filter(Boolean).slice(0, 8)
            if (typeof body.analysis === 'string') it.analysis = body.analysis.slice(0, 20000)
            const saved = store.upsertInteraction(it)
            return send({ ok: true, interaction: saved })
          }
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            return send({ ok: false, error: '不支持的方法：' + req.method }, 405)
          }
          send({ ok: true, interactions: store.listInteractions(q.projectId) })
        } else if (route === 'interaction') {
          const it = q.id ? store.getInteraction(q.id) : null
          send(it ? { ok: true, interaction: it } : { ok: false, error: '互动不存在' }, it ? 200 : 404)
        } else if (route === 'interactions/delete') {
          // §8.10：删除是写操作——拒绝 GET（原实现用 GET 删数据，可被预取/爬虫误触发）
          if (req.method !== 'POST' && req.method !== 'DELETE') {
            return send({ ok: false, error: '删除互动必须用 POST 或 DELETE（不接受 GET）' }, 405)
          }
          const delBody = req.method === 'DELETE' ? {} : await readBody()
          const delId = String(q.id ?? delBody.id ?? '')
          if (!delId) return send({ ok: false, error: '缺少 id 参数' }, 400)
          const ok = store.deleteInteraction(delId)
          send({ ok, deleted: ok })
        } else if (route === 'interactions/analyze' && req.method === 'POST') {
          const body = await readBody()
          let aRef = body.a, bRef = body.b, projectId = body.projectId
          if (body.id) {
            const ex = store.getInteraction(body.id)
            if (ex) { aRef = refFromKey(ex.aKey); bRef = refFromKey(ex.bKey); projectId = body.projectId ?? ex.projectId }
          }
          if (!aRef || !bRef) return send({ ok: false, error: '需要 a+b（或 id）指定互动' }, 400)
          try {
            const res = await analyzeInteraction(aRef, bRef, projectId)
            // §8.9：无效结果不落库
            if (!res.valid) {
              return send({ ok: false, error: res.reason ?? '分析未产出可用结果', invalid: true, raw: res.analysis }, 422)
            }
            let savedId = ''
            if (body.persist !== false) {
              const pa = resolveParticipant(aRef, projectId)
              const pb = resolveParticipant(bRef, projectId)
              const existing = store.findInteraction(res.aKey, res.bKey, projectId)
              const now = new Date().toISOString()
              const it: Interaction = existing ?? { id: '', projectId, aKey: res.aKey, aName: pa.name, bKey: res.bKey, bName: pb.name, type: '', stance: '', direction: 'a<->b', weight: 5, summary: '', analysis: '', createdAt: now, updatedAt: now } as any
              it.aName = pa.name; it.bName = pb.name
              it.type = res.type; it.stance = res.stance; it.direction = res.direction; it.weight = res.weight
              it.summary = res.summary; it.tags = res.tags; it.analysis = res.analysis
              savedId = store.upsertInteraction(it).id
            }
            return send({ ok: true, ...res, savedId })
          } catch (err) {
            return send({ ok: false, error: '[互动分析失败] ' + String(err) }, 500)
          }
        } else if (route === 'interactions/analyze-all' && req.method === 'POST') {
          /**
           * §8.11 修复：原实现串行逐对 await（最多 24 对 → 数分钟），无并发/限流/断点。
           * 现在：有界并发（默认 3，上限 6）+ 对失败对单独记账（不只是一个计数）+
           *       默认跳过已分析过的对，可 `only` 指定端点做断点续跑。
           */
          const body = await readBody()
          const pid = body.projectId, force = body.force === true
          const persist = body.persist !== false
          const chars = pid ? novelLink.listCharacters(pid) : store.listCharacters()
          if (chars.length < 2) return send({ ok: false, error: '至少需要两个角色才能分析互动' }, 400)
          const maxPairs = Math.min(Math.max(Number(body.maxPairs ?? 20) || 20, 1), 60)
          const concurrency = Math.min(Math.max(Number(body.concurrency ?? 3) || 3, 1), 6)
          // only：只看涉及这些角色（id 或名字）的组合，便于断点续跑
          const only: string[] = Array.isArray(body.only) ? body.only.map((x: any) => String(x)) : []
          const matchOnly = (c: any) => only.length === 0 || only.includes(c.id) || only.includes(c.name)

          const pairs: { aRef: string; bRef: string; aName: string; bName: string }[] = []
          for (let i = 0; i < chars.length && pairs.length < maxPairs; i++) {
            if (!matchOnly(chars[i])) continue
            for (let j = i + 1; j < chars.length && pairs.length < maxPairs; j++) {
              if (!matchOnly(chars[j])) continue
              const a = chars[i], b = chars[j]
              const aRef = pid ? a.id : a.name, bRef = pid ? b.id : b.name
              // 跳过已分析过的对（仅项目作用域可预判 key；本地作用域由 analyzeInteraction 内部去重）
              if (pid && !force) {
                const ex = store.findInteraction(`novel:${pid}:${aRef}`, `novel:${pid}:${bRef}`, pid)
                if (ex && ex.analysis) continue
              }
              pairs.push({ aRef, bRef, aName: a.name, bName: b.name })
            }
          }

          const done: { a: string; b: string; aName: string; bName: string; type: string }[] = []
          const failures: { a: string; b: string; aName: string; bName: string; reason: string }[] = []
          let cursor = 0
          const worker = async () => {
            while (cursor < pairs.length) {
              const p = pairs[cursor++]
              try {
                const res = await analyzeInteraction(p.aRef, p.bRef, pid)
                if (!res.valid) {
                  failures.push({ a: p.aRef, b: p.bRef, aName: p.aName, bName: p.bName, reason: res.reason ?? '结果无效' })
                  continue
                }
                if (persist) {
                  const pa = resolveParticipant(p.aRef, pid); const pb = resolveParticipant(p.bRef, pid)
                  const existing = store.findInteraction(res.aKey, res.bKey, pid)
                  const now = new Date().toISOString()
                  const it: Interaction = existing ?? { id: '', projectId: pid, aKey: res.aKey, aName: pa.name, bKey: res.bKey, bName: pb.name, type: '', stance: '', direction: 'a<->b', weight: 5, summary: '', analysis: '', createdAt: now, updatedAt: now } as any
                  it.aName = pa.name; it.bName = pb.name
                  it.type = res.type; it.stance = res.stance; it.direction = res.direction; it.weight = res.weight
                  it.summary = res.summary; it.tags = res.tags; it.analysis = res.analysis
                  store.upsertInteraction(it)
                }
                done.push({ a: res.aKey, b: res.bKey, aName: p.aName, bName: p.bName, type: res.type })
              } catch (e) {
                failures.push({ a: p.aRef, b: p.bRef, aName: p.aName, bName: p.bName, reason: String((e as any)?.message ?? e).slice(0, 160) })
              }
            }
          }
          await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(pairs.length, 1)) }, () => worker()))
          // 未被选中的剩余对数（供 UI 显示进度/续跑指引）
          const totalPairs = (chars.length * (chars.length - 1)) / 2
          return send({
            ok: true,
            analyzed: done,
            count: done.length,
            failed: failures.length,
            failures: failures.slice(0, 40),
            attempted: pairs.length,
            remaining: Math.max(0, totalPairs - done.length - failures.length),
            concurrency,
            note: failures.length
              ? `${failures.length} 对分析失败/结果无效（可稍后重试；失败清单见 failures）`
              : '',
          })
        } else if (route === 'quiz-banks') {
          // §8.13：UI 问卷下拉清单（15 种，含题数）
          send({ ok: true, banks: listQuizMeta(bank) })
        } else if (route === 'quiz-questions') {
          // §8.13：取某问卷的题目（前端渲染作答界面）；from/to 为 1 基闭区间，to=0 表示到底
          const kind = String(q.kind ?? '') as QuestionnaireKind
          if (!kind) return send({ ok: false, error: '缺少 kind 参数' }, 400)
          const from = Math.max(1, Number(q.from ?? 1) || 1)
          const to = Math.max(0, Number(q.to ?? 0) || 0)
          try {
            const items = buildUiQuestions(kind, bank, from, to)
            if (items.length === 0 && from === 1) return send({ ok: false, error: '未知或未加载的问卷: ' + kind }, 404)
            const meta = listQuizMeta(bank).find(m => m.id === kind)
            return send({ ok: true, kind, name: meta?.name ?? kind, total: meta?.count ?? items.length, from, items })
          } catch (err) {
            return send({ ok: false, error: String(err) }, 500)
          }
        } else if (route === 'quiz-score' && req.method === 'POST') {
          // §8.13：UI 提交作答 → 走与 character_questionnaire 完全相同的计分流程
          const body = await readBody()
          const kind = String(body.kind ?? '') as QuestionnaireKind
          if (!kind) return send({ ok: false, error: '缺少 kind 参数' }, 400)
          if (!body.answers || typeof body.answers !== 'object') return send({ ok: false, error: 'answers 必须是对象 {题号: 值}' }, 400)
          try {
            const r = await runQuestionnaire({
              kind, answers: body.answers, characterId: body.characterId,
              allowPartial: body.allowPartial === true,
            })
            return send({ ok: true, ...r })
          } catch (err) {
            return send({ ok: false, error: String((err as any)?.message ?? err) }, 400)
          }
        } else if (route === 'quiz-history') {
          // §8.13：UI 历史列表（含完整作答可在前端复盘）
          let list = store.listQuizResults(q.characterId)
          if (q.kind) list = list.filter(x => x.kind === q.kind)
          const limit = Math.min(Math.max(Number(q.limit ?? 50) || 50, 1), 200)
          return send({
            ok: true,
            total: list.length,
            records: list.slice(0, limit).map(x => ({
              id: x.id, kind: x.kind, characterId: x.characterId,
              characterName: x.characterId ? (store.getCharacter(x.characterId)?.name ?? '') : '',
              summary: x.summary, finishedAt: x.finishedAt,
              missingCount: x.missing?.length ?? 0,
              hasAnswers: Boolean(x.answers),
            })),
          })
        } else if (route === 'quiz-record') {
          // 单条完整记录（含原始作答 + 计分明细，供"复盘/重算"）
          const rec = store.listQuizResults().find(x => x.id === q.id)
          return send(rec ? { ok: true, record: rec } : { ok: false, error: '作答记录不存在' }, rec ? 200 : 404)
        } else if (route === 'relationship-graph') {
          send({ ok: true, graph: buildGraph(q.projectId) })
        } else if (route === 'revision') {
          const chars = store.listCharacters()
          send({
            ok: true,
            revision: store.getRevision(),
            schemaVersion: SCHEMA_VERSION,
            characters: chars.length,
            interactions: store.listInteractions(q.projectId).length,
            quizResults: store.listQuizResults().length,
          })
        } else {
          send({ ok: false, error: 'unknown route: ' + route })
        }
      } catch (e) {
        send({ ok: false, error: String(e) })
      }
    },
  }))

  ctx.effect(() => () => {
    for (const d of disposers.splice(0)) { try { d() } catch { /* 卸载容错 */ } }
  })

  ctx.logger?.info?.(`[${name}] 角色设定工作坊就绪（数据目录: ${dataDir}，问卷: 108/144/深度39/MBTI93/BFI260，novel-writer: ${novelLink.listProjects().length ? '已联动' : '未发现（独立运行模式）'}）`)
}