/**
 * §8.16：插件最小回归自检（无外部测试框架依赖，可在工具里直接跑）。
 *
 * 覆盖：
 *  1. 15 种问卷计分器（合成作答，不触碰真实数据）
 *  2. §8.6 主型/侧翼推导（deriveCoreWing）
 *  3. §8.4 MBTI 跨轴题跳过
 *  4. §8.5 multifactor 派生指标（Harmonic/客体关系/霍尼维安/明暗六角）+ §8.18 四大三元组正名结构
 *     + §8.19 三元组详析素材（提示词串 / 写作钩子 / behaviors·arcAdvice 落地）
 *     + §8.20 三要素（缺陷类型学 FLAW_TYPES / flawSeed 九型号候选）
 *  5. §8.14 健康层级 9 级表
 *  6. §8.15 subtypeProfile 非法主型不再静默借用 5 号
 *  7. §8.7 文本猜型（加权 + 只返回命中）
 *  8. §8.8 作答完整性校验 / §8.10 互动入参校验 / §8.9 JSON 提取
 *  9. store 读写 + revision 递增 + §8.2 schema 迁移（v1 → 3）
 *
 * 全部在临时目录里跑，不写用户数据。
 */
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { QuestionBank } from './engine.js'
import {
  scoreEnneagram108, scoreEnneagram144, scoreMultifactor, scoreMbti, scoreBigfive,
  scoreIpipNeo120, scoreLikertBank, enneagram90Type, deriveCoreWing, levelInfo,
  mbtiCrossAxisItems, subtypeProfile, guessEnneagramScored, guessEnneagramFromText,
  buildCharacterModel, triadLabels, triadMembership, TRIAD_SYSTEMS,
  triadFactsLine, triadWritingHooks, triadGroupOf,
  FLAW_TYPES, flawSeed, flawTypeOf, characterDynamics, TYPE_DYNAMICS,
} from './engine.js'
import { CharacterStore, SCHEMA_VERSION } from './store.js'
import { checkAnswers, extractJsonObject, validateInteractionInput } from './index.js'

export interface SelfTestResult {
  report: string
  passed: number
  failed: number
}

export function runSelfTest(bank: QuestionBank): SelfTestResult {
  const lines: string[] = []
  let passed = 0
  let failed = 0
  const ok = (name: string, cond: boolean, extra = '') => {
    if (cond) { passed++; lines.push(`  PASS  ${name}${extra ? ' — ' + extra : ''}`) }
    else { failed++; lines.push(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`) }
  }
  const section = (t: string) => lines.push(`\n▎${t}`)

  // ── 1. 计分器 ──
  section('问卷计分器（合成作答）')
  try {
    const ans: Record<number, any> = {}
    for (const q of bank.enneagram108) ans[q.n] = q.type === 5
    const s108 = scoreEnneagram108(bank, ans)
    const d108 = deriveCoreWing(s108)
    ok('enneagram-108 计分', s108.length === 9, `主型 ${d108.core} 翼 ${d108.wing}`)
    ok('enneagram-108 主型=5（题面全押 5 号）', d108.core === 5)
  } catch (e) { ok('enneagram-108 计分', false, String(e)) }

  try {
    const ans: Record<number, any> = {}
    for (const q of bank.enneagram144) ans[q.n] = 'a'
    const d = deriveCoreWing(scoreEnneagram144(bank, ans))
    ok('enneagram-144 计分', d.core >= 1 && d.core <= 9, `主型 ${d.core} 翼 ${d.wing}`)
  } catch (e) { ok('enneagram-144 计分', false, String(e)) }

  try {
    const ans: Record<number, any> = {}
    for (const it of bank.multifactor) ans[it.no] = 'a'
    const r = scoreMultifactor(bank, ans)
    ok('multifactor 计分', r.core >= 1 && r.core <= 9, `核心 ${r.wingKey} tritype ${r.tritype} 本能 ${r.stack}`)
    ok('§8.5 情绪三元组已实现（旧键兼容）', typeof r.harmonyTriads?.reactive === 'number')
    ok('§8.5 客体关系已实现（旧键兼容）', typeof r.objectRelations?.attachment === 'number')
    ok('§8.5 霍尼维安已实现（旧键兼容）', typeof r.hornevian?.superego === 'number')
    ok('§8.5 明暗六角已实现', typeof r.lightDark?.light === 'number')
    ok('§8.5 主导项已推导', Boolean(r.dominant?.harmony && r.dominant?.hornevian))
    // §8.18 三元组正名结构
    ok('§8.18 Harmonic 正名', typeof r.harmonicGroups?.reactive === 'number')
    ok('§8.18 Harmony(Daniels) 正名', typeof r.harmonyDaniels?.idealist === 'number')
    ok('§8.18 Hornevian compliant 别名', r.hornevianGroups?.compliant === r.hornevian?.superego)
    ok('§8.18 Daniels=客体关系同值', r.harmonyDaniels?.pragmatist === r.objectRelations?.attachment)
    ok('§8.18 中文主导标签', Boolean(r.dominantZh?.harmonic && r.dominantZh?.hornevian))
    const tl = triadLabels(r.core)
    ok('§8.18 triadLabels 四组齐', Boolean(tl.center && tl.hornevian && tl.harmonic && tl.harmony), `${tl.center}/${tl.hornevian}/${tl.harmonic}/${tl.harmony}`)
    ok('§8.18 TRIAD_SYSTEMS 覆盖全部型号', [1, 2, 3, 4, 5, 6, 7, 8, 9].every(c => triadMembership(c).length === 4))
    // §8.19 三元组详析素材
    const fl = triadFactsLine(5)
    ok('§8.19 提示词素材含四组', fl.includes('智慧中心') && fl.includes('社交姿态') && fl.includes('冲突应对') && fl.includes('客体关系'), fl.slice(0, 60) + '…')
    ok('§8.19 写作钩子四条', triadWritingHooks(5).length === 4)
    ok('§8.19 triadGroupOf 可取组', triadGroupOf(5, 'harmonic')?.zh === '能力组' && triadGroupOf(5, 'nope') === undefined)
  } catch (e) { ok('multifactor 计分', false, String(e)) }

  try {
    const cross = mbtiCrossAxisItems(bank)
    const ans: Record<number, any> = {}
    for (let i = 1; i <= bank.mbti.length; i++) ans[i] = 'a'
    const r = scoreMbti(bank, ans)
    ok('§8.4 跨轴题被识别', cross.length >= 1, `题号 ${cross.join(',')}`)
    ok('§8.4 跨轴题被计分跳过', r.skipped.length === cross.length, `skipped=${r.skipped.join(',')}`)
    ok('mbti-93 出四字母', /^[EI][SN][TF][JP]$/.test(r.code), r.code)
  } catch (e) { ok('mbti-93 计分', false, String(e)) }

  try {
    const ans: Record<number, any> = {}
    for (const it of bank.bfi) ans[it.n] = 3
    const r = scoreBigfive(bank, ans)
    const vals = (['Openness', 'Conscientiousness', 'Extraversion', 'Agreeableness', 'Neuroticism'] as const).map(k => r[k])
    ok('bigfive-60 计分', vals.every(v => typeof v === 'number'), vals.join('/'))
    ok('bigfive-60 全取中值≈50', vals.every(v => Math.abs((v as number) - 50) <= 2))
  } catch (e) { ok('bigfive-60 计分', false, String(e)) }

  try {
    const ans: Record<number, any> = {}
    ;(bank.ipip ?? []).forEach((it, i) => { ans[i + 1] = 3 })
    const r = scoreIpipNeo120(bank, ans)
    ok('ipip-neo-120 计分', Object.keys(r.big).length === 5, JSON.stringify(r.big))
    ok('ipip-neo-120 30 子维度', Object.keys(r.facets).length === 30, `${Object.keys(r.facets).length} 个`)
  } catch (e) { ok('ipip-neo-120 计分', false, String(e)) }

  const likerts: [string, any][] = [
    ['enneagram-90', bank.enneagram90], ['hexaco-24', bank.hexaco24], ['sd3', bank.sd3],
    ['ecr-12', bank.ecr12], ['locus-24', bank.locus24], ['mfq-30', bank.mfq30],
    ['pvq-21', bank.pvq21], ['disc-32', bank.disc32], ['eq-22', bank.eq22],
  ]
  for (const [kind, lkb] of likerts) {
    try {
      if (!lkb) { ok(`${kind} 题库存在`, false, '未加载'); continue }
      const ans: Record<number, any> = {}
      const mid = (lkb.scaleMin + lkb.scaleMax) / 2
      for (const it of lkb.items) ans[it.position] = mid
      const r = scoreLikertBank(lkb, ans)
      const allDims = lkb.dimensions.every((d: any) => typeof r.scores[d.id] === 'number')
      ok(`${kind} 计分（${lkb.items.length} 题 / ${lkb.dimensions.length} 维）`, allDims && r.missing.length === 0)
    } catch (e) { ok(`${kind} 计分`, false, String(e)) }
  }

  try {
    const ans: Record<number, any> = {}
    for (const it of bank.enneagram90!.items) ans[it.position] = 5
    const r = scoreLikertBank(bank.enneagram90!, ans)
    const t = enneagram90Type(r.scores)
    ok('enneagram-90 类型推导', t.core >= 1 && t.core <= 9, `核心 ${t.core} 翼 ${t.wing}`)
  } catch (e) { ok('enneagram-90 类型推导', false, String(e)) }

  // ── 2. 知识与派生逻辑 ──
  section('知识与派生逻辑')
  try {
    const l1 = levelInfo(1), l5 = levelInfo(5), l9 = levelInfo(9)
    ok('§8.14 健康层级 9 级表', [l1, l2t(l5), l9].every(Boolean as any) && l1.band === '健康' && l5.band === '一般' && l9.band === '病态',
      `1级=${l1.name} / 5级=${l5.name} / 9级=${l9.name}`)
  } catch (e) { ok('§8.14 健康层级 9 级表', false, String(e)) }

  try {
    const p5 = subtypeProfile(5, 'sx')
    const bad = subtypeProfile(99 as any, 'sp')
    ok('§8.15 亚型档案正常取用', p5.name === '知己' && p5.isCounter === true, `${p5.name} 反型=${p5.isCounter}`)
    ok('§8.15 非法主型被归一（不再静默借 5 号文案）', bad.name === subtypeProfile(9, 'sp').name, `core=99 → ${bad.name}`)
  } catch (e) { ok('§8.15 亚型档案', false, String(e)) }

  try {
    const g = guessEnneagramScored('他喜欢独处思考，研究分析知识，观察冷静')
    ok('§8.7 文本猜型加权命中', g.length > 0 && g[0].type === 5, `→ ${g.map(x => x.type + '号(' + x.score + ')').join(' ')}`)
    const empty = guessEnneagramFromText('完全没有关键词的句子呀')
    ok('§8.7 零命中返回空（不再混入 0 分型号）', empty.length === 0, `返回 ${JSON.stringify(empty)}`)
  } catch (e) { ok('§8.7 文本猜型', false, String(e)) }

  try {
    const m = buildCharacterModel({ name: '自检角色', enneagram: { core: 5, wing: 4, subtype: 'sx', level: 7 } })
    ok('buildCharacterModel 组装', m.enneagram.wing === '5w4' && m.enneagram.subtype === 'sx' && m.enneagram.level === 7)
    ok('§8.14 卡片带 levelName', m.enneagram.levelName === levelInfo(7).name, `7级=${m.enneagram.levelName}`)
    ok('§8.18 卡片带三元组归属', Boolean(m.enneagram.triads?.center.includes('脑')) && Boolean(m.enneagram.triads?.hornevian.includes('退缩')),
      `5号=${m.enneagram.triads?.center}/${m.enneagram.triads?.hornevian}/${m.enneagram.triads?.harmonic}/${m.enneagram.triads?.harmony}`)
    // §8.19：三元组写进 behaviors / arcAdvice（无 LLM 也有三元组行为线索）
    ok('§8.19 behaviors 含三元组行为', m.behaviors.some(b => b.includes('社交姿态')) && m.behaviors.some(b => b.includes('冲突第一反应')))
    ok('§8.19 arcAdvice 含三元组弧光', m.arcAdvice.some(a => a.includes('三元组·客体关系')) && m.arcAdvice.some(a => a.includes('三元组·智慧中心')))
    // §8.19：9 型号全覆盖（每个型号都必须拿到四条三元组内容，不能有型号漏项）
    const allNine = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(c => buildCharacterModel({ name: `自检${c}`, enneagram: { core: c, level: 4 } }))
    ok('§8.19 九型号三元组全覆盖',
      allNine.every(x => x.enneagram.triads && x.behaviors.some(b => b.includes('社交姿态')) && x.behaviors.some(b => b.includes('冲突第一反应')) && x.arcAdvice.some(a => a.includes('三元组·客体关系'))),
      allNine.map(x => `${x.enneagram.core}:${x.enneagram.triads?.hornevian.slice(0, 2)}`).join(' '))
    // §8.20 三要素：缺陷类型学与候选种子
    ok('§8.20 缺陷类型学非空', FLAW_TYPES.length >= 8, `${FLAW_TYPES.length} 类`)
    ok('§8.20 flawSeed 覆盖九型号', [1, 2, 3, 4, 5, 6, 7, 8, 9].every(c => flawSeed(c).length >= 2))
    ok('§8.20 flawTypeOf 能分类', flawTypeOf('过度理性化')?.key === 'over_rational' && flawTypeOf('完美主义')?.key === 'perfectionism')
    // §8.22 人格变化动态：TYPE_DYNAMICS 全型号 + characterDynamics 派生 + 箭头一致性 + 写入模型
    ok('§8.22 TYPE_DYNAMICS 覆盖九型号', [1, 2, 3, 4, 5, 6, 7, 8, 9].every(c => TYPE_DYNAMICS[c] && TYPE_DYNAMICS[c].integration.look && TYPE_DYNAMICS[c].stress.look && TYPE_DYNAMICS[c].wingSwing))
    const d5 = characterDynamics(5, '5w4', 4)
    ok('§8.22 dynamics 箭头一致', d5.integration.to === 8 && d5.stress.to === 7, `整合→${d5.integration.to} 压力→${d5.stress.to}`)
    ok('§8.22 dynamics 文案齐', Boolean(d5.integration.look && d5.stress.resource && d5.wingSwing && d5.text.includes('整合') && d5.text.includes('压力')))
    ok('§8.22 模型带 dynamics', Boolean(m.enneagram.dynamics?.integration.to && m.enneagram.dynamics?.stress.to))
    ok('behaviors/arcAdvice 非空', m.behaviors.length >= 4 && m.arcAdvice.length >= 4)
  } catch (e) { ok('buildCharacterModel 组装', false, String(e)) }

  // ── 3. 校验与解析工具 ──
  section('校验与解析')
  try {
    const bad = checkAnswers('bigfive-60', bank, {})
    ok('§8.8 空作答被判定不完整', bad.ok === false && bad.missing.length === 60, bad.note)
    const full: Record<number, any> = {}
    for (const it of bank.bfi) full[it.n] = 3
    const good = checkAnswers('bigfive-60', bank, full)
    ok('§8.8 完整作答通过', good.ok === true, good.note)
    const partial = checkAnswers('bigfive-60', bank, { 1: 3, 2: 4 })
    ok('§8.8 部分作答缺题数正确', partial.missing.length === 58)
  } catch (e) { ok('§8.8 作答校验', false, String(e)) }

  try {
    ok('§8.10 缺 a 被拒', validateInteractionInput({ b: 'x' }) !== null)
    ok('§8.10 同端点被拒', validateInteractionInput({ a: 'x', b: 'x' }) !== null)
    ok('§8.10 非法 direction 被拒', validateInteractionInput({ a: 'x', b: 'y', direction: 'x->y' }) !== null)
    ok('§8.10 合法入参通过', validateInteractionInput({ a: 'x', b: 'y', weight: 5, direction: 'a->b', tags: [] }) === null)
  } catch (e) { ok('§8.10 互动入参校验', false, String(e)) }

  try {
    const j = extractJsonObject<{ a: number }>('前置说明\n```json\n{"a":1,"s":"含}字符"}\n```\n后置')
    ok('§8.9 JSON 括号配平提取', j?.a === 1, JSON.stringify(j))
    ok('§8.9 非 JSON 返回 null', extractJsonObject('完全没有 JSON') === null)
  } catch (e) { ok('§8.9 JSON 提取', false, String(e)) }

  // ── 4. store + 迁移 ──
  section('存储与 schema 迁移')
  const dir = mkdtempSync(join(tmpdir(), 'cm-selftest-'))
  try {
    const store = new CharacterStore(dir)
    const ch = buildCharacterModel({ name: '自检角色', enneagram: { core: 5, wing: 4, subtype: 'sx', level: 4 } })
    const saved = store.upsertCharacter(ch)
    ok('store 写入角色', Boolean(saved.id) && store.listCharacters().length === 1)
    const r1 = store.getRevision()
    store.upsertCharacter(saved)
    ok('§5 revision 递增', store.getRevision() > r1, `${r1} → ${store.getRevision()}`)
    const rec = store.addQuizResult({ kind: 'bigfive-60', characterId: saved.id, answers: { 1: 3 }, scores: { Openness: 50 }, summary: '自检' })
    ok('§8.1 完整作答记录落库', Boolean(rec.id && rec.answers && rec.scores))
    ok('§8.1 可按角色查历史', store.listQuizResults(saved.id).length === 1)
    const it = store.upsertInteraction({
      id: '', aKey: 'local:' + saved.id, aName: '自检角色', bKey: 'raw:对方', bName: '对方',
      type: '敌手', stance: '敌对', direction: 'a->b', weight: 7, summary: '自检边',
      createdAt: '', updatedAt: '',
    })
    ok('关系边落库', store.listInteractions().length === 1 && Boolean(it.id))
  } catch (e) { ok('store 读写', false, String(e)) }

  // 迁移：造一份 v1 旧数据
  const dir2 = mkdtempSync(join(tmpdir(), 'cm-migrate-'))
  try {
    const legacy = {
      revision: 5,
      characters: [{
        id: 'c-legacy01', name: '旧版角色', role: 'protagonist',
        appearance: '旧外貌', background: '旧背景', goal: '旧目标',
        enneagram: {
          core: 5, wing: '5w4', subtype: 'sx', level: 6,
          coreName: '智慧型/观察者', virtue: '放下 / 清明', vice: '贪婪 / 吝啬',
          wingNick: '思想家', subtypeLabel: '知己(反)',
          presence: '旧版写入的气质', catchphrase: ['旧口头禅'],
        },
        persona: { old: true }, keywords: ['旧关键词'],
        behaviors: [], arcAdvice: [], createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z',
      }],
      quizResults: [{ kind: 'mbti-93', finishedAt: '2020-01-01T00:00:00.000Z' }],
      interactions: [],
    }
    writeFileSync(join(dir2, 'characters.json'), JSON.stringify(legacy, null, 2), 'utf8')
    const store2 = new CharacterStore(dir2)
    const chars = store2.listCharacters()
    const c = chars[0]
    ok('§8.2 迁移到 schemaVersion ' + SCHEMA_VERSION, store2.getSchemaVersion() === SCHEMA_VERSION, `实际 ${store2.getSchemaVersion()}`)
    ok('§8.2 知识库文案已刷新', c.enneagram.virtue !== '放下 / 清明' && c.enneagram.wingNick !== '思想家',
      `virtue=${c.enneagram.virtue} wingNick=${c.enneagram.wingNick}`)
    ok('§8.2 自由文本保留', c.appearance === '旧外貌' && c.background === '旧背景' && c.goal === '旧目标')
    ok('§8.2 遗留 persona/keywords 移入 library.legacy', Boolean(c.library?.legacy?.persona && c.library?.legacy?.keywords))
    ok('§8.2 顶层不再有 persona', (c as any).persona === undefined)
    ok('§8.17 旧 presence/catchphrase 保留', c.enneagram.presence === '旧版写入的气质' && c.enneagram.catchphrase?.[0] === '旧口头禅')
    ok('§8.2 旧 quizResults 补 id', Boolean(store2.listQuizResults()[0]?.id))
    ok('§8.2 迁移留了备份', existsSync(join(dir2, `characters.pre-v${SCHEMA_VERSION}.bak`)))
  } catch (e) { ok('§8.2 schema 迁移', false, String(e)) }

  // 损坏文件不再静默丢数据
  const dir3 = mkdtempSync(join(tmpdir(), 'cm-corrupt-'))
  try {
    writeFileSync(join(dir3, 'characters.json'), '{ 这不是合法 JSON', 'utf8')
    const store3 = new CharacterStore(dir3)
    const chars = store3.listCharacters()
    const notes = store3.getMigrationNotes()
    ok('§8.5 损坏文件返回空结构而非崩溃', Array.isArray(chars) && chars.length === 0)
    ok('§8.5 损坏文件已备份', notes.some(n => n.includes('损坏')))
  } catch (e) { ok('§8.5 损坏文件处理', false, String(e)) }

  try { rmSync(dir, { recursive: true, force: true }) } catch { /* 清理 */ }
  try { rmSync(dir2, { recursive: true, force: true }) } catch { /* 清理 */ }
  try { rmSync(dir3, { recursive: true, force: true }) } catch { /* 清理 */ }

  const report = [
    '═'.repeat(52),
    `角色设定工作坊 · 自检报告   ${failed === 0 ? '✅ 全部通过' : `❌ ${failed} 项失败`}`,
    `PASS ${passed} / FAIL ${failed}`,
    '═'.repeat(52),
    ...lines,
    '',
    failed === 0 ? '所有检查通过。' : `有 ${failed} 项未通过，请查看上方 FAIL 行。`,
  ].join('\n')

  return { report, passed, failed }
}

/** 小工具：断言 levelInfo 返回值可用（避免内联表达式过长） */
function l2t(v: unknown): boolean { return Boolean(v) }
