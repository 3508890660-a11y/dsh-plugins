/**
 * @dsh-external/dsh-ollama-probe — Ollama 适配器集成自检。
 * apply 时异步执行：listProviders → stream 真实调用，结果写入日志文件。
 * 注入即验证；不注册任何工具/路由。
 */
import type { Context } from '@deepseek-ai/cordis';
import type LlmService from '@deepseek-ai/dsh-llm';
type AppContext = Context & {
    llm: LlmService;
};
export declare const name = "@dsh-external/dsh-ollama-probe";
export declare const inject: string[];
export declare const Config: never;
export declare function apply(ctx: AppContext): void;
export {};
