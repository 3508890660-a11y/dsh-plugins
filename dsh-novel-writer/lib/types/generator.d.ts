/**
 * LLM 生成引擎：章节正文生成 + 结构化记忆提取。
 * 复用 DSH 模型服务：优先 config 显式 provider/model，否则跟随主会话捕获路由。
 */
import type LlmService from '@deepseek-ai/dsh-llm';
import type { Context } from '@deepseek-ai/cordis';
import type { Character, ChapterRecord, Foreshadowing, OutlineNode, ProjectData, WorldviewCategory, CharacterRole } from './types.js';
type AppContext = Context & {
    llm: LlmService;
};
/** 默认写作 provider：Google 网页版端口（由 dsh-gemini-web 注册的 LLM provider） */
export declare const GEMINI_WEB_PROVIDER = "gemini-web";
/** 默认写作模型（该 provider 下的单模型名） */
export declare const GEMINI_WEB_MODEL = "gemini-web";
/** 临时测试路由：设为 null 不影响默认优先级；用于模型质量对比测试（如 stepfun/step-5-preview） */
export declare let TEST_ROUTE: {
    provider: string;
    model: string;
} | null;
/**
 * 依据题材/文风裁定本作启用的悬念层（三层基底 + 按题材增补）。
 * 「可以根据作品调整悬念层结构」在此落地为代码判断，而非仅写在规则里。
 */
export declare function buildSuspenseLayers(genre: string, style: string): string[];
/** 大纲架构·波浪式悬念法（小循环 → 大循环，分层铺悬念；按题材裁定启用的悬念层） */
export declare function buildSuspenseArchitecture(genre: string, style: string): string;
/** 多层式高潮法：多类型高潮线，平时择要加压，大循环收尾集体引爆 */
export declare function buildClimaxArchitecture(): string;
export interface LlmRouteConfig {
    provider?: string;
    model?: string;
    /** 润色专用路由（默认 ollama/novel-polish，独立于写作路由；缺省则回退 provider/model） */
    polishProvider?: string;
    polishModel?: string;
    temperature?: number;
    maxTokens?: number;
    /** 设定导入：超过此字符数启用分块解析（默认 20000） */
    importLongThreshold?: number;
    /** 设定导入：分块解析每块字符数（默认 15000） */
    importChunkChars?: number;
    /** 设定导入：分块解析使用的云端大模型 provider（默认 deepseek-official，不存在则回退当前路由） */
    importCloudProvider?: string;
    /** 设定导入：分块解析使用的云端大模型 model */
    importCloudModel?: string;
    /** 文风知识库根目录（含 cards/ 子目录；空/不可达则写作不注入文风卡） */
    styleKbDir?: string;
}
export interface MemoryExtraction {
    summary: string;
    events: string[];
    characterUpdates: {
        name: string;
        change: string;
    }[];
    items: string[];
    foreshadowingPlanted: string[];
    foreshadowingResolved: string[];
}
/** 设定文件 AI 解析结果（与 store 数据模型对齐） */
export interface SettingsParsed {
    worldview: {
        category: WorldviewCategory;
        title: string;
        content: string;
    }[];
    characters: {
        name: string;
        aliases: string[];
        role: CharacterRole;
        appearance: string;
        personality: string;
        background: string;
        goal: string;
        possessions: string[];
        relationships: {
            name: string;
            description: string;
        }[];
    }[];
    outline: {
        type: 'volume' | 'chapter';
        title: string;
        summary: string;
        beats: string[];
    }[];
    foreshadowings: {
        description: string;
        notes: string;
    }[];
}
/** 设定导入防重复：项目/前序块已提取的条目名 */
export interface ExistingNames {
    worldview: string[];
    characters: string[];
    outline: string[];
    foreshadowings: string[];
}
export declare class Generator {
    private ctx;
    private config;
    /** 主会话路由捕获（由 index.ts 的 llm/stream 监听更新） */
    lastSessionRoute: {
        provider: string;
        model: string;
    } | null;
    private _styleKb;
    constructor(ctx: AppContext, config: LlmRouteConfig);
    /** 文风知识库句柄（懒加载；不可达时 available=false，写作跳过注入） */
    private get styleKb();
    /** 项目默认启用（enabled=true）的文风卡 key 合集 */
    activeStyleCardKeys(data: ProjectData): string[];
    /** 把一组文风卡 key 蒸馏成可注入块（带指令头）；无可注入内容返回 ''。 */
    styleCardBlocks(keys: string[], capChars?: number, maxCards?: number): string;
    /** provider 是否已注册（本地默认模型不可用时的判据） */
    private providerRegistered;
    /**
     * 当前生效路由优先级：显式配置（config provider/model）→ 测试路由（TEST_ROUTE，仅模型比对时用）
     * → Google 网页版端口（provider 'gemini-web' 已注册时）→ 当前会话模型（lastSessionRoute）。
     */
    effectiveRoute(): {
        provider: string;
        model: string;
    } | null;
    /** 设定导入分块阈值（供 tools 层分流判断） */
    get importLongThreshold(): number;
    get importChunkChars(): number;
    /** 流式调用 LLM，返回完整文本（opts.route 可覆盖路由；reasoningEffort 默认 off，JSON/正文任务稳定输出） */
    generate(system: string, prompt: string, opts?: {
        temperature?: number;
        maxTokens?: number;
        route?: {
            provider: string;
            model: string;
        };
        reasoningEffort?: boolean;
    }): Promise<string>;
    /** 组装写作 system prompt（人设+文风+世界观+人物卡）
     *  styleOverrides：本次生成覆盖选用的文风卡 key 清单（不传则用项目 enabled 的默认注入集）。
     */
    buildSystemPrompt(data: ProjectData, characters: Character[], styleOverrides?: string[]): string;
    /**
     * 组装章节生成的 user prompt（章节目标+伏笔+近章记忆+衔接）。
     * 若本章隶属大纲卷（chapter.parentId → volume 节点），注入【所在卷】上下文：
     * 卷标题/卷概要与卷内相对章号，帮助模型在长篇分卷叙事中保持卷主题连贯。
     */
    buildChapterPrompt(data: ProjectData, node: OutlineNode, prevChapter: ChapterRecord | null, openForeshadowings: Foreshadowing[], recentSummaries: ChapterRecord[], extraInstructions: string): string;
    /** 从章节正文提取结构化记忆（摘要/事件/人物变化/物品/伏笔） */
    extractMemory(data: ProjectData, chapterTitle: string, content: string, openForeshadowings: Foreshadowing[]): Promise<MemoryExtraction>;
    /** 解析记忆 JSON（容错：剥 markdown fence / 截取花括号） */
    parseMemoryJson(raw: string): MemoryExtraction;
    /** 项目已有条目名（防重复） */
    private collectExistingNames;
    /** 设定解析 system prompt（常量） */
    private static readonly SETTINGS_SYSTEM;
    /** 构造设定解析 prompt（分块解析复用；chunkNo/chunkTotal 为块标记，单块时省略） */
    private buildSettingsPrompt;
    /** 从设定文件解析出的结构化内容（单次调用；调用方已保证内容 ≤ 24000 字符） */
    parseSettingsFile(data: ProjectData, fileName: string, content: string, mode: string): Promise<SettingsParsed>;
    /** 超长设定文本按行切块（空行断点优先；单行超长按字符硬切；最多 20 块） */
    chunkSettingsText(content: string, chunkChars: number, maxChunks?: number): {
        chunks: string[];
        truncated: boolean;
    };
    /** 分块解析的超长文本可用的云端大模型路由（配置了且 provider 已注册才启用，否则 null=回退当前路由） */
    private resolveCloudRoute;
    /** 超长设定文件分块解析（每块一次 LLM 调用，块间注入已提取清单防重复，最后合并） */
    parseSettingsFileLong(data: ProjectData, fileName: string, content: string, mode: string): Promise<{
        parsed: SettingsParsed;
        chunks: number;
        usedCloud: boolean;
        truncated: boolean;
    }>;
    /** 解析设定 JSON（容错：剥 fence / 截花括号 / 中文类别角色映射） */
    parseSettingsJson(raw: string): SettingsParsed;
    /** 续写/改写/润色（交互式创作） */
    continueText(data: ProjectData, systemExtra: string, instructions: string): Promise<string>;
    /**
     * 修正 + 润色已完成章节正文（保持世界观/人物/情节一致，只输出润色后正文）。
     * mode=light 轻度修正；mode=deep 深度润色（可适度扩写表现力）。
     */
    polishChapter(data: ProjectData, node: OutlineNode, content: string, opts: {
        mode: 'light' | 'deep';
        focus?: string;
        route?: {
            provider: string;
            model: string;
        };
    }): Promise<string>;
}
export {};
