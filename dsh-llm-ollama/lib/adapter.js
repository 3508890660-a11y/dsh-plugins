/**
 * dsh-llm-ollama — OllamaAdapter：LlmAdapter 实现。
 * 直连 Ollama OpenAI 兼容端点（/v1/chat/completions + /api/tags），
 * 每请求带 attributionHeaders()；honor options.signal；错误规范化 LlmError。
 */
import { LlmAdapter, LlmError, attributionHeaders, } from '@deepseek-ai/dsh-llm';
import { httpErrorCode, parseSse, serializeRequest, translate } from './protocol.js';
/**
 * 本地 Ollama 适配器。一个实例服务所有模型名（wire model 名 = 本地模型 id）。
 * config 以 getter 传入：设置页修改后动态读取，无需重建适配器实例。
 */
export class OllamaAdapter extends LlmAdapter {
    config;
    constructor(config) {
        super();
        this.config = config;
    }
    get c() {
        return this.config();
    }
    providerInfo(provider) {
        return { id: provider, name: 'Ollama' };
    }
    async listModels(provider) {
        try {
            // 与 chat/completions 一致：配置了 API Key 就带上（反代/网关常要求鉴权才能列模型）
            const headers = { ...attributionHeaders() };
            if (this.c.apiKey.length > 0)
                headers['authorization'] = `Bearer ${this.c.apiKey}`;
            const res = await fetch(`${this.c.baseUrl}/api/tags`, {
                headers,
                signal: AbortSignal.timeout(5000),
            });
            if (!res.ok)
                return [];
            const body = (await res.json());
            return (body.models ?? [])
                .map((model) => model.name ?? '')
                .filter((id) => id.length > 0)
                .map((id) => ({
                provider,
                id,
                name: id,
                inputModalities: ['text'],
            }));
        }
        catch {
            return [];
        }
    }
    resolveModel(provider, model, _signal) {
        return Promise.resolve({
            provider,
            id: model,
            name: model,
            inputModalities: ['text'],
            context: { contextWindow: this.c.contextWindow },
            defaultMaxTokens: this.c.maxTokens,
        });
    }
    async *stream(options) {
        const consumer = new AbortController();
        const signal = options.signal === undefined
            ? consumer.signal
            : AbortSignal.any([options.signal, consumer.signal]);
        try {
            const body = serializeRequest(options, this.c);
            const headers = {
                'content-type': 'application/json',
                'accept': 'text/event-stream',
                ...attributionHeaders(),
            };
            if (this.c.apiKey.length > 0) {
                headers['authorization'] = `Bearer ${this.c.apiKey}`;
            }
            let response;
            try {
                response = await fetch(`${this.c.baseUrl}/v1/chat/completions`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(body),
                    signal,
                });
            }
            catch (error) {
                if (signal.aborted) {
                    throw new LlmError('Ollama request aborted by caller', 'ABORTED', { cause: error });
                }
                throw new LlmError(`Ollama request to ${this.c.baseUrl} failed`, 'TRANSPORT', {
                    cause: error,
                });
            }
            if (!response.ok) {
                let message = `Ollama API error (HTTP ${response.status})`;
                let providerError;
                try {
                    providerError = (await response.json()).error;
                    if (providerError?.message)
                        message = providerError.message;
                }
                catch { /* 错误体不是 JSON 时保留默认信息 */ }
                throw new LlmError(message, httpErrorCode(response.status), {
                    status: response.status,
                });
            }
            if (!response.body) {
                throw new LlmError('Ollama API returned no response body', 'EMPTY_RESPONSE');
            }
            try {
                yield* translate(parseSse(response.body));
            }
            catch (error) {
                if (options.signal?.aborted) {
                    throw new LlmError('Ollama request aborted by caller', 'ABORTED', { cause: error });
                }
                throw error;
            }
        }
        finally {
            consumer.abort('Ollama stream consumer stopped');
        }
    }
}
//# sourceMappingURL=adapter.js.map