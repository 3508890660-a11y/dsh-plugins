/**
 * shortnovel-workflow 数据模型。
 *
 * 工作流（严格分步，逐阶段确认）：
 *   topic(用户给主题/脑洞/例文) -> brainstorm(脑洞: 5个)
 *   -> leadin(导语: 5条爆款导语) -> outline(大纲: 10章×10剧情点, 按题材公式)
 *   -> novel(正文: 强去AI味, 一句一行, ~1.2万字) -> review(审稿: 付费点+修改方案+改后全文) -> done
 *
 * 每一步的内容生成后，必须由外部（AI 助手）向用户询问"是否满意"；
 * 满意才能 advance 进入下一步；不满意用 revise 携反馈重生成。禁止一次性跳到结尾。
 *
 * 方法学来源：如流写作「墨安」短篇 9-agent 流水线（脑洞/导语/大纲/正文/审稿 + 追妻/世情/甜宠/悬疑 类型公式）。
 */
/** 工作流阶段（顺序即推进顺序） */
export declare const STAGE_ORDER: readonly ["brainstorm", "leadin", "outline", "novel", "review"];
export type StageKey = (typeof STAGE_ORDER)[number];
/** 阶段中文标签 + 各阶段一句话说明（用于引导用户确认） */
export declare const STAGE_LABEL: Record<StageKey, string>;
/** 各阶段生成要求的核心要点（加粗展示的关键句式） */
export declare const STAGE_GUIDE: Record<StageKey, string>;
/** 题材公式匹配 + 返回用于大纲阶段的内嵌公式文本 */
export declare function genreFormula(genre: string): {
    label: string;
    text: string;
};
/** 正文目标：大纲阶段定下的逐段完成目标（正文按此逐段完成） */
export interface ProjectGoal {
    index: number;
    title: string;
    targetChars: number;
    beats: string[];
    hook?: string;
    done: boolean;
}
/** 项目绑定的一张文风卡（style-kb/cards 里的卡片 key；enabled 控制默认注入） */
export interface ProjectStyleCard {
    key: string;
    enabled: boolean;
}
/** 项目结构 */
export interface ShortNovelProject {
    id: string;
    topic: string;
    genre: string;
    style: string;
    title: string;
    stage: StageKey;
    /** 已确认（"满意"）的阶段性内容；novel 为最终正文 */
    content: Partial<Record<StageKey, string>>;
    /** 绑定到项目的文风卡（可多张并存；enabled=true 的默认注入各阶段生成） */
    styleCards: ProjectStyleCard[];
    /** 正文分段（novel 阶段按正文目标逐段续写；无目标时按字数分块兜底） */
    novelParts: string[];
    /** 大纲定下的正文目标清单（正文阶段按此逐段完成；空=字数制兜底） */
    goals: ProjectGoal[];
    /** 正文目标字数（默认 12000；目标制下为各目标字数之和的参考/兜底） */
    targetChars: number;
    /** 是否已完成整本（含审稿） */
    done: boolean;
    createdAt: string;
    updatedAt: string;
}
/** 项目元信息（列表用） */
export interface ProjectMeta {
    id: string;
    topic: string;
    title: string;
    genre: string;
    stage: StageKey;
    done: boolean;
    wordCount: number;
    createdAt: string;
    updatedAt: string;
}
export declare function nowIso(): string;
/** 生成项目 id：snw_ 前缀 + 时间戳36进制 + 随机 */
export declare function projectId(): string;
/** 阶段序号（用于校验推进顺序） */
export declare function stageIndex(stage: StageKey): number;
/** 下一阶段；已是最后一个则返回 null */
export declare function nextStage(stage: StageKey): StageKey | null;
/** 已确认内容的字数（novel 用 novelParts 累加，其余用 content 对应阶段） */
export declare function wordCountOf(p: ShortNovelProject): number;
