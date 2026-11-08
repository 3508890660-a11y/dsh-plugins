/**
 * 角色设定工作坊 · 引擎层
 *
 * 职责：
 *  1) 九型人格档案（ENNEAGRAM_PROFILES）——主型/侧翼/副型/健康层级知识库。
 *  2) 各问卷计分：enneagram-108 / enneagram-144 / enneagram-multifactor / mbti-93 / bigfive-60。
 *  3) buildCharacterModel：把用户输入 + 计分结果组装成完整 CharacterModel。
 *
 * 以九型人格为主干，MBTI 与大五（BFI-2）为补充。
 */
import type { CharacterModel, CharacterRole, EnneagramModel, EnneagramProfile, Subtype, BigFiveScores, LevelInfo } from './types.js'

// ──────────────────────────────────────────────────────────────
// 九型人格档案（Riso-Hudson 体系精简版）
// ──────────────────────────────────────────────────────────────

/** 主型 → 基础档案 */
export const ENNEAGRAM_PROFILES: Record<number, EnneagramProfile> = {
  1: {
    core: 1, zh: '完美主义者/改革者', en: 'Reformer', center: '腹/本能',
    virtue: '安详 / 平静', vice: '愤怒 / 怨恨',
    fear: ['被看作错误的、坏的、堕落的'],
    desire: ['做正确的事、正直、有条理'],
    traits: ['有原则、讲道德、自律严格', '追求完美与秩序，挑剔错漏', '隐忍克制，压抑愤怒以维持正确'],
    stressArrow: 4, growthArrow: 7,
    harmony: { name: '松弛', desc: '压力→4号自我怀疑；成长→7号的松弛乐观，允许自己犯错与享受' },
  },
  2: {
    core: 2, zh: '助人者/给予者', en: 'Helper', center: '心/情感',
    virtue: '谦卑 / 无私', vice: '骄傲 / 讨好',
    fear: ['不被爱、不被需要'],
    desire: ['被爱、被需要、不可或缺'],
    traits: ['热心、体贴、乐于付出', '以他人需要为先，强关系导向', '以付出换取被爱，回避表达自身需求'],
    stressArrow: 8, growthArrow: 4,
    harmony: { name: '坦然', desc: '压力→8号的强势自我主张；成长→4号接受真实需求，不再靠讨好确认价值' },
  },
  3: {
    core: 3, zh: '成就者/实干者', en: 'Achiever', center: '心/情感',
    virtue: '真诚 / 踏实', vice: '虚荣 / 自欺',
    fear: ['无价值、失败、不被认可'],
    desire: ['有价值、成功、被羡慕'],
    traits: ['目标导向、高效、结果主义', '在意形象与成就，擅长包装', '以成功界定自我价值，回避失败与真实感受'],
    stressArrow: 9, growthArrow: 6,
    harmony: { name: '真诚', desc: '压力→9号怠惰松懈；成长→6号勇于直面不确定，做真实的自己而非演出成功' },
  },
  4: {
    core: 4, zh: '自我型/浪漫主义者', en: 'Individualist', center: '心/情感',
    virtue: '平衡 / 原初', vice: '嫉妒 / 自怜',
    fear: ['没有身份认同、没有个人意义、平淡无奇'],
    desire: ['找到真实的自我、独一无二'],
    traits: ['内省细腻、情绪深邃', '追求独特与美，抗拒平庸', '以不同定义自我，常感缺失与羡慕他人'],
    stressArrow: 2, growthArrow: 1,
    harmony: { name: '本色', desc: '压力→2号讨好求认同；成长→1号把情绪升华为有原则的创造' },
  },
  5: {
    core: 5, zh: '智慧型/观察者', en: 'Investigator', center: '脑/思维',
    virtue: '超然 / 知足', vice: '贪婪 / 吝啬（能量与知识）',
    fear: ['无能、无用、被耗尽、被侵入'],
    desire: ['有能力、理解世界、保有资源'],
    traits: ['求知若渴、深究逻辑', '保护隐私与资源，蓄力观察', '情感抽离、先观察后参与'],
    stressArrow: 7, growthArrow: 8,
    harmony: { name: '投入', desc: '压力→7号逃入知识的多巴胺；成长→8号走出象牙塔，用能力守护在意的人' },
  },
  6: {
    core: 6, zh: '忠诚者/怀疑论者', en: 'Loyalist', center: '脑/思维',
    virtue: '勇气 / 信任', vice: '恐惧 / 偏执',
    fear: ['失去支持与指引、无法生存'],
    desire: ['安全、获得支持'],
    traits: ['警觉多疑、预设最坏结果', '寻求可信赖的权威或团体', '反恐惧者外表强硬内心脆弱'],
    stressArrow: 3, growthArrow: 9,
    harmony: { name: '信任', desc: '压力→3号逞强自大压住焦虑；成长→9号放下戒备，真正信任与平静' },
  },
  7: {
    core: 7, zh: '活跃型/享乐主义者', en: 'Enthusiast', center: '脑/思维',
    virtue: '节制 / 清醒', vice: '贪图 / 放纵',
    fear: ['被困住、被剥夺自由、承受痛苦'],
    desire: ['满足、自由、丰富的体验'],
    traits: ['乐观好奇、追求刺激与新体验', '多线并行、点子多、避痛', '用忙碌与乐趣回避深入的苦痛'],
    stressArrow: 1, growthArrow: 5,
    harmony: { name: '专注', desc: '压力→1号挑剔苛责；成长→5号沉静下来，深入而非逃开' },
  },
  8: {
    core: 8, zh: '领袖型/挑战者', en: 'Challenger', center: '腹/本能',
    virtue: '天真 / 坦率', vice: '纵欲 / 控制',
    fear: ['被控制、被伤害、被摆布'],
    desire: ['自保、自主、掌控局势'],
    traits: ['果决强势、保护他人、有掌控欲', '直接坦率、爱憎分明', '以力量和对抗确认存在，拒绝示弱'],
    stressArrow: 5, growthArrow: 2,
    harmony: { name: '柔韧', desc: '压力→5号孤立退缩；成长→2号学会示弱与关怀，强大而不伤人' },
  },
  9: {
    core: 9, zh: '和平型/调停者', en: 'Peacemaker', center: '腹/本能',
    virtue: '行动 / 自在', vice: '怠惰 / 自我遗忘',
    fear: ['冲突、失去联结与归属'],
    desire: ['内心平静、与人和睦'],
    traits: ['随和包容、擅长安抚调停', '淡化自我立场、回避冲突', '用麻痹性日常拖延，遗忘自己的需要'],
    stressArrow: 6, growthArrow: 3,
    harmony: { name: '觉醒', desc: '压力→6号焦虑寻求外部安慰；成长→3号确立自我、主动行动' },
  },
}

/** 主翼配伍 → 翼昵称 */
export const WING_NICK: Record<string, string> = {
  '1w9': '理想主义者', '1w2': '倡导者',
  '2w1': '仆人', '2w3': '主人/女主人',
  '3w2': '魅力者', '3w4': '专业者',
  '4w3': '贵族', '4w5': '波希米亚人',
  '5w4': '反传统者', '5w6': '问题解决者',
  '6w5': '忠诚的守卫者', '6w7': '伙伴',
  '7w6': '表演者', '7w8': '现实主义者',
  '8w7': '独立者', '8w9': '熊',
  '9w8': '调解人', '9w1': '梦想家',
}

/** 本能副型（三大本能）基础标签 */
export const SUBTYPE_KEYWORDS: Record<Subtype, { label: string; note: string }> = {
  sp: { label: '自保', note: '关注安全、资源、身体舒适，倾向独处蓄力' },
  sx: { label: '一对一', note: '关注亲密联结、化学反应，把能量投向重要少数' },
  so: { label: '社交', note: '关注群体归属、角色与受欢迎程度，重视在场感' },
}

/** 本能副型全称（用于卡片显示） */
export const SUBTYPE_FULL: Record<Subtype, string> = {
  sp: '自我保存', sx: '一对一', so: '社交',
}

/**
 * 27 种亚型（Naranjo 体系：9 型号 × 3 本能）。
 * 亚型比翼型更能解释「同一型号内部」的差异：恶习/激情遇上主导本能，会显著改变外部表现。
 * isCounter = 反型（Countertype）：该亚型表现与同型号另两个相反，易被误判成别的型号。
 * 来源：research/personality-tests/enneagram-subtypes.md（Integrative9 27 亚型）。
 */
export interface SubtypeProfile { name: string; keyword: string; traits: string[]; isCounter: boolean }

export const SUBTYPE_PROFILES: Record<number, Record<Subtype, SubtypeProfile>> = {
  1: {
    sp: { name: '担忧', keyword: '真·完美主义者', isCounter: false, traits: ['忧心忡忡追求掌控，预测风险、提前解决问题', '内心批评严苛，对细节不放过', '压抑愤怒，计划被打乱会深感沮丧'] },
    sx: { name: '热忱', keyword: '改革的热忱者', isCounter: true, traits: ['强势、有影响力，坚信事情该"那样运作"', '有权改造他人/社会，视之为责任', '改造受阻时直率表达愤怒'] },
    so: { name: '无法适应', keyword: '正直的异类', isCounter: false, traits: ['关注对错与恰当，以正直立身', '自律严格、鹤立鸡群', '为"匡扶正义"而行动，常伴僵硬肢体语言'] },
  },
  2: {
    sp: { name: '特权', keyword: '孩子气的特权者', isCounter: true, traits: ['"可爱"、害羞但有魅力，激发他人保护欲', '既渴望被照顾又抗拒依赖、自我保护', '怕被拒绝，可能被误判为 7 或 6'] },
    sx: { name: '吸引', keyword: '诱惑的给予者', isCounter: false, traits: ['用才能/诱惑力/精力吸引并建立亲密关系', '意志强、激情、肯投入', '不易接受限制、难以说"不"，可能被误判为 4'] },
    so: { name: '雄心', keyword: '有人脉的助人者', isCounter: false, traits: ['更"智慧"地施展魅力，吸引人脉与群体', '常任核心社会领导，喜欢"知情"', '以能力影响力服人，可能被误判为 3 或 8'] },
  },
  3: {
    sp: { name: '安全', keyword: '务实的工作狂', isCounter: true, traits: ['不张扬作品/成就，避谈"注重外表"，但极看重被认可', '可靠多产、工作狂', '通过努力换取物质安全'] },
    sx: { name: '魅力', keyword: '关系型成就者', isCounter: false, traits: ['把竞争集中在支持他人上，靠关系定义成功（"我身边的人成功=我成功"）', '渴望最亲近的人的爱', '形象议题强，可能被误判为 2'] },
    so: { name: '声望', keyword: '舞台上的赢家', isCounter: false, traits: ['最能适应组织规范、最渴望影响力', '竞争力强、爱当焦点、自信推销成果', '"看起来成功"极重要，可能走捷径'] },
  },
  4: {
    sp: { name: '顽强', keyword: '坚忍的承受者', isCounter: true, traits: ['学会坚忍承受痛苦、内化情绪', '希望因"坚强不抱怨"被认可', '敏感却与感受脱节，同情并支持其他受苦者'] },
    sx: { name: '竞争', keyword: '直言的需求者', isCounter: false, traits: ['对自己的需求直言不讳，"无耻多于羞耻"', '嫉妒成为个人挑战', '要求被欣赏，易生挫败，可能被误判为 3/8'] },
    so: { name: '戏剧化', keyword: '羞耻的讲述者', isCounter: false, traits: ['情感真实的讲述者，与痛苦相连、向人倾诉换支持', '渴望被真正理解', '好自比自责，嫉妒与羞耻强烈'] },
  },
  5: {
    sp: { name: '城堡', keyword: '设界限的隐者', isCounter: false, traits: ['极度保护个人空间与隐私，设界限', '享受少数密友的相对独居，宁观察不参与', '难卸防、怕失去安全感'] },
    sx: { name: '知己', keyword: '交底的知音', isCounter: true, traits: ['借"能懂我的伴侣"增进理解与参与', '重视联结与信任、乐于分享私人世界', '可能过度依赖、考验伴侣忠诚，古怪的创造力'] },
    so: { name: '图腾', keyword: '理念的守望者', isCounter: false, traits: ['探索本质与意义、向往开明社会', '联结志同道合的专家/群体，但常与日常/情感脱节', '热情分享理念却吝于分享时间空间'] },
  },
  6: {
    sp: { name: '温情', keyword: '结盟求安的忠诚者', isCounter: false, traits: ['焦虑+自保，用牢固联盟换取安全', '真诚热情有爱心，压制愤怒、慎言慎行', '宁稳勿错'] },
    sx: { name: '威慑', keyword: '反恐的强者', isCounter: true, traits: ['大胆自信、令人生畏，可能被误判为 8', '反恐型——"进攻是最好的防守"，迎头面对恐惧', '难接纳自己的怀疑虚弱'] },
    so: { name: '责任', keyword: '为信念扛事者', isCounter: false, traits: ['认同社会理想、为事业/弱者发声', '比其它 6 更"非黑即白"，像 1 号那样一丝不苟守规矩', '理性尽责，可能与自己感受脱节'] },
  },
  7: {
    sp: { name: '网络', keyword: '经营关系的享乐者', isCounter: false, traits: ['出色的社交网络者，聚集亲密支持者，想给每个人最好', '爱美好事物但有自私享乐风险', '善为自己的一切找借口'] },
    sx: { name: '迷恋', keyword: '玫瑰色滤镜的梦想家', isCounter: false, traits: ['梦想家/理想主义者/浪漫主义者，透过玫瑰色滤镜看现实', '相信人与事的美好面', '可能美化现实、讨厌无聊'] },
    so: { name: '牺牲', keyword: '为群体奉献者', isCounter: true, traits: ['抑制暴食特质，可能误判为 2', '慷慨服务欲强、想创造更美好世界，为团体牺牲自我', '过度牺牲会感到被禁锢并好批评他人自私'] },
  },
  8: {
    sp: { name: '满意', keyword: '沉默的支柱', isCounter: false, traits: ['强大直率高效、自信从容，是众人支柱', '追求物质成功，默默耕耘用强而间接的影响力', '需求落空会沮丧不耐、不讲情面'] },
    sx: { name: '拥有', keyword: '最叛逆的 8', isCounter: false, traits: ['挑衅破规则、反传统开拓者', '冲动强、为变革制造扰动，可能像 4', '在核心/领导位用魅力"占有"他人'] },
    so: { name: '团结', keyword: '为他人用权者', isCounter: true, traits: ['用权力为他人的利益服务，牺牲自我要求、像 2 号', '对不公敏感，忠诚保护"自己人"', '铁壁内欢迎亲密盟友的严厉反馈'] },
  },
  9: {
    sp: { name: '食欲', keyword: '自我抚慰的安稳者', isCounter: false, traits: ['借进食/阅读/睡眠等满足身体需求来自我抚慰', '过有节奏的日常生活，平和与独处重要', '被扰乱了会急躁固执'] },
    sx: { name: '融合', keyword: '与对方深度结合者', isCounter: false, traits: ['在亲密关系中与对方深度融合以滋养自我', '独处有挑战，倾向顺从对方喜好、牺牲自我计划', '边界弱'] },
    so: { name: '参与', keyword: '反型的协调者', isCounter: true, traits: ['友好善社交、反而"倾身"充分参与，常任调解/协调者', '把问题放一边、保持快乐以免连累他人，为群体牺牲', '或成工作狂'] },
  },
}

/** 取某型号 × 本能的亚型档案 */
export function subtypeProfile(core: number, subtype: Subtype): SubtypeProfile {
  const byCore = SUBTYPE_PROFILES[core]
  if (!byCore) {
    // §8.15 修复：原实现静默回退 5 号档案，错误数据不易暴露。
    // 现在只把越界 core 归一到合法范围（带显式记录），绝不静默借用别型号的亚型文案。
    const safe = (Number.isFinite(core) ? Math.min(9, Math.max(1, Math.round(core))) : 5)
    console.warn(`[character-maker] subtypeProfile: 非法主型 ${core} → 归一为 ${safe}`)
    return SUBTYPE_PROFILES[safe][subtype] ?? SUBTYPE_PROFILES[safe].sp
  }
  return byCore[subtype] ?? byCore.sp
}

/** 亚型完整标题，如「SX · 知己（反型）」 */
export function subtypeTitle(core: number, subtype: Subtype): string {
  const p = subtypeProfile(core, subtype)
  return `${subtype.toUpperCase()} · ${p.name}${p.isCounter ? '（反型）' : ''}`
}

// ──────────────────────────────────────────────────────────────
// §8.18 新增：九型四大三元组（Triads）知识库
// ──────────────────────────────────────────────────────────────
//
// 资料来源（2026-09 专项检索）：
//  - 智慧中心（Centers of Intelligence）：心(2,3,4)核心情绪羞耻/悲伤、脑(5,6,7)恐惧/焦虑、腹(8,9,1)愤怒。
//  - Hornevian 社交姿态：Karen Horney 神经症类型——顺从(1,2,6)朝人靠近 toward /
//    进攻(3,7,8)对抗 against / 退缩(4,5,9)远离 away。（Riso-Hudson 亦称顺从组为 superego 组）
//  - Harmonic 冲突/失望应对：正面展望(2,7,9) / 能力(1,3,5) / 反应(4,6,8，又名 Emotional Realness 情绪真实组)。
//    ⚠ 旧代码把这套误记为 "Harmony Triads"，按资料正名为 Harmonic Groups。
//  - Harmony Triads 和谐三元组（David Daniels 命名）＝ 客体关系三元组（Belinda Gore）：
//    理想主义者(1,4,7)=挫折型 Frustration / 关系主义者(2,5,8)=拒绝型 Rejection / 实用主义者(3,6,9)=依附型 Attachment。
//  - Tritype（Katherine Fauvre）：心/脑/腹三中心各取一型，共 27 种原型。
// 用法：定三元组比定单型号更快——中心 → Hornevian 姿态 → Harmonic 应对，三组交集锁定唯一型号。

export interface TriadGroup {
  key: string
  zh: string
  en: string
  types: number[]
  desc: string
}
export interface TriadSystem {
  key: string
  zh: string
  en: string
  /** 这套三元组回答什么问题 */
  question: string
  source: string
  groups: TriadGroup[]
}

export const TRIAD_SYSTEMS: TriadSystem[] = [
  {
    key: 'centers', zh: '智慧中心三元组', en: 'Centers of Intelligence',
    question: '人格的核心驱动力来自哪个智慧中心？各中心有一种核心情绪。',
    source: 'Riso-Hudson',
    groups: [
      { key: 'heart', zh: '心中心（情感）', en: 'Heart Center', types: [2, 3, 4], desc: '核心情绪：羞耻/悲伤。行为受情感驱动，重人际联结与自我形象' },
      { key: 'head', zh: '脑中心（思维）', en: 'Head Center', types: [5, 6, 7], desc: '核心情绪：恐惧/焦虑。思考导向，追求安全与确定性' },
      { key: 'body', zh: '腹中心（本能）', en: 'Gut/Body Center', types: [8, 9, 1], desc: '核心情绪：愤怒。行动导向，关乎自我界限与控制' },
    ],
  },
  {
    key: 'hornevian', zh: 'Hornevian 社交姿态三元组', en: 'Hornevian Groups',
    question: '为了满足需要，他如何与人相处？（霍妮神经症类型）',
    source: 'Karen Horney / Riso-Hudson',
    groups: [
      { key: 'compliant', zh: '顺从组', en: 'Compliant (move toward)', types: [1, 2, 6], desc: '朝人靠近：靠顺从、付出、尽责来换取所需（Riso-Hudson 亦称 superego 超我组）' },
      { key: 'assertive', zh: '进攻组', en: 'Assertive (move against)', types: [3, 7, 8], desc: '对抗人：直接改变环境、扩张自我来达成目标' },
      { key: 'withdrawn', zh: '退缩组', en: 'Withdrawn (move away)', types: [4, 5, 9], desc: '远离人：退回内在世界，靠自我满足/麻木来应对' },
    ],
  },
  {
    key: 'harmonic', zh: 'Harmonic 情绪应对三元组', en: 'Harmonic Groups',
    question: '面对失望与冲突时，他的第一反应是什么？',
    source: 'Riso-Hudson',
    groups: [
      { key: 'positive', zh: '正面展望组', en: 'Positive Outlook', types: [2, 7, 9], desc: '尽量保持乐观，回避负面想法与情境，"没事的"式自我安抚' },
      { key: 'competency', zh: '能力组', en: 'Competency', types: [1, 3, 5], desc: '压抑情绪，先客观务实地解决问题——"情绪可以等等"' },
      { key: 'reactive', zh: '反应组', en: 'Reactive / Emotional Realness', types: [4, 6, 8], desc: '需要情绪强度的出口，压力下易情绪化反应，也希望别人有真实情绪回应' },
    ],
  },
  {
    key: 'harmony', zh: 'Harmony 和谐三元组（客体关系）', en: 'Harmony Triads / Object Relations',
    question: '他与世界建立关系的基本模式是什么？（Daniels 命名 = Gore 客体关系命名）',
    source: 'David Daniels / Belinda Gore',
    groups: [
      { key: 'idealist', zh: '理想主义者组（挫折型）', en: 'Idealists / Frustration', types: [1, 4, 7], desc: '按内在理想与标准改造现实，对"现实不够好"易感挫折' },
      { key: 'relationist', zh: '关系主义者组（拒绝型）', en: 'Relationists / Rejection', types: [2, 5, 8], desc: '预设会被拒绝，先给出价值/划清界限来掌控关系的距离' },
      { key: 'pragmatist', zh: '实用主义者组（依附型）', en: 'Pragmatists / Attachment', types: [3, 6, 9], desc: '依附于现有结构与关系，顺应环境求实际可行——九型图中心实三角' },
    ],
  },
]

/** 查某型号在四大三元组中的归属（含所属体系信息） */
export function triadMembership(core: number): { system: TriadSystem; group: TriadGroup }[] {
  const out: { system: TriadSystem; group: TriadGroup }[] = []
  for (const sys of TRIAD_SYSTEMS) {
    const g = sys.groups.find(x => x.types.includes(core))
    if (g) out.push({ system: sys, group: g })
  }
  return out
}

/** 某型号的三元组归属 → 扁平中文标签（角色卡/模型用） */
export function triadLabels(core: number): { center: string; hornevian: string; harmonic: string; harmony: string } {
  const m = triadMembership(core)
  const get = (k: string) => m.find(x => x.system.key === k)?.group.zh ?? ''
  return { center: get('centers'), hornevian: get('hornevian'), harmonic: get('harmonic'), harmony: get('harmony') }
}

/**
 * §8.20：三要素之「缺陷」类型学（FLAW_TYPES）。
 * 缺陷多种多样——这里给一个可选的分类坐标，供 flawSeed 候选与 LLM 详化时对号入座。
 * 每类缺陷都同时指认「它会对别人造成什么代价」，避免只写性格标签。
 */
export const FLAW_TYPES: { key: string; zh: string; cost: string }[] = [
  { key: 'over_rational', zh: '过度理性化', cost: '把人和感受降级成变量，亲近的人觉得被分析而非被爱' },
  { key: 'avoidant', zh: '回避亲密', cost: '需要时靠近、危机时消失，让对方在"渐进→突然撤退"里反复受伤' },
  { key: 'control', zh: '控制欲', cost: '用安排和规则裹住别人，以"为你好"之名吸走他人的自主' },
  { key: 'self_sacrifice', zh: '自我牺牲', cost: '把自己掏空去换认可，最后积怨爆发，还怪对方不领情' },
  { key: 'perfectionism', zh: '完美主义', cost: '对自己也对外人无差别挑剔，让合作与氛围一起紧张' },
  { key: 'cynical_defense', zh: '冷嘲防御', cost: '用玩笑和刻薄提前伤人，把想靠近的人挡在一步之外' },
  { key: 'codependency', zh: '依赖成瘾', cost: '把安全感完全押在一个人身上，对方被迫承担他的人生' },
  { key: 'envy', zh: '嫉妒吞噬', cost: '盯着别人有的，把自己活成对空的比较，也折磨身边的人' },
  { key: 'numb', zh: '麻木怠惰', cost: '用"随便他/都行"消解所有冲突与可能，让重要的人被默默消化' },
  { key: 'hustle', zh: '逞强蛮干', cost: '扛不住也要硬扛，直到崩盘，把信任他的队伍一起拖下水' },
]

/** 按 principal 缺陷关键词，概要归到某个 FLAW_TYPE（找不到返回 undefined） */
export function flawTypeOf(keyword: string): { key: string; zh: string; cost: string } | undefined {
  const kw = String(keyword ?? '')
  return FLAW_TYPES.find(t => kw.includes(t.zh) || kw.includes(t.key))
}

/** 获得 FLAW_TYPES 的中英文对照清单行（character_essentials 提示词用） */
export function flawTypesLine(): string {
  return FLAW_TYPES.map(t => `${t.zh}（${t.cost}）`).join('；')
}

/**
 * §8.20：由「恶习(型号) × 副型(本能)」确定性生成 2-3 个缺陷候选。
 * 只给候选方向 + 一句"会造成什么代价",细节交 LLM 结合经历落地。
 */
export function flawSeed(core: number, subtype: string = 'sp'): { name: string; type: string; cost: string }[] {
  const viceOf: Record<number, string> = {
    1: '完美主义', 2: '自我牺牲/隐形索取', 3: '逞强与虚荣', 4: '嫉妒与自怜',
    5: '过度理性化/囤积自我保护', 6: '过度警觉与控制', 7: '逃避痛苦与沉溺',
    8: '控制欲与拒绝示弱', 9: '麻木怠惰与自我遗忘',
  }
  const vice = viceOf[core] ?? '性格惯性'
  const subNote: Record<string, string[]> = {
    sp: ['把自己的不安捂得很紧，对人只肯给八分'],
    sx: ['越在意的人越要试探，用"逼近＋考验"把对方推开又拉住'],
    so: ['太在意角色与场所，为显得得体而牺牲真实'],
  }
  const sub = subNote[subtype] ?? subNote.sp
  const seed: { name: string; type: string; cost: string }[] = [
    { name: vice, type: '', cost: '它是型号的恶习具象，会在他最紧绷时冒头伤到最近的人' },
  ]
  const typeMap: Record<number, string> = {
    1: 'perfectionism', 2: 'self_sacrifice', 3: 'hustle', 4: 'envy', 5: 'over_rational',
    6: 'control', 7: 'avoidant', 8: 'control', 9: 'numb',
  }
  const type = typeMap[core] ?? ''
  seed[0].type = type
  const t = flawTypeOf(vice)
  if (t) seed[0].cost = t.cost
  seed.push({ name: `${sub[0]}`, type: '', cost: `副型${subtype.toUpperCase()}放大：${sub[0]}，是最容易让关系裂开的地方` })
  return seed.slice(0, 2)
}

/** 取某型号在指定三元组体系里的分组（找不到返回 undefined） */
export function triadGroupOf(core: number, systemKey: string): TriadGroup | undefined {
  return TRIAD_SYSTEMS.find(s => s.key === systemKey)?.groups.find(g => g.types.includes(core))
}

/**
 * §8.19：三元组 → LLM 详析提示词素材（单行，含每组含义与写作落点）。
 * 供角色详析（profile / trait_writer）、声音五件套、关系深析的【人格档案】段直接拼入。
 */
export function triadFactsLine(core: number): string {
  const shortKey: Record<string, string> = { centers: '智慧中心', hornevian: '社交姿态', harmonic: '冲突应对', harmony: '客体关系' }
  const parts = triadMembership(core).map(({ system, group }) =>
    `${shortKey[system.key] ?? system.zh}=${group.zh}（${group.desc}）`)
  return `三元组四套归属：${parts.join('｜')}`
}

/**
 * §8.19：三元组 → 角色详析的写作钩子（每个体系一条，说明该落到哪个维度上写）。
 * 由 triadFactsLine 的纯描述升级为「怎么用」，供提示词末尾附上。
 */
export function triadWritingHooks(core: number): string[] {
  const hooks: string[] = []
  const c = triadGroupOf(core, 'centers')
  const h = triadGroupOf(core, 'hornevian')
  const hm = triadGroupOf(core, 'harmonic')
  const hy = triadGroupOf(core, 'harmony')
  if (c) hooks.push(`智慧中心（${c.zh}）：核心情绪是他的决策底色——把它写进「思维模式」与压力反应的成因，而不是贴标签。`)
  if (hm) hooks.push(`冲突应对（${hm.zh}）：这是他与他人起摩擦时的第一反应，写进「行动模式」与情绪雷区；与不同组的角色对戏时，这里最容易出戏剧张力。`)
  if (h) hooks.push(`社交姿态（${h.zh}）：这是他索取所需时的默认站位，决定他在群体里的位置感与台词气口。`)
  if (hy) hooks.push(`客体关系（${hy.zh}）：这是他建立亲密关系的基本模式，是情感线的底层逻辑——写他与重要之人的距离如何拉扯。`)
  return hooks
}

/**
 * §8.14 修复：健康层级从「3 档粗分」升级为 Riso-Hudson 9 级细分表。
 * levelBand() 保留（3 档，向后兼容），levelInfo() 提供 9 级名称与描述。
 * 级名依 Riso-Hudson《Personality Types》九级健康层级通用命名。
 */
export const LEVEL_TABLE: Record<number, LevelInfo> = {
  1: { level: 1, band: '健康', name: '自我实现', desc: '完全活出善德，从容、自由、有创造力，不再被核心恐惧驱动' },
  2: { level: 2, band: '健康', name: '心理能力', desc: '内在平衡，能自然地给出该型号最好的品质，关系与产出都顺畅' },
  3: { level: 3, band: '健康', name: '社会价值', desc: '把善德转化为可被社会认可的能力与角色，是他人愿意依靠的对象' },
  4: { level: 4, band: '一般', name: '不平衡', desc: '开始以「角色/形象」代替真实自我，用该型号的惯用策略换取安全感' },
  5: { level: 5, band: '一般', name: '人际控制', desc: '策略固化，靠操控人际或环境维持自我价值感，内心已感疲惫' },
  6: { level: 6, band: '一般', name: '过度补偿', desc: '恐惧上浮，开始用更强烈、更夸张的手段压住焦虑，行为明显失衡' },
  7: { level: 7, band: '病态', name: '侵犯行为', desc: '以伤害他人/自己为代价换取掌控，关系开始崩塌' },
  8: { level: 8, band: '病态', name: '强迫与妄想', desc: '认知扭曲，被核心恐惧吞没，强迫式重复破坏性行为' },
  9: { level: 9, band: '病态', name: '病态破坏', desc: '彻底被恶习劫持，自我毁灭并拖垮周围，几乎失去人格弹性' },
}

/** 健康层级 → 9 级细分信息 */
export function levelInfo(level: number): LevelInfo {
  const l = Math.min(9, Math.max(1, Math.round(level)))
  return LEVEL_TABLE[l]
}

/** 健康层级 → 档位 */
export function levelBand(level: number): string {
  if (level <= 2) return '健康'
  if (level <= 5) return '一般'
  return '病态'
}

// ──────────────────────────────────────────────────────────────
// §8.22 人格变化 / 动态（Personality Change Dynamics）
// ──────────────────────────────────────────────────────────────
//
// 九型里"人格变化"不是换型号，而是沿几条轴线移动：
// ① 整合(Integration)箭头：健康/成长时借来整合目标的健康特质；
// ② 解离/压力(Stress)箭头：高压/失衡时"出走"到压力号的失衡样子（同时那号是能借用的资源）；
// ③ 健康层级(Levels)：沿 9 级升降，越失衡越"更像本型＋更糟"，越健康越"整合邻型"；
// ④ 翼型摆动(Wing swing)：主导翼↔潜在翼可互换、或趋向双翼均衡，被人生转折/成长触发。
// 整合方向 = stressArrow 反向；这里箭头方向按 Riso-Hudson 经典：成长 1→7、压力 1→4 等。

export interface Dyadic {
  /** 箭头去往的健康/失衡侧写 */
  look: string
  /** 在那号待太久的潜在盲点 */
  to?: string
}
export interface TypeDynamics {
  integration: Dyadic & { /** 在整合目标待太久的盲点 */ risk: string }
  stress: { look: string; /** 把压力号当工具能拿到的资源 */ resource: string }
  /** 翼型摆动说明（主导翼↔潜在翼、双翼均衡、受压/成长时的摆向） */
  wingSwing: string
}
/** 某型号的人格变化动态知识（型号名由 ENNEAGRAM_PROFILES[箭头] 派生） */
export const TYPE_DYNAMICS: Record<number, TypeDynamics> = {
  1: {
    integration: { look: '从对错的苛责里松手，允许自己犯错、放松、享受当下，带着原则去玩乐', risk: '在 7 号待久→躲进享乐与杂念，逃避该担的责任，把"松弛"用成放纵' },
    stress: { look: '从挑剔外冲变成自我怀疑与情绪化：钻进"我不够好"的自怜，像 4 号一样忧郁、易受伤', resource: '像 4 号诚实看见自己的情绪与独特，不再要求自己永远正确' },
    wingSwing: '1w2 温和倡言、1w9 孤直和事；受压越固化时越孤立清高，成长时容纳更多情绪与弹性',
  },
  2: {
    integration: { look: '从讨好里认出自己的需求，接受被爱不必靠付出交换，敢做真实的自己', risk: '在 4 号待久→过度内省、怨自己不被需要，黏着情绪走不出' },
    stress: { look: '付出碰壁后翻脸强势：理直气壮、控制、占有，像 8 号一样拒绝示弱', resource: '像 8 号敢于主张自己、勇于说"不"，把消耗性的迎合放下' },
    wingSwing: '2w1 服从的仆人、2w3 魅力的主人；受压时 2w1 更刻板冷漠、2w3 更表演求认可',
  },
  3: {
    integration: { look: '从形象演出里落到踏实信任，敢面对不确定与失败，做真实的自己', risk: '在 6 号待久→多疑、患得患失，把沉稳变成偏执的计划' },
    stress: { look: '透支后怠惰抽离、随波逐流，像 9 号一样"算了，都一样，别期待"', resource: '像 9 号允许自己停下、不必表演成就，与内心失联处放松' },
    wingSwing: '3w2 魅力者、3w4 专业者；受压时 3w2 更在意他人眼光、3w4 更苛刻完美',
  },
  4: {
    integration: { look: '从自怜与嫉妒里升华成有原则、有章法的创造，把情绪化作具体的作品', risk: '在 1 号待久→苛责他人也苛责自己、控制、不耐烦' },
    stress: { look: '情绪失控时掉头讨好求认同、黏着他人，像 2 号一样渴望"被需要"', resource: '像 2 号伸手联结他人，不再把自己困在独一无二的孤岛' },
    wingSwing: '4w3 贵族（自我打磨）、4w5 波希米亚（疏离）；受压时 4w3 更争魅、4w5 更抽离冷僻',
  },
  5: {
    integration: { look: '走出象牙塔，用能力直接行动与守护，敢把知识用于世界', risk: '在 8 号待久→强硬、控制，把保护变成逼迫' },
    stress: { look: '怕被耗尽→逃入知识与刺激：多线开工、语速变快、讲冷笑话、暴食信息，像 7 号一样逃开', resource: '像 7 号允许自己松手、享乐、碰新鲜，打破过度蓄力的孤立' },
    wingSwing: '5w4 反传统者、5w6 问题解决者；受压时 5w4 更疏离艺术化、5w6 更焦虑多疑',
  },
  6: {
    integration: { look: '放下戒备与预演，真正信任，回到内在的平静', risk: '在 9 号待久→麻木失焦，把安定变成自我遗忘' },
    stress: { look: '焦虑外冲→逞强、夸耀、拼命表现压住不安，像 3 号一样求认可', resource: '像 3 号用行动与成果稳住自己，把怀疑变成推进' },
    wingSwing: '6w5 忠诚守卫、6w7 伙伴；受压时 6w5 更怀疑孤立、6w7 更外放讨好',
  },
  7: {
    integration: { look: '从纵乐与逃避里沉静下来，深入一项课题而非四处逃开', risk: '在 5 号待久→过度抽离、囤积信息代替体验' },
    stress: { look: '享乐受阻→变得挑剔、苛责、僵化、琐碎地控制，像 1 号一样冷脸', resource: '像 1 号借到秩序与责任，把"我知道的是真的"落到实处' },
    wingSwing: '7w6 表演者、7w8 现实主义者；受压时 7w6 更焦虑共谋、7w8 更强势独断',
  },
  8: {
    integration: { look: '从控制里学会示弱与关怀，用力量守护而不是压制', risk: '在 2 号待久→过度讨好、边界模糊，把付出变成绑架' },
    stress: { look: '压力→孤立与自我怀疑，斩断联结独守阵地，像 5 号一样退进壳里', resource: '像 5 号冷静观察、稳住不崩，把硬扛换成分清主次' },
    wingSwing: '8w7 独行侠、8w9 熊；受压时 8w7 更冲动任性、8w9 更固执压抑',
  },
  9: {
    integration: { look: '从怠惰与自我遗忘里确立自我、主动行动，为重要的事站出来', risk: '在 3 号待久→过度自我鞭策、追名逐利忘掉初衷' },
    stress: { look: '麻木→涌起焦虑，反复寻求外部指引与安慰，像 6 号一样不安依附', resource: '像 6 号警觉与求助，打破"都行、没关系"的自我麻痹' },
    wingSwing: '9w8 调解的熊、9w1 梦想家；受压时 9w8 更固执、9w1 更挑剔',
  },
}

export interface CharacterDynamics {
  integration: { to: number; toName: string; look: string; risk: string }
  stress: { to: number; toName: string; look: string; resource: string }
  wingSwing: string
  level: { level: number; band: string }
  text: string
}

/** §8.22：派生某角色/某型号的人格变化动态块（箭头型号名由档案派生，翼与层级并入） */
export function characterDynamics(core: number, wing?: string, level = 4): CharacterDynamics {
  const d = TYPE_DYNAMICS[core] ?? TYPE_DYNAMICS[5]
  const g = ENNEAGRAM_PROFILES[d ? core : 5]
  const integ = ENNEAGRAM_PROFILES[g.growthArrow]
  const stress = ENNEAGRAM_PROFILES[g.stressArrow]
  const lv = levelInfo(level)
  const wingLabel = wing ? `（${wing} ${WING_NICK[wing] ?? ''}）` : ''
  const lines = [
    `整合方向 → ${g.growthArrow}号【${integ.zh}】：${d.integration.look}。待久风险：${d.integration.risk}`,
    `压力/解离 → ${g.stressArrow}号【${stress.zh}】：${d.stress.look}。把压力号当工具能用到：${d.stress.resource}`,
    `健康层级：${level}级（${lv.band}档·${lv.name}）——健康端借整合特质、失衡端更"本型且更糟"再到借压力号`, `翼型摆动${wingLabel}：${d.wingSwing}`,
  ]
  return {
    integration: { to: g.growthArrow, toName: integ.zh, look: d.integration.look, risk: d.integration.risk },
    stress: { to: g.stressArrow, toName: stress.zh, look: d.stress.look, resource: d.stress.resource },
    wingSwing: d.wingSwing,
    level: { level, band: lv.band },
    text: lines.join('\n'),
  }
}

// ──────────────────────────────────────────────────────────────
// 题库结构与计分
// ──────────────────────────────────────────────────────────────

export interface NFQuestion { n: number; question: string; type: number }
export interface ForcedChoiceOption { text: string; type?: number; represents?: number | string; value?: string }
export interface ForcedChoiceQuestion { n: number; question: string; choice_a: ForcedChoiceOption; choice_b: ForcedChoiceOption }
export interface MultifactorItem {
  no: number; section: 'type' | 'instinct';
  stem_zh: string;
  option_a: { text_zh: string; represents: number | string };
  option_b: { text_zh: string; represents: number | string };
}
export interface BigFiveItem { n: number; item: string; dimension: string; facet: string; reverse_keyed: boolean }

/** IPIP-NEO-120 题（中文题面，含 5 大域 + 6 facet，keyed 正/反向） */
export interface IpipItem {
  id: string
  text: string
  text_en?: string
  keyed: 'plus' | 'minus'
  domain: string
  domainZh?: string
  domainEn?: string
  facet: number
  facetZh?: string
}

/** 通用 Likert 维度题（维度维度计分：HEXACO/SD3/依赖/控制点/道德/价值观 共用结构） */
export interface LikertDim { id: string; label: string; description?: string }
export interface LikertItem { position: number; text: string; dimension: string; reverseKeyed?: boolean }
export interface LikertBank {
  id: string
  name: string
  scaleMin: number
  scaleMax: number
  dimensions: LikertDim[]
  items: LikertItem[]
  /** 自定义维度中文名映射（缺省用 dimensions.label） */
  dimLabelZh?: Record<string, string>
}

export interface QuestionBank {
  enneagram108: NFQuestion[]
  enneagram144: ForcedChoiceQuestion[]
  multifactor: MultifactorItem[]
  mbti: ForcedChoiceQuestion[]
  bfi: BigFiveItem[]
  mbti16?: any[]
  ipip?: IpipItem[]
  enneagram90?: LikertBank
  hexaco24?: LikertBank
  sd3?: LikertBank
  ecr12?: LikertBank
  locus24?: LikertBank
  mfq30?: LikertBank
  pvq21?: LikertBank
  disc32?: LikertBank
  eq22?: LikertBank
}

/** 108 题（是/否）九型计分 */
export function scoreEnneagram108(bank: QuestionBank, ans: Record<number, any>): { type: number; score: number }[] {
  const scores: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0 }
  for (const q of bank.enneagram108) {
    const v = ans[q.n]
    if (v === true || v === 'yes' || v === '是' || v === 1) scores[q.type] += 1
  }
  return Object.entries(scores).map(([type, score]) => ({ type: Number(type), score }))
}

/** 144 题（二选一迫选）九型计分 */
export function scoreEnneagram144(bank: QuestionBank, ans: Record<number, any>): { type: number; score: number }[] {
  const scores: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0 }
  for (const q of bank.enneagram144) {
    const v = ans[q.n]
    const opt = (v === 'a' || v === 'A') ? q.choice_a : (v === 'b' || v === 'B') ? q.choice_b : null
    if (opt && typeof opt.type === 'number') scores[opt.type] += 1
  }
  return Object.entries(scores).map(([type, score]) => ({ type: Number(type), score }))
}

/**
 * 由 9 型得分推导 主型 + 侧翼（108 / 144 / 90 / multifactor 共用，§8.6 修复）。
 * - 主型 = 最高分；平分时偏向**小编号**型号（稳定排序，规则显式化）。
 * - 侧翼 = 相邻两型中分更高者；相邻型均为 0 分时 wing = core（表示未能判定翼）。
 * - `tie` 标记主型平分，供上层提示"结果接近、建议加测"。
 */
export function deriveCoreWing(scores: { type: number; score: number }[]) {
  const sorted = scores.slice().sort((a, b) => (b.score - a.score) || (a.type - b.type))
  const core = sorted[0]?.type ?? 5
  const cands = adjacentWings(core)
  const neighbors = cands
    .map(c => sorted.find(x => x.type === c))
    .filter((x): x is { type: number; score: number } => Boolean(x))
    .sort((a, b) => (b.score - a.score) || (a.type - b.type))
  const wing = neighbors[0] && neighbors[0].score > 0 ? neighbors[0].type : core
  const tie = sorted.length > 1 && sorted[0].score === sorted[1].score && sorted[0].score > 0
  return { core, wing, ranking: sorted, tie }
}

/** 深度多功能问卷（39 题：36 类型 + 3 本能） */
export function scoreMultifactor(bank: QuestionBank, ans: Record<number, any>) {
  type StrScores = Record<string, number>
  const types: StrScores = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0, '6': 0, '7': 0, '8': 0, '9': 0 }
  const instincts: StrScores = { sp: 0, sx: 0, so: 0 }
  for (const it of bank.multifactor) {
    const v = ans[it.no]
    const opt = v === 'a' ? it.option_a : v === 'b' ? it.option_b : null
    if (!opt) continue
    const rep = String(opt.represents)
    if (it.section === 'type' && types[rep] !== undefined) types[rep] += 1
    if (it.section === 'instinct' && instincts[rep] !== undefined) instincts[rep] += 1
  }
  const typeScores = Object.entries(types).map(([t, s]) => ({ type: Number(t), score: s }))
  const { core, wing, tie } = deriveCoreWing(typeScores)
  const sorted = typeScores.slice().sort((a, b) => (b.score - a.score) || (a.type - b.type))
  const wingKey = wing === core ? `${core}w${adjacentWings(core)[1]}` : `${core}w${wing}`
  const stackFull = Object.entries(instincts).sort((a, b) => b[1] - a[1]).map(([k]) => k) as Subtype[]
  const stackAbbr = stackFull.slice(0, 2).join('/')
  const bodyA = [8, 9, 1], heartA = [2, 3, 4], headA = [5, 6, 7]
  const tritype = [bodyA, heartA, headA]
    .map(grp => grp.reduce((m, t) => (types[String(t)] > types[String(m)] ? t : m), grp[0]))
    .join('')
  const avg = (arr: number[]) => arr.reduce((s, t) => s + (types[String(t)] ?? 0), 0) / arr.length
  const centers = { body: avg(bodyA), heart: avg(heartA), head: avg(headA) }
  // §8.5 修复：题库 result_functions 文档化了但此前未实现的派生指标，现全部补上。
  // §8.18 正名（按 2026-09 三元组资料）：旧键保留向后兼容，新增正名结构 + 中文标签。
  // 情绪应对三元组 = Harmonic Groups（旧误名 "Harmony Triads"）
  const harmonicGroups = { reactive: avg([4, 6, 8]), positive: avg([2, 7, 9]), competency: avg([1, 3, 5]) }
  // 客体关系（Object Relations / 依恋-挫败-拒绝）= David Daniels 的 Harmony Triads 和谐三元组
  const objectRelations = { attachment: avg([3, 6, 9]), frustration: avg([1, 4, 7]), rejection: avg([2, 5, 8]) }
  // 和谐三元组 Daniels 命名（与 objectRelations 同一组数字，两种命名并存）
  const harmonyDaniels = {
    idealist: objectRelations.frustration,      // 理想主义者组 = 挫折型
    relationist: objectRelations.rejection,     // 关系主义者组 = 拒绝型
    pragmatist: objectRelations.attachment,     // 实用主义者组 = 依附型
  }
  // 霍尼维安（Hornevian / 顺从-进攻-退缩；compliant 即 Riso-Hudson 所称 superego 组）
  const hornevian = { superego: avg([1, 2, 6]), assertive: avg([3, 7, 8]), withdrawn: avg([4, 5, 9]) }
  const hornevianGroups = { compliant: hornevian.superego, assertive: hornevian.assertive, withdrawn: hornevian.withdrawn }
  // 明暗六角（Light / Dark Hexad）
  const lightDark = { light: avg([1, 2, 7]), dark: avg([4, 5, 8]) }
  /** 取某组三元指标的主导项名 */
  const dominant = (g: Record<string, number>) => Object.entries(g).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
  // 各组 key → 中文标签（展示层直接用，避免再查表）
  const triadLabelsZh: Record<string, string> = {
    body: '腹中心（本能·愤怒）', heart: '心中心（情感·羞耻）', head: '脑中心（思维·恐惧）',
    reactive: '反应组（情绪真实）', positive: '正面展望组', competency: '能力组',
    attachment: '实用主义者组（依附型）', frustration: '理想主义者组（挫折型）', rejection: '关系主义者组（拒绝型）',
    idealist: '理想主义者组（挫折型）', relationist: '关系主义者组（拒绝型）', pragmatist: '实用主义者组（依附型）',
    compliant: '顺从组（朝人靠近）', superego: '顺从组（超我）', assertive: '进攻组（对抗）', withdrawn: '退缩组（远离）',
    light: '光明六角', dark: '黑暗六角',
  }
  const dom = {
    center: dominant(centers),
    harmonic: dominant(harmonicGroups),
    harmony: dominant(harmonyDaniels),
    objectRelation: dominant(objectRelations),
    hornevian: dominant(hornevianGroups),
    lightDark: dominant(lightDark),
  }
  const dominantZh: Record<string, string> = Object.fromEntries(
    Object.entries(dom).map(([k, v]) => [k, triadLabelsZh[v] ?? v]),
  )
  return {
    core, wing, wingKey, typeScores: sorted, instincts, stack: stackAbbr, stackFull, tritype, centers, tie,
    types,
    // 旧字段（向后兼容，勿删：selftest 与历史 quizResult 引用）
    harmonyTriads: harmonicGroups, objectRelations, hornevian, lightDark,
    // §8.18 正名后的结构与标签
    harmonicGroups, harmonyDaniels, hornevianGroups, triadLabelsZh,
    dominant: dom,
    dominantZh,
  }
}

/** MBTI 四轴归属 */
export const MBTI_AXIS_OF: Record<string, 'EI' | 'SN' | 'TF' | 'JP'> = {
  E: 'EI', I: 'EI', S: 'SN', N: 'SN', T: 'TF', F: 'TF', J: 'JP', P: 'JP',
}

/**
 * §8.4 修复：找出 MBTI 题库中的「跨轴题」。
 * mbti-93 第 75 题（"你宁愿替哪一类上司工作"）是 T vs N——两个选项分属不同轴，
 * 计分时无论怎么答都会同时污染 TF 与 SN 两个计数。此函数把这类题识别出来供计分跳过。
 */
export function mbtiCrossAxisItems(bank: QuestionBank): number[] {
  const out: number[] = []
  for (let i = 0; i < bank.mbti.length; i++) {
    const q = bank.mbti[i]
    const a = q.choice_a?.value
    const b = q.choice_b?.value
    if (!a || !b) continue
    const ax = MBTI_AXIS_OF[a], bx = MBTI_AXIS_OF[b]
    if (!ax || !bx || ax !== bx) out.push(q.n ?? (i + 1))
  }
  return out
}

/**
 * MBTI-93（二选一）计分：统计 E/I S/N T/F J/P（题库无 n 字段，按题序 1..93 索引作答）。
 * - **跨轴题自动跳过**（§8.4，见 mbtiCrossAxisItems），并在 `skipped` 中返回题号。
 * - 平局规则（显式化）：`counts[a] >= counts[b] ? a : b` → **平局偏向 E / S / T / J**（外向、实感、思考、判断）。
 */
export function scoreMbti(bank: QuestionBank, ans: Record<number, any>) {
  const counts: Record<string, number> = { E: 0, I: 0, S: 0, N: 0, T: 0, F: 0, J: 0, P: 0 }
  const crossAxis = new Set(mbtiCrossAxisItems(bank))
  const skipped: number[] = []
  const answered: number[] = []
  for (let i = 0; i < bank.mbti.length; i++) {
    const q = bank.mbti[i]
    const no = q.n ?? (i + 1) // 优先用题号，否则题序
    const v = ans[no]
    const opt = v === 'a' ? q.choice_a : v === 'b' ? q.choice_b : null
    if (!opt || typeof opt.value !== 'string') continue
    if (crossAxis.has(no)) { skipped.push(no); continue }
    counts[opt.value] = (counts[opt.value] || 0) + 1
    answered.push(no)
  }
  const pick = (a: string, b: string) => (counts[a] >= counts[b] ? a : b)
  const code = pick('E', 'I') + pick('S', 'N') + pick('T', 'F') + pick('J', 'P')
  const ties = [['E', 'I'], ['S', 'N'], ['T', 'F'], ['J', 'P']]
    .filter(([a, b]) => counts[a] === counts[b])
    .map(([a, b]) => `${a}/${b}`)
  return { code, counts, skipped, answered, ties, crossAxis: [...crossAxis] }
}

const BFI_DIM_MAP: Record<string, string> = {
  '外向性': 'Extraversion', '宜人性': 'Agreeableness', '尽责性': 'Conscientiousness', '神经质': 'Neuroticism', '开放性': 'Openness',
}

/** BFI-2 大五（60 题，1-5 点）计分 → 0-100 */
export function scoreBigfive(bank: QuestionBank, ans: Record<number, any>): BigFiveScores & { raw: Record<string, number> } {
  const sum: Record<string, number> = { Extraversion: 0, Agreeableness: 0, Conscientiousness: 0, Neuroticism: 0, Openness: 0 }
  const cnt: Record<string, number> = { Extraversion: 0, Agreeableness: 0, Conscientiousness: 0, Neuroticism: 0, Openness: 0 }
  for (const it of bank.bfi) {
    const v = Number(ans[it.n])
    if (![1, 2, 3, 4, 5].includes(v)) continue
    const d = BFI_DIM_MAP[it.dimension]
    if (!d) continue
    const val = it.reverse_keyed ? 6 - v : v
    sum[d] += val
    cnt[d] += 1
  }
  const out: any = { raw: {} }
  for (const [zh, en] of Object.entries(BFI_DIM_MAP)) {
    if (cnt[en] > 0) {
      const raw = sum[en] / cnt[en]
      out[en] = Math.round(((raw - 1) / 4) * 100)
      out.raw[en] = Math.round(raw * 100) / 100
    }
  }
  return out
}

/** IPIP 域英文 → 中文（须与题库 domain 字段一致） */
const IPIP_DOMAIN_ZH: Record<string, string> = {
  N: '神经质', E: '外向性', O: '开放性', A: '宜人性', C: '尽责性',
  Neuroticism: '神经质', Extraversion: '外向性', Openness: '开放性', Agreeableness: '宜人性', Conscientiousness: '尽责性',
}

/**
 * IPIP-NEO-120（大五进阶，120 题，5 域 × 6 facet = 30 子维度）计分。
 * 5 点同意观点作答（1-5）；keyed=plus 直接分，minus 反向（6-v）。
 * 每域 24 题 = 6 facet × 4 题；返回 5 大域 0-100 分 + 30 子维度（facet）0-100 原始分。
 */
export function scoreIpipNeo120(bank: QuestionBank, ans: Record<number | string, any>) {
  const domainSum: Record<string, number> = {}
  const domainCnt: Record<string, number> = {}
  const facetSum: Record<string, number> = {}
  const facetCnt: Record<string, number> = {}
  const items = bank.ipip ?? []
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    const v = Number(ans[it.id] ?? ans[i + 1]) // 支持按 id 或按题序作答
    if (![1, 2, 3, 4, 5].includes(v)) continue
    const val = it.keyed === 'minus' ? 6 - v : v
    const d = it.domain.trim().toUpperCase()
    domainSum[d] = (domainSum[d] ?? 0) + val
    domainCnt[d] = (domainCnt[d] ?? 0) + 1
    const fk = `${d}.f${it.facet}`
    facetSum[fk] = (facetSum[fk] ?? 0) + val
    facetCnt[fk] = (facetCnt[fk] ?? 0) + 1
  }

  const big: Record<string, any> = {}
  const facets: Record<string, any> = {}
  for (const [d, en] of Object.entries({ N: 'Neuroticism', E: 'Extraversion', O: 'Openness', A: 'Agreeableness', C: 'Conscientiousness' })) {
    if (domainCnt[d] > 0) {
      const raw = domainSum[d] / domainCnt[d] // 1-5
      big[en] = Math.round(((raw - 1) / 4) * 100) // 0-100
    }
    for (let f = 1; f <= 6; f++) {
      const fk = `${d}.f${f}`
      if (facetCnt[fk] > 0) {
        const raw = facetSum[fk] / facetCnt[fk]
        facets[fk] = Math.round(((raw - 1) / 4) * 100)
      }
    }
  }

  // 30 子维度名（英文 key → 中文），用于卡片解读
  const FACET_EN: Record<string, string> = {
    'N.f1': '焦虑', 'N.f2': '愤怒', 'N.f3': '抑郁', 'N.f4': '自我意识', 'N.f5': '冲动', 'N.f6': '脆弱',
    'E.f1': '友善', 'E.f2': '合群', 'E.f3': '支配', 'E.f4': '活力', 'E.f5': '冒险寻求', 'E.f6': '开朗',
    'O.f1': '想象', 'O.f2': '审美', 'O.f3': '情感', 'O.f4': '冒险', 'O.f5': '智慧', 'O.f6': '自由主义',
    'A.f1': '信任', 'A.f2': '道德', 'A.f3': '利他', 'A.f4': '协作', 'A.f5': '谦虚', 'A.f6': '同理',
    'C.f1': '自我效能', 'C.f2': '条理', 'C.f3': '尽责', 'C.f4': '成就感', 'C.f5': '自律', 'C.f6': '审慎',
  }
  const facetLabel: Record<string, string> = {}
  for (const k of Object.keys(facets)) {
    const en = FACET_EN[k] ?? k
    const [d] = k.split('.')
    facetLabel[k] = `${IPIP_DOMAIN_ZH[d] ?? d}·${en}`
  }

  return { big, facets, facetLabel, domainZh: IPIP_DOMAIN_ZH }
}

/**
 * 通用 Likert 维度计分器（HEXACO-24 / SD3 / ECR-12 / 控制点 / MFQ-30 / PVQ-21 等共用）。
 * 每个 item 属于某 dimension；Likert scale 内作答（数字或字符串）。reverseKeyed 反转为 (max+1)-v。
 * 每维度计均分后换算到 0-100。作答键：按 position 或 item.text。
 */
/**
 * 通用 Likert 维度计分器（HEXACO-24 / SD3 / ECR-12 / 控制点 / MFQ-30 / PVQ-21 / DISC-32 / EQ-22 共用）。
 * 每个 item 属于某 dimension；Likert scale 内作答（数字或数字字符串）。
 * reverseKeyed 反转为 (max+min)-v。
 * 每维度计均分后换算到 0-100。
 *
 * §8.8 修复：作答键回退链收敛为「题号（数字键或字符串键）」两条——
 * 原实现里 `ans[it.text]`（按题干文本作键）分支既不可靠又会在数字判断中产生无效分支，已移除。
 * 同时返回 missing / answered，供上层做完整性校验并存储。
 */
export function scoreLikertBank(
  bank: LikertBank,
  ans: Record<string | number, any>,
  dimLabelZh?: Record<string, string>,
) {
  const lo = bank.scaleMin
  const hi = bank.scaleMax
  const sum: Record<string, number> = {}
  const cnt: Record<string, number> = {}
  const missing: number[] = []
  const answered: number[] = []
  for (const it of bank.items) {
    const raw = ans[it.position] ?? ans[String(it.position)]
    let v = Number(raw)
    if (raw === undefined || raw === null || raw === '' || !Number.isFinite(v) || v < lo || v > hi) {
      missing.push(it.position)
      continue
    }
    if (it.reverseKeyed) v = (hi + lo) - v
    sum[it.dimension] = (sum[it.dimension] ?? 0) + v
    cnt[it.dimension] = (cnt[it.dimension] ?? 0) + 1
    answered.push(it.position)
  }
  // 每维度均分 → 0-100
  const scores: Record<string, number> = {}
  const rawScores: Record<string, number> = {}
  for (const d of bank.dimensions) {
    if (cnt[d.id] > 0) {
      const raw = sum[d.id] / cnt[d.id]
      rawScores[d.id] = Math.round(raw * 100) / 100
      scores[d.id] = Math.round(((raw - lo) / (hi - lo)) * 100)
    }
  }
  const label = (id: string): string => dimLabelZh?.[id] ?? bank.dimensions.find(d => d.id === id)?.label ?? id
  const dimLabels: Record<string, string> = {}
  for (const d of bank.dimensions) dimLabels[d.id] = label(d.id)
  return { scores, rawScores, dimLabels, missing, answered }
}

/** Enneagram-90：主型 = 9 型得分最高 + 次高翼（§8.6 统一走 deriveCoreWing） */
export function enneagram90Type(scores: Record<string, number>) {
  // scores 的 key 是 ennea_1..ennea_9
  const list = Object.entries(scores)
    .map(([k, v]) => ({ type: Number(k.replace(/^ennea_/, '')), score: v }))
    .filter(x => Number.isFinite(x.type))
  const { core, wing, ranking, tie } = deriveCoreWing(list)
  return { core, wing, ranking, tie }
}

// ──────────────────────────────────────────────────────────────
// 角色模型组装
// ──────────────────────────────────────────────────────────────

export interface BuildInput {
  name: string
  role?: CharacterRole
  appearance?: string
  background?: string
  goal?: string
  stateNotes?: string
  enneagram?: { core?: number; wing?: number | string; subtype?: Subtype; level?: number }
  mbti?: string
  bigfive?: BigFiveScores
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function adjacentWings(core: number): number[] {
  return core === 1 ? [9, 2] : core === 9 ? [8, 1] : [core - 1, core + 1]
}

/** 组装一个完整角色模型（基于九型档案补全所有派生字段） */
export function buildCharacterModel(input: BuildInput): CharacterModel {
  const coreNum = clamp(input.enneagram?.core ?? 5, 1, 9) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
  const prof = ENNEAGRAM_PROFILES[coreNum]

  // 侧翼解析
  const wings = adjacentWings(coreNum)
  let wingKey: string | undefined
  const wingRaw = input.enneagram?.wing
  if (typeof wingRaw === 'number' && wings.includes(wingRaw)) wingKey = `${coreNum}w${wingRaw}`
  else if (typeof wingRaw === 'string' && /^\d+w\d+$/i.test(wingRaw)) {
    const c = Number(wingRaw[0]), w = Number(wingRaw[2])
    if (c === coreNum && wings.includes(w)) wingKey = wingRaw.toLowerCase()
  }
  if (!wingKey) wingKey = `${coreNum}w${wings[1]}` // 默认取升向翼

  const subtype = input.enneagram?.subtype ?? 'sp'
  const level = clamp(input.enneagram?.level ?? 4, 1, 9)
  const st = subtypeProfile(coreNum, subtype)
  const enneagram: EnneagramModel = {
    core: coreNum,
    coreName: prof.zh,
    coreEn: prof.en,
    center: prof.center,
    fear: prof.fear,
    desire: prof.desire,
    traits: prof.traits,
    virtue: prof.virtue,
    vice: prof.vice,
    stressArrow: prof.stressArrow,
    growthArrow: prof.growthArrow,
    wing: wingKey,
    wingNick: WING_NICK[wingKey] ?? `翼${wingKey.slice(2)}号`,
    subtype,
    subtypeLabel: `${st.name}${st.isCounter ? '(反型)' : ''}`,
    subtypeNote: `${st.keyword}：${st.traits[0]}`,
    subtypeName: st.name,
    subtypeKeyword: st.keyword,
    subtypeTraits: st.traits,
    isCounter: st.isCounter,
    level,
    levelBand: levelBand(level),
    // §8.14：9 级细分级名（原实现只给 3 档 band）
    levelName: levelInfo(level).name,
    // §8.18：四大三元组归属（智慧中心/Hornevian/Harmonic/Harmony 客体关系）
    triads: triadLabels(coreNum),
    // §8.22：人格变化动态（整合/压力箭头、健康层级、翼型摆动）
    dynamics: characterDynamics(coreNum, wingKey, level),
  }

  const behaviors = [
    `他默认先处理「${prof.fear[0]}」——这是他的第一章程序级驱动。`,
    `压力一大，他会不自觉地滑向 ${prof.stressArrow} 号（${ENNEAGRAM_PROFILES[prof.stressArrow].zh}）的应对套路。`,
    `真正成长时，会向 ${prof.growthArrow} 号（${ENNEAGRAM_PROFILES[prof.growthArrow].zh}）汲取整合方向。`,
    // 亚型（本能副型）行为：27 亚型中该型号 × 本能的具体表现
    `${SUBTYPE_FULL[subtype]}亚型「${st.name}」${st.isCounter ? '（反型·易被误判成别的型号）' : ''}：${st.traits.join('；')}。`,
    ...st.traits.map(t => `${subtype.toUpperCase()}·${st.name} 外显：${t}。`),
    // §8.19：三元组行为（社交姿态 / 冲突第一反应）—— 无 LLM 时也保证卡片有三元组行为线索
    ...(triadGroupOf(coreNum, 'hornevian') ? [`社交姿态（Hornevian ${triadGroupOf(coreNum, 'hornevian')!.zh}）：${triadGroupOf(coreNum, 'hornevian')!.desc}——他索取所需时的默认站位。`] : []),
    ...(triadGroupOf(coreNum, 'harmonic') ? [`冲突第一反应（Harmonic ${triadGroupOf(coreNum, 'harmonic')!.zh}）：${triadGroupOf(coreNum, 'harmonic')!.desc}——写他与人起摩擦时照此落笔。`] : []),
    // §8.22：人格变化动态（翼型摆动 / 层级移动）
    `翼型摆动（${wingKey}: ${WING_NICK[wingKey] ?? ''}）：${TYPE_DYNAMICS[coreNum]?.wingSwing}。`,
  ]

  const arcAdvice = [
    `成长弧：沿整合箭头 ${coreNum}→${prof.growthArrow}，向 ${ENNEAGRAM_PROFILES[prof.growthArrow].zh}（${ENNEAGRAM_PROFILES[prof.growthArrow].en}）的正向移动，从【${prof.zh}】的健康端汲取活力。`,
    `压力戏：受压时滑向 ${prof.stressArrow} 号（${ENNEAGRAM_PROFILES[prof.stressArrow].zh}）的不健康特质，这是塑造"黑化/崩溃/爆发"节点的天然素材。`,
    `健康层级：日常取 Riso-Hudson 第 3-5 级（一般策略）；黑化降到 6-7 级；升华到 2-3 级。`,
    `亚型（副型）：${SUBTYPE_FULL[subtype]}·${st.name}${st.isCounter ? '（反型）' : ''} —— ${st.traits[0]}；被压抑的本能突然启用时，角色常伴随笨拙/爆发/觉醒，可作剧情转折锚点。`,
    // §8.19：三元组的弧光用法（客体关系与中心情绪）
    ...(triadGroupOf(coreNum, 'harmony') ? [`三元组·客体关系（${triadGroupOf(coreNum, 'harmony')!.zh}）：${triadGroupOf(coreNum, 'harmony')!.desc}——情感线的底层模式；他的成长常表现为这一模式被真正的关系打破。`] : []),
    ...(triadGroupOf(coreNum, 'centers') ? [`三元组·智慧中心（${triadGroupOf(coreNum, 'centers')!.zh}）：${triadGroupOf(coreNum, 'centers')!.desc}——这种核心情绪是他的 OOC 防线：违背它的选择需要足够诱因。`] : []),
    // §8.22：人格变化轨迹（健康↔病态如何随经历移动）
    `人格轨迹：健康端他像 ${ENNEAGRAM_PROFILES[prof.growthArrow].zh} 一样（${TYPE_DYNAMICS[coreNum].integration.look}）；压力失衡端他像 ${ENNEAGRAM_PROFILES[prof.stressArrow].zh} 一样（${TYPE_DYNAMICS[coreNum].stress.look}）。让"黑化/升华"沿这条轨迹滑。`,
  ]

  return {
    id: '',
    name: input.name,
    role: input.role ?? 'protagonist',
    appearance: input.appearance ?? '',
    background: input.background ?? '',
    goal: input.goal ?? '',
    stateNotes: input.stateNotes ?? '',
    enneagram,
    mbti: input.mbti ?? '',
    bigfive: Object.keys(input.bigfive ?? {}).length ? input.bigfive : {},
    behaviors,
    arcAdvice,
    createdAt: '',
    updatedAt: '',
  }
}

/** 从资料文本粗估九型（用于 novel 联动兜底） */
const typeKeywords: Record<number, string[]> = {
  1: ['正确', '原则', '标准', '秩序', '责任', '严谨', '道德'],
  2: ['付出', '照顾', '帮助', '被需要', '善良', '体贴', '牺牲'],
  3: ['成就', '目标', '成功', '效率', '形象', '优秀', '竞争'],
  4: ['独特', '深刻', '情绪', '艺术', '自我', '缺失', '孤独', '美'],
  5: ['思考', '分析', '知识', '观察', '独处', '研究', '冷静'],
  6: ['安全', '担心', '忠诚', '怀疑', '计划', '退路', '可靠'],
  7: ['自由', '兴趣', '体验', '快乐', '逃避', '新奇', '多'],
  8: ['掌控', '力量', '对抗', '保护', '直接', '主导', '强势'],
  9: ['和平', '随和', '调和', '平静', '回避', '随便', '妥协'],
}
/**
 * 从资料文本粗估九型（用于 novel 联动兜底 / 无问卷时的初判）。
 *
 * §8.7 修复：原实现是「关键词 includes 计数」，无权重、且 engine 与 novel-link 两份实现不一致
 * （一份滤 0 分一份不滤）。现统一为本函数单一实现，并改进为：
 *  - **加权命中**：关键词越长越具体，权重越高（长度 ≥3 记 2 分，否则 1 分），避免短词噪声。
 *  - **命中词明细**：返回 hits 供上层解释"为什么猜这个型号"。
 *  - **只返回真正命中的型号**（score > 0），零命中的型号不再混入候选。
 * 这是启发式兜底，**不可替代问卷**；有 quiz 结果时永远以 quiz 为准。
 */
export function guessEnneagramScored(text: string): { type: number; score: number; hits: string[] }[] {
  const t = String(text ?? '')
  const out: { type: number; score: number; hits: string[] }[] = []
  for (const [k, kws] of Object.entries(typeKeywords)) {
    let score = 0
    const hits: string[] = []
    for (const kw of kws) {
      if (!t.includes(kw)) continue
      score += kw.length >= 3 ? 2 : 1
      hits.push(kw)
    }
    if (score > 0) out.push({ type: Number(k), score, hits })
  }
  return out.sort((a, b) => (b.score - a.score) || (a.type - b.type))
}

/** 文本 → 九型候选型号（降序，最多 3 个；无命中时返回空数组） */
export function guessEnneagramFromText(text: string): number[] {
  return guessEnneagramScored(text).slice(0, 3).map(x => x.type)
}