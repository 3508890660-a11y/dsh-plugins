/** 角色设定工作坊 · 类型定义 */
/** 角色定位 */
export type CharacterRole = 'protagonist' | 'supporting' | 'antagonist' | 'minor';
/** 九型主型指示 */
export type EnnCore = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
/** 本能副型 */
export type Subtype = 'sp' | 'sx' | 'so';
/**
 * §8.18 四大三元组归属（九型 Triads）。
 * 四套独立三分法：智慧中心（核心情绪）/ Hornevian 社交姿态 / Harmonic 冲突应对 / Harmony=客体关系（Daniels/Gore 双命名）。
 */
export interface TriadMembership {
    /** 智慧中心：如「腹中心（本能）」 */
    center: string;
    /** Hornevian：顺从组（朝人靠近）/ 进攻组（对抗）/ 退缩组（远离） */
    hornevian: string;
    /** Harmonic：正面展望组 / 能力组 / 反应组（情绪真实） */
    harmonic: string;
    /** Harmony（David Daniels）= 客体关系（Gore）：理想主义者（挫折）/ 关系主义者（拒绝）/ 实用主义者（依附） */
    harmony: string;
}
/** 问卷类型 */
export type QuestionnaireKind = 'enneagram-108' | 'enneagram-144' | 'enneagram-multifactor' | 'enneagram-90' | 'mbti-93' | 'bigfive-60' | 'ipip-neo-120' | 'hexaco-24' | 'sd3' | 'ecr-12' | 'locus-24' | 'mfq-30' | 'pvq-21' | 'disc-32' | 'eq-22';
/** 九型档案核心字段（与 render/engine 共用） */
export interface EnneagramProfile {
    core: number;
    zh: string;
    en: string;
    center: '腹/本能' | '心/情感' | '脑/思维';
    virtue: string;
    vice: string;
    fear: string[];
    desire: string[];
    traits: string[];
    stressArrow: number;
    growthArrow: number;
    harmony?: {
        name: string;
        desc: string;
    };
}
/** 角色模型里的九型段 */
export interface EnneagramModel {
    core: number;
    coreName: string;
    coreEn: string;
    wing?: string;
    wingNick?: string;
    center: string;
    fear: string[];
    desire: string[];
    traits: string[];
    virtue: string;
    vice: string;
    stressArrow: number;
    growthArrow: number;
    subtype: Subtype;
    subtypeLabel: string;
    subtypeNote?: string;
    /** 27 亚型：亚型名（如「知己」） */
    subtypeName?: string;
    /** 27 亚型：关键词（如「交底的知音」） */
    subtypeKeyword?: string;
    /** 27 亚型：该亚型特质清单 */
    subtypeTraits?: string[];
    /** 是否反型（Countertype） */
    isCounter?: boolean;
    level: number;
    levelBand: string;
    /** 健康层级名称（9 级细分，如「自我实现」「攻击性」） */
    levelName?: string;
    /** §8.18：四大三元组归属（智慧中心/Hornevian/Harmonic/Harmony 客体关系） */
    triads?: TriadMembership;
    /** §8.22：人格变化动态（整合/压力箭头、健康层级移动、翼型摆动），供角色卡与弧光写作 */
    dynamics?: {
        integration: {
            to: number;
            toName: string;
            look: string;
            risk: string;
        };
        stress: {
            to: number;
            toName: string;
            look: string;
            resource: string;
        };
        wingSwing: string;
        level: {
            level: number;
            band: string;
        };
        text: string;
    };
    presence?: string;
    catchphrase?: string[];
    triggers?: string[];
    stressResponse?: string[];
    growthResponse?: string[];
}
/** 大五维度分（0-100 或原始分） */
export type BigFiveScores = Partial<Record<'Openness' | 'Conscientiousness' | 'Extraversion' | 'Agreeableness' | 'Neuroticism', number>>;
/** 角色所属来源（novel-writer 联动） */
export interface CharacterSource {
    kind: 'novel';
    projectId: string;
    characterId: string;
}
/** §8.20/§8.21 三要素：动机 / 缺陷 / 细节（创作层详实块，非测量层） */
export interface EssentialsDetailItem {
    /** 是否为核心细节（1-2 处，全书反复回响的锚点；其余为锦上添花的补充） */
    core?: boolean;
    /** 细节类型：小动作 / 物件 / 口头禅由头 / 身体标记 / 关系密码 / 剧情钩子… */
    aspect: string;
    /** 这个细节具体长什么样（可复现的一句话） */
    desc: string;
    /** 是否为该被剧情回收的伏笔/钩子 */
    hook?: boolean;
}
export interface CharacterEssentials {
    motivation?: {
        /** 主动机：长期主驱动（一个齿轮），够强烈到能逼他走完这条故事线 */
        primary: string;
        /** 次动机：当下的短期目标/一步，常是主动机可握的把手 */
        secondary: string;
        /** 紧迫感来源：为什么是现在、拖不起的原因（尤其主角必须强烈） */
        urgency?: string;
        /** 触发器：什么会推动他动起来 */
        trigger: string[];
        /** 越界开关：什么会让他突破自己的底线 */
        crossLine: string;
        /** 来源：auto=自动读项目大纲推导 / manual=制作者主导 */
        source?: 'auto' | 'manual';
    };
    flaw?: {
        /** 缺陷名，如「过度理性化」 */
        name: string;
        /** 缺陷类型学类别（FLAW_TYPES），如「回避亲密」 */
        type: string;
        /** 缺陷所在维度：性格 / 能力 / 生理 / 习惯（包括但不限于） */
        kind?: string;
        /** 它让人（对自己/对他人）付出的代价 */
        cost: string;
        /** 它如何推动剧情 / 与动机的冲突点（矛盾处就是戏剧发动机） */
        conflictWithMotivation?: string;
        /** 正派角色保魅力的写法：真实共鸣又不招人厌的平衡 */
        keepsCharm?: string;
        /** 整合/成长后会补上什么 */
        growth: string;
    };
    detail?: EssentialsDetailItem[];
    updatedAt?: string;
}
/** 深度人格档案（由 LLM 生成的角色专属详析） */
export interface CharacterLibrary {
    narrative?: string;
    /** §8.2 迁移：旧版遗留字段（persona/keywords 等）移存于此，不参与渲染 */
    legacy?: Record<string, unknown>;
}
/** 健康层级（Riso-Hudson 9 级）*/
export interface LevelInfo {
    level: number;
    /** 三档：健康 / 一般 / 病态 */
    band: '健康' | '一般' | '病态';
    /** 该级名称，如「自我实现」「攻击性」 */
    name: string;
    desc: string;
}
/** 通用维度量表计分结果（HEXACO/SD3/ECR-12/控制点/MFQ/PVQ/DISC/EQ 共用） */
export interface ScaleResult {
    /** 量表显示名，如「HEXACO 六维」 */
    name: string;
    /** 各维度 0-100 标准分 */
    scores: Record<string, number>;
    /** 各维度原始均分（量表自身量纲） */
    raw: Record<string, number>;
    /** 维度 id → 中文标签 */
    labels: Record<string, string>;
    scaleMin: number;
    scaleMax: number;
}
/** 独立角色库版本 */
export interface CharacterModel {
    id: string;
    name: string;
    role: CharacterRole;
    appearance: string;
    background: string;
    goal: string;
    stateNotes: string;
    enneagram: EnneagramModel;
    mbti?: string;
    mbtiDetail?: string;
    /** MBTI 数据来源：quiz=问卷实测；inferred=AI 依角色资料模拟作答 */
    mbtiSource?: 'quiz' | 'inferred';
    bigfive?: BigFiveScores;
    /** 大五数据来源：quiz=问卷实测；inferred=AI 依角色资料模拟作答 */
    bigfiveSource?: 'quiz' | 'inferred';
    /** AI 推断理由（简短，用于卡片说明） */
    testsNote?: string;
    behaviors: string[];
    arcAdvice: string[];
    library?: CharacterLibrary;
    source?: CharacterSource;
    /** §8.20 三要素：动机 / 缺陷 / 细节 */
    essentials?: CharacterEssentials;
    createdAt: string;
    updatedAt: string;
    /** IPIP-NEO-120 的 30 个子维度分（键如 'N.f1'），0-100 */
    ipipFacets?: Record<string, number>;
    /** 子维度中文标签（键如 'N.f1' → '神经质·焦虑'） */
    ipipFacetLabel?: Record<string, string>;
    /** 各通用维度量表的计分结果，键为问卷 kind */
    scales?: Partial<Record<QuestionnaireKind, ScaleResult>>;
}
/**
 * 问卷作答记录（schemaVersion 3 起存完整结果，可复盘/重算/对比历史）。
 * 旧数据只有 kind+finishedAt，读取时按可选字段兼容。
 */
export interface QuestionnaireResult {
    id?: string;
    kind: QuestionnaireKind;
    /** 作答对象角色 id（问卷绑定角色时记录） */
    characterId?: string;
    /** 原始作答（题号/题键 → 值），可重算 */
    answers?: Record<string, unknown>;
    /** 计分器返回值快照（各问卷结构不同） */
    scores?: Record<string, unknown>;
    /** 一句话结果摘要（列表展示用） */
    summary?: string;
    /** 缺失题号清单（校验用） */
    missing?: number[];
    finishedAt: string;
}
/** 互动边的方向：a→b / b→a / a↔b */
export type InteractionDirection = 'a->b' | 'b->a' | 'a<->b';
/**
 * 角色互动（关系网的一条有向/双向边）。
 * 参与方用稳定 key 标识（local:<本地角色id> 或 novel:<项目id>:<角色id>），
 * 便于跨边合并成同一节点；aName/bName 为展示名（冗余存储，避免前端二次解析）。
 * projectId 留空表示「共享/本地」作用域。
 */
export interface Interaction {
    id: string;
    projectId?: string;
    aKey: string;
    aName: string;
    bKey: string;
    bName: string;
    /** 关系类型：敌手/恋人/师徒/血亲/同盟/宿敌/上司/下属/朋友/陌路… */
    type: string;
    /** 情感立场：敌对/亲近/利用/暧昧/复杂/敬畏/依赖… */
    stance: string;
    direction: InteractionDirection;
    /** 联结强度 0-10 */
    weight: number;
    /** 一句话关系概括 */
    summary: string;
    tags?: string[];
    /** LLM 生成的互动深析（markdown） */
    analysis?: string;
    createdAt: string;
    updatedAt: string;
}
/** 关系网节点（前端渲染用） */
export interface RelationNode {
    id: string;
    name: string;
    role?: string;
    core?: number;
    coreName?: string;
    group?: number;
}
/** 关系网边（前端渲染用） */
export interface RelationEdge {
    id: string;
    source: string;
    target: string;
    type: string;
    stance: string;
    direction: InteractionDirection;
    weight: number;
}
/** 关系网图（GET /relationship-graph 返回） */
export interface RelationshipGraph {
    nodes: RelationNode[];
    edges: RelationEdge[];
}
