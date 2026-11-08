/**
 * dsh-llm-ollama — OllamaAdapter：LlmAdapter 实现。
 * 直连 Ollama OpenAI 兼容端点（/v1/chat/completions + /api/tags），
 * 每请求带 attributionHeaders()；honor options.signal；错误规范化 LlmError。
 */
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions, LlmModelInfo, LlmProviderInfo, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm';
import type { OllamaEndpointConfig } from './protocol.js';
/** 完整适配器配置（入口 Config 展开后的形状）。 */
export interface OllamaAdapterConfig extends OllamaEndpointConfig {
    contextWindow: number;
    maxTokens: number;
}
/**
 * 本地 Ollama 适配器。一个实例服务所有模型名（wire model 名 = 本地模型 id）。
 * config 以 getter 传入：设置页修改后动态读取，无需重建适配器实例。
 */
export declare class OllamaAdapter extends LlmAdapter {
    private readonly config;
    constructor(config: () => OllamaAdapterConfig);
    private get c();
    providerInfo(provider: string): LlmProviderInfo;
    listModels(provider: string): Promise<readonly LlmModelInfo[]>;
    resolveModel(provider: string, model: string, _signal?: AbortSignal): Promise<LlmResolvedModelInfo>;
    stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
}
