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
import type { CharacterModel, CharacterRole, EnneagramProfile, Subtype, BigFiveScores, LevelInfo } from './types.js';
/** 主型 → 基础档案 */
export declare const ENNEAGRAM_PROFILES: Record<number, EnneagramProfile>;
/** 主翼配伍 → 翼昵称 */
export declare const WING_NICK: Record<string, string>;
/** 本能副型（三大本能）基础标签 */
export declare const SUBTYPE_KEYWORDS: Record<Subtype, {
    label: string;
    note: string;
}>;
/** 本能副型全称（用于卡片显示） */
export declare const SUBTYPE_FULL: Record<Subtype, string>;
/**
 * 27 种亚型（Naranjo 体系：9 型号 × 3 本能）。
 * 亚型比翼型更能解释「同一型号内部」的差异：恶习/激情遇上主导本能，会显著改变外部表现。
 * isCounter = 反型（Countertype）：该亚型表现与同型号另两个相反，易被误判成别的型号。
 * 来源：research/personality-tests/enneagram-subtypes.md（Integrative9 27 亚型）。
 */
export interface SubtypeProfile {
    name: string;
    keyword: string;
    traits: string[];
    isCounter: boolean;
}
export declare const SUBTYPE_PROFILES: Record<number, Record<Subtype, SubtypeProfile>>;
/** 取某型号 × 本能的亚型档案 */
export declare function subtypeProfile(core: number, subtype: Subtype): SubtypeProfile;
/** 亚型完整标题，如「SX · 知己（反型）」 */
export declare function subtypeTitle(core: number, subtype: Subtype): string;
export interface TriadGroup {
    key: string;
    zh: string;
    en: string;
    types: number[];
    desc: string;
}
export interface TriadSystem {
    key: string;
    zh: string;
    en: string;
    /** 这套三元组回答什么问题 */
    question: string;
    source: string;
    groups: TriadGroup[];
}
export declare const TRIAD_SYSTEMS: TriadSystem[];
/** 查某型号在四大三元组中的归属（含所属体系信息） */
export declare function triadMembership(core: number): {
    system: TriadSystem;
    group: TriadGroup;
}[];
/** 某型号的三元组归属 → 扁平中文标签（角色卡/模型用） */
export declare function triadLabels(core: number): {
    center: string;
    hornevian: string;
    harmonic: string;
    harmony: string;
};
/**
 * §8.20：三要素之「缺陷」类型学（FLAW_TYPES）。
 * 缺陷多种多样——这里给一个可选的分类坐标，供 flawSeed 候选与 LLM 详化时对号入座。
 * 每类缺陷都同时指认「它会对别人造成什么代价」，避免只写性格标签。
 */
export declare const FLAW_TYPES: {
    key: string;
    zh: string;
    cost: string;
}[];
/** 按 principal 缺陷关键词，概要归到某个 FLAW_TYPE（找不到返回 undefined） */
export declare function flawTypeOf(keyword: string): {
    key: string;
    zh: string;
    cost: string;
} | undefined;
/** 获得 FLAW_TYPES 的中英文对照清单行（character_essentials 提示词用） */
export declare function flawTypesLine(): string;
/**
 * §8.20：由「恶习(型号) × 副型(本能)」确定性生成 2-3 个缺陷候选。
 * 只给候选方向 + 一句"会造成什么代价",细节交 LLM 结合经历落地。
 */
export declare function flawSeed(core: number, subtype?: string): {
    name: string;
    type: string;
    cost: string;
}[];
/** 取某型号在指定三元组体系里的分组（找不到返回 undefined） */
export declare function triadGroupOf(core: number, systemKey: string): TriadGroup | undefined;
/**
 * §8.19：三元组 → LLM 详析提示词素材（单行，含每组含义与写作落点）。
 * 供角色详析（profile / trait_writer）、声音五件套、关系深析的【人格档案】段直接拼入。
 */
export declare function triadFactsLine(core: number): string;
/**
 * §8.19：三元组 → 角色详析的写作钩子（每个体系一条，说明该落到哪个维度上写）。
 * 由 triadFactsLine 的纯描述升级为「怎么用」，供提示词末尾附上。
 */
export declare function triadWritingHooks(core: number): string[];
/**
 * §8.14 修复：健康层级从「3 档粗分」升级为 Riso-Hudson 9 级细分表。
 * levelBand() 保留（3 档，向后兼容），levelInfo() 提供 9 级名称与描述。
 * 级名依 Riso-Hudson《Personality Types》九级健康层级通用命名。
 */
export declare const LEVEL_TABLE: Record<number, LevelInfo>;
/** 健康层级 → 9 级细分信息 */
export declare function levelInfo(level: number): LevelInfo;
/** 健康层级 → 档位 */
export declare function levelBand(level: number): string;
export interface Dyadic {
    /** 箭头去往的健康/失衡侧写 */
    look: string;
    /** 在那号待太久的潜在盲点 */
    to?: string;
}
export interface TypeDynamics {
    integration: Dyadic & {
        risk: string;
    };
    stress: {
        look: string; /** 把压力号当工具能拿到的资源 */
        resource: string;
    };
    /** 翼型摆动说明（主导翼↔潜在翼、双翼均衡、受压/成长时的摆向） */
    wingSwing: string;
}
/** 某型号的人格变化动态知识（型号名由 ENNEAGRAM_PROFILES[箭头] 派生） */
export declare const TYPE_DYNAMICS: Record<number, TypeDynamics>;
export interface CharacterDynamics {
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
}
/** §8.22：派生某角色/某型号的人格变化动态块（箭头型号名由档案派生，翼与层级并入） */
export declare function characterDynamics(core: number, wing?: string, level?: number): CharacterDynamics;
export interface NFQuestion {
    n: number;
    question: string;
    type: number;
}
export interface ForcedChoiceOption {
    text: string;
    type?: number;
    represents?: number | string;
    value?: string;
}
export interface ForcedChoiceQuestion {
    n: number;
    question: string;
    choice_a: ForcedChoiceOption;
    choice_b: ForcedChoiceOption;
}
export interface MultifactorItem {
    no: number;
    section: 'type' | 'instinct';
    stem_zh: string;
    option_a: {
        text_zh: string;
        represents: number | string;
    };
    option_b: {
        text_zh: string;
        represents: number | string;
    };
}
export interface BigFiveItem {
    n: number;
    item: string;
    dimension: string;
    facet: string;
    reverse_keyed: boolean;
}
/** IPIP-NEO-120 题（中文题面，含 5 大域 + 6 facet，keyed 正/反向） */
export interface IpipItem {
    id: string;
    text: string;
    text_en?: string;
    keyed: 'plus' | 'minus';
    domain: string;
    domainZh?: string;
    domainEn?: string;
    facet: number;
    facetZh?: string;
}
/** 通用 Likert 维度题（维度维度计分：HEXACO/SD3/依赖/控制点/道德/价值观 共用结构） */
export interface LikertDim {
    id: string;
    label: string;
    description?: string;
}
export interface LikertItem {
    position: number;
    text: string;
    dimension: string;
    reverseKeyed?: boolean;
}
export interface LikertBank {
    id: string;
    name: string;
    scaleMin: number;
    scaleMax: number;
    dimensions: LikertDim[];
    items: LikertItem[];
    /** 自定义维度中文名映射（缺省用 dimensions.label） */
    dimLabelZh?: Record<string, string>;
}
export interface QuestionBank {
    enneagram108: NFQuestion[];
    enneagram144: ForcedChoiceQuestion[];
    multifactor: MultifactorItem[];
    mbti: ForcedChoiceQuestion[];
    bfi: BigFiveItem[];
    mbti16?: any[];
    ipip?: IpipItem[];
    enneagram90?: LikertBank;
    hexaco24?: LikertBank;
    sd3?: LikertBank;
    ecr12?: LikertBank;
    locus24?: LikertBank;
    mfq30?: LikertBank;
    pvq21?: LikertBank;
    disc32?: LikertBank;
    eq22?: LikertBank;
}
/** 108 题（是/否）九型计分 */
export declare function scoreEnneagram108(bank: QuestionBank, ans: Record<number, any>): {
    type: number;
    score: number;
}[];
/** 144 题（二选一迫选）九型计分 */
export declare function scoreEnneagram144(bank: QuestionBank, ans: Record<number, any>): {
    type: number;
    score: number;
}[];
/**
 * 由 9 型得分推导 主型 + 侧翼（108 / 144 / 90 / multifactor 共用，§8.6 修复）。
 * - 主型 = 最高分；平分时偏向**小编号**型号（稳定排序，规则显式化）。
 * - 侧翼 = 相邻两型中分更高者；相邻型均为 0 分时 wing = core（表示未能判定翼）。
 * - `tie` 标记主型平分，供上层提示"结果接近、建议加测"。
 */
export declare function deriveCoreWing(scores: {
    type: number;
    score: number;
}[]): {
    core: number;
    wing: number;
    ranking: {
        type: number;
        score: number;
    }[];
    tie: boolean;
};
/** 深度多功能问卷（39 题：36 类型 + 3 本能） */
export declare function scoreMultifactor(bank: QuestionBank, ans: Record<number, any>): {
    core: number;
    wing: number;
    wingKey: string;
    typeScores: {
        type: number;
        score: number;
    }[];
    instincts: Record<string, number>;
    stack: string;
    stackFull: Subtype[];
    tritype: string;
    centers: {
        body: number;
        heart: number;
        head: number;
    };
    tie: boolean;
    types: Record<string, number>;
    harmonyTriads: {
        reactive: number;
        positive: number;
        competency: number;
    };
    objectRelations: {
        attachment: number;
        frustration: number;
        rejection: number;
    };
    hornevian: {
        superego: number;
        assertive: number;
        withdrawn: number;
    };
    lightDark: {
        light: number;
        dark: number;
    };
    harmonicGroups: {
        reactive: number;
        positive: number;
        competency: number;
    };
    harmonyDaniels: {
        idealist: number;
        relationist: number;
        pragmatist: number;
    };
    hornevianGroups: {
        compliant: number;
        assertive: number;
        withdrawn: number;
    };
    triadLabelsZh: Record<string, string>;
    dominant: {
        center: string;
        harmonic: string;
        harmony: string;
        objectRelation: string;
        hornevian: string;
        lightDark: string;
    };
    dominantZh: Record<string, string>;
};
/** MBTI 四轴归属 */
export declare const MBTI_AXIS_OF: Record<string, 'EI' | 'SN' | 'TF' | 'JP'>;
/**
 * §8.4 修复：找出 MBTI 题库中的「跨轴题」。
 * mbti-93 第 75 题（"你宁愿替哪一类上司工作"）是 T vs N——两个选项分属不同轴，
 * 计分时无论怎么答都会同时污染 TF 与 SN 两个计数。此函数把这类题识别出来供计分跳过。
 */
export declare function mbtiCrossAxisItems(bank: QuestionBank): number[];
/**
 * MBTI-93（二选一）计分：统计 E/I S/N T/F J/P（题库无 n 字段，按题序 1..93 索引作答）。
 * - **跨轴题自动跳过**（§8.4，见 mbtiCrossAxisItems），并在 `skipped` 中返回题号。
 * - 平局规则（显式化）：`counts[a] >= counts[b] ? a : b` → **平局偏向 E / S / T / J**（外向、实感、思考、判断）。
 */
export declare function scoreMbti(bank: QuestionBank, ans: Record<number, any>): {
    code: string;
    counts: Record<string, number>;
    skipped: number[];
    answered: number[];
    ties: string[];
    crossAxis: number[];
};
/** BFI-2 大五（60 题，1-5 点）计分 → 0-100 */
export declare function scoreBigfive(bank: QuestionBank, ans: Record<number, any>): BigFiveScores & {
    raw: Record<string, number>;
};
/**
 * IPIP-NEO-120（大五进阶，120 题，5 域 × 6 facet = 30 子维度）计分。
 * 5 点同意观点作答（1-5）；keyed=plus 直接分，minus 反向（6-v）。
 * 每域 24 题 = 6 facet × 4 题；返回 5 大域 0-100 分 + 30 子维度（facet）0-100 原始分。
 */
export declare function scoreIpipNeo120(bank: QuestionBank, ans: Record<number | string, any>): {
    big: Record<string, any>;
    facets: Record<string, any>;
    facetLabel: Record<string, string>;
    domainZh: Record<string, string>;
};
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
export declare function scoreLikertBank(bank: LikertBank, ans: Record<string | number, any>, dimLabelZh?: Record<string, string>): {
    scores: Record<string, number>;
    rawScores: Record<string, number>;
    dimLabels: Record<string, string>;
    missing: number[];
    answered: number[];
};
/** Enneagram-90：主型 = 9 型得分最高 + 次高翼（§8.6 统一走 deriveCoreWing） */
export declare function enneagram90Type(scores: Record<string, number>): {
    core: number;
    wing: number;
    ranking: {
        type: number;
        score: number;
    }[];
    tie: boolean;
};
export interface BuildInput {
    name: string;
    role?: CharacterRole;
    appearance?: string;
    background?: string;
    goal?: string;
    stateNotes?: string;
    enneagram?: {
        core?: number;
        wing?: number | string;
        subtype?: Subtype;
        level?: number;
    };
    mbti?: string;
    bigfive?: BigFiveScores;
}
/** 组装一个完整角色模型（基于九型档案补全所有派生字段） */
export declare function buildCharacterModel(input: BuildInput): CharacterModel;
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
export declare function guessEnneagramScored(text: string): {
    type: number;
    score: number;
    hits: string[];
}[];
/** 文本 → 九型候选型号（降序，最多 3 个；无命中时返回空数组） */
export declare function guessEnneagramFromText(text: string): number[];
