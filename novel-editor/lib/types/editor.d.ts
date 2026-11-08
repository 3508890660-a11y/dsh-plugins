/**
 * novel-editor 编辑引擎：调用本地 Ollama novel-editor 模型（QLoRA 微调 Qwen3-4B）。
 * Prompt 模板与训练一致（03b_train_polish.py 的 ChatML 模板，assistant-only loss）：
 *   system: 你是资深中文小说编辑。…（训练 SYSTEM 原文，见 EDITOR_SYSTEM）
 *   user:   {instruction}\n\n【原文】\n{text}\n\n【润色后】
 * 因此推理格式与训练分布一致，模型只需续写【润色后】之后的正文。
 * 输出清洗：剥离 <think> 思考、imdi 等 LoRA 退化痕迹；最多 3 次重试。
 */
import type LlmService from '@deepseek-ai/dsh-llm';
import type { Context } from '@deepseek-ai/cordis';
export declare const EDITOR_SYSTEM: string;
/** AI 痕迹诊断（只诊断不改写）专用 system */
export declare const AISCAN_SYSTEM: string;
export type EditMode = 'proofread' | 'light' | 'deep' | 'consistency' | 'detrace';
/** 模式描述（与 dsh-novel-writer polishChapter 的 modeDesc 措辞对齐，proofread/consistency 为 novel-editor 新档） */
export declare const MODE_DESC: Record<EditMode, string>;
export interface EditOpts {
    mode?: EditMode;
    /** 自由指令（追加在模式描述之后，作为最终编辑要求） */
    instruction?: string;
    /** 重点方向（如：对话更口语化、动作描写更细致） */
    focus?: string;
    /** 附加 system 上下文（书名/题材/文风/人物档案），拼在训练 SYSTEM 之后 */
    systemExtra?: string;
    temperature?: number;
    maxTokens?: number;
}
export interface EditorConfig {
    provider: string;
    model: string;
    temperature: number;
    maxTokens: number;
    maxChars: number;
    /** 本地编辑模型离线时是否回退到当前捕获的主会话模型（默认 true） */
    fallbackToSession?: boolean;
}
export declare class EditorEngine {
    private ctx;
    private config;
    /** 主会话模型路由捕获（由 index.ts 的 llm/stream 监听更新）；本地模型离线时的回退路由 */
    sessionRoute: {
        provider: string;
        model: string;
    } | null;
    /** 显式配置路由是否已注册可用 */
    private get configuredRoute();
    constructor(ctx: Context & {
        llm: LlmService;
    }, config: EditorConfig);
    /** 更新捕获的主会话路由（本地模型离线时用于回退） */
    setSessionRoute(route: {
        provider: string;
        model: string;
    } | null): void;
    /** provider 是否已注册（复用 DSH 模型服务，ollama 为 dsh-llm-ollama 标准 provider） */
    providerRegistered(provider: string | undefined): boolean;
    /** 当前生效路由：显式配置（editorProvider/model）已注册 → 本地模型优先；否则若开启回退且捕获了主会话路由 → 用当前会话模型；否则 null（不可用） */
    route(): {
        provider: string;
        model: string;
    } | null;
    /** 路由 + 来源（status 工具展示用） */
    routeInfo(): {
        route: {
            provider: string;
            model: string;
        } | null;
        source: 'explicit' | 'session' | 'none';
    };
    /** 用户 prompt：与训练模板一致（指令直接接【原文】，无标题前缀） */
    buildUserPrompt(text: string, opts: EditOpts): string;
    /** 单次调用 LLM，返回原始文本（含可能的 think/imdi 残留） */
    private generateOnce;
    /** 输出清洗：think 剥离 + imdi 退化 + 【润色后】/【原文】标记 */
    cleanOutput(raw: string): string;
    /** 编辑主流程：调用 -> 清洗 -> 重试（输出过短/含【原文】标记时重试，最多 3 次） */
    edit(text: string, opts: EditOpts): Promise<string>;
    /** AI 痕迹诊断（只诊断不改写）：返回模型叙述的诊断报告；统计特征由调用方用 analyzeAiTraces 客观计算 */
    scanAi(text: string, opts: EditOpts): Promise<string>;
}
