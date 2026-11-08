/**
 * @dsh-external/novel-editor - 本地小说编辑引擎（DSH 插件）。
 *
 * 模型：novel-editor（QLoRA 微调 Qwen3-4B，Ollama 推理，训练数据对齐 ChatML 模板）。
 * 能力：校对 / 轻度修正 / 深度润色 / 一致性审查，输出完整正文。
 * 集成：复用 DSH 模型服务（ctx.llm.stream，provider=ollama）；数据与 dsh-novel-writer 布局互通
 *      （dataDir/projects/<id>/data.json + chapters/<id>.md），给定 projectId/chapterId 可编辑章节并落盘（自动备份）。
 */
import type { Context } from '@deepseek-ai/cordis';
import type LlmService from '@deepseek-ai/dsh-llm';
import z from '@deepseek-ai/schemastery';
type AppContext = Context & {
    llm: LlmService;
};
export declare const name = "@dsh-external/novel-editor";
export declare const inject: string[];
export interface Config {
    /** 数据目录（空=自动解析，优先级：NOVEL_DATA_DIR env -> 插件真实所在工作目录/novel-writer-data -> DSH_HOME 兜底），与 dsh-novel-writer 同源 */
    dataDir: string;
    /** 编辑模型 provider（默认 ollama；dsh-llm-ollama 提供） */
    editorProvider: string;
    /** 编辑模型名（QLoRA 微调 Qwen3-4B，ollama create novel-editor 产物） */
    editorModel: string;
    temperature: number;
    maxTokens: number;
    /** 【原文】截断字符数（超长章节只编辑前 N 字；训练 seq 2048，建议 ≤8000） */
    maxChars: number;
    /** 本地编辑模型离线时回退到当前会话模型（默认 true；回退路由来自对主会话 llm/stream 的捕获） */
    fallbackToSession: boolean;
    /** Ollama API 地址（状态检测用；推理走 ctx.llm.stream 不依赖此值） */
    ollamaUrl: string;
}
export declare const Config: z<Schemastery.ObjectS<{
    dataDir: z<string, string>;
    editorProvider: z<string, string>;
    editorModel: z<string, string>;
    temperature: z<number, number>;
    maxTokens: z<number, number>;
    maxChars: z<number, number>;
    fallbackToSession: z<boolean, boolean>;
    ollamaUrl: z<string, string>;
}>, Schemastery.ObjectT<{
    dataDir: z<string, string>;
    editorProvider: z<string, string>;
    editorModel: z<string, string>;
    temperature: z<number, number>;
    maxTokens: z<number, number>;
    maxChars: z<number, number>;
    fallbackToSession: z<boolean, boolean>;
    ollamaUrl: z<string, string>;
}>>;
export declare function apply(ctx: AppContext, config: Config): void;
export {};
