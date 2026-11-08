/**
 * @dsh-external/dsh-llm-ollama — Ollama LLM 适配器插件。
 * 向 DSH 注册 provider 路由 'ollama'（OpenAI 兼容 API），并声明为可配置 provider：
 * - registerConfigurableProviders → 出现在模型设置页/模型选择器（displayName 'Ollama 本地'）
 * - 设置页表单由内核从本插件导出的 Config schema 自动派生（DSH 1.0.3+ 的 SettingsForms）
 * - adapter 以 getter 读配置：配置保存触发 profile 重载，本插件被重新 apply 并拿到新 config
 *
 * 迁移记录（2026-10-12）：DSH Desktop 1.0.3 / 内核 @deepseek-ai/dsh 0.2.0-rc.2 移除了
 * `@deepseek-ai/dsh-settings` 的 `installSettingsSection` 与 `settingsNamespace`
 * （该包现在只导出 SettingsConflictError / SettingsForms / redactSecrets）。
 * 新契约下插件只需「导出 Config schema + registerConfigurableProviders」，
 * 设置页 section 由内核 SettingsForms 自动收集生成；`settingsNs` 也从 Symbol 变回普通字符串。
 */
import type { Context } from '@deepseek-ai/cordis';
import type LlmService from '@deepseek-ai/dsh-llm';
import z from '@deepseek-ai/schemastery';
type AppContext = Context & {
    llm: LlmService;
};
export declare const name = "@dsh-external/dsh-llm-ollama";
export declare const inject: string[];
export interface Config {
    /** Ollama 服务地址（含协议与端口）。 */
    baseUrl: string;
    /** 可选 API key（Ollama 0.5+ OLLAMA_API_KEY 场景）；本地默认空。 */
    apiKey: string;
    /** 本地模型默认上下文窗口（token）。 */
    contextWindow: number;
    /** 本地模型默认单次输出上限（token）。 */
    maxTokens: number;
}
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    baseUrl: z<string, string, "defined">;
    apiKey: z<string, string, "defined">;
    contextWindow: z<number, number, "defined">;
    maxTokens: z<number, number, "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    baseUrl: z<string, string, "defined">;
    apiKey: z<string, string, "defined">;
    contextWindow: z<number, number, "defined">;
    maxTokens: z<number, number, "defined">;
}>>, "plain">;
export declare function apply(ctx: AppContext, config: Config): void;
export {};
