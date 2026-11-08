/**
 * shortnovel-workflow 生成引擎：复用 DSH 模型服务（ctx.llm.stream）。
 * 有效路由：config provider/model（默认跟随主会话捕获路由 lastSessionRoute）。
 *
 * 每阶段一个生成方法。为「墨安」式爆款短篇流水线编码以下方法学：
 *   脑洞（5 个，含人设+完整梗概，开头暴击）→ 导语（5 条，背景→反常→反转）
 *   → 大纲（10 章×10 剧情点，按题材公式）→ 正文（强去 AI 味、一句话一行、黄金三章、付费点）
 *   → 审稿（编辑视角，付费点 + 修改方案 + 改后全文）。
 */
import type LlmService from '@deepseek-ai/dsh-llm';
import type { Context } from '@deepseek-ai/cordis';
import type { ProjectGoal, ShortNovelProject } from './types.js';
import { StyleKb } from './style-kb.js';
type AppContext = Context & {
    llm: LlmService;
};
export interface WorkflowRouteConfig {
    provider?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
    /** 思考档位（默认 off）。若路由模型不支持该档位，generate 会自动降级重试（省略该参数）。 */
    reasoningEffort?: string;
    /** 文风知识库（style-kb）适配实例；缺省则各阶段不注入文风卡 */
    styleKb?: StyleKb;
}
/**
 * 正文/叙事专用 · 去AI味负面提示词（Show don't Tell + 反流水线描写 + 墨安修辞禁令）。
 * 由 genNovelPart 与 genReview 注入到改稿/正文的醒目位置。
 */
export declare const PROSE_BANS: string;
export declare class WorkflowGenerator {
    private ctx;
    private config;
    /** 主会话路由捕获（由 index.ts 的 llm/stream 监听更新） */
    lastSessionRoute: {
        provider: string;
        model: string;
    } | null;
    /** 文风知识库（style-kb）适配实例（供生成注入与 tools 复用） */
    readonly styleKb: StyleKb | undefined;
    constructor(ctx: AppContext, config: WorkflowRouteConfig);
    private providerRegistered;
    effectiveRoute(): {
        provider: string;
        model: string;
    } | null;
    /** 单次流式调用：useEffort=true 时附带思考档位（默认 off），否则完全省略该参数 */
    private runStream;
    /** 流式调用 LLM，返回完整文本；思考档位不被支持时自动降级重试 */
    generate(system: string, prompt: string, opts?: {
        temperature?: number;
        maxTokens?: number;
    }): Promise<string>;
    /** 拼接"项目上下文"给各阶段 user prompt 开头 */
    private projectCtx;
    /** 已确认的各阶段内容（供后续阶段引用），只列写入的 */
    private confirmedCtx;
    /** 反馈片段：若用户携反馈修订，则追加到 prompt 头部作为最高优先级约束 */
    private feedbackNote;
    /**
     * 文风卡蒸馏块：从项目启用集（或本次覆盖的 styleKeys）蒸馏注入各阶段的文风指引。
     * 短篇以"一句一行 + 强去 AI"为硬约束，故附一句警告：格式红线优先于文风卡模仿。
     * 返回 '' 表示无可注入内容。
     */
    styleBlock(p: ShortNovelProject, overrideKeys?: string[], capChars?: number, maxCards?: number): string;
    /** 拼接各阶段 system prompt：人设 + 去AI负面提示词 + 文风卡块 + 本阶段要点 */
    private stageSys;
    /** 脑洞：生成 5 个含人设+完整梗概的爆款设定 */
    genBrainstorm(p: ShortNovelProject, feedback?: string, styleKeys?: string[]): Promise<string>;
    /** 导语：从选定脑洞裂变 5 条爆款导语 */
    genLeadin(p: ShortNovelProject, feedback?: string, styleKeys?: string[]): Promise<string>;
    /** 大纲：依据导语 + 题材公式，设计 10 章 × 10 剧情点 */
    genOutline(p: ShortNovelProject, feedback?: string, styleKeys?: string[]): Promise<string>;
    /** 正文：按正文目标逐段完成（无目标时按字数分块兜底） */
    genNovelPart(p: ShortNovelProject, partIndex: number, totalParts: number, prevTail: string, feedback?: string, styleKeys?: string[], goal?: ProjectGoal): Promise<string>;
    /** 审稿：编辑视角，付费点 + 逐章修改方案 + 输出完整改后全文（改处加粗） */
    genReview(p: ShortNovelProject, feedback?: string, styleKeys?: string[]): Promise<string>;
}
export {};
