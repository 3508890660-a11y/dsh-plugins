/**
 * dsh-llm-probe — 一次性诊断：把 llm 服务的 provider 拓扑写到日志文件。
 */
import type { Context } from '@deepseek-ai/cordis';
import type LlmService from '@deepseek-ai/dsh-llm';
type AppContext = Context & {
    llm: LlmService;
};
export declare const name = "@dsh-external/dsh-llm-probe";
export declare const inject: string[];
export declare function apply(ctx: AppContext): void;
export {};
