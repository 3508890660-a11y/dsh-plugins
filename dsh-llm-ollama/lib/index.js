import z from '@deepseek-ai/schemastery';
import { OllamaAdapter } from './adapter.js';
export const name = '@dsh-external/dsh-llm-ollama';
export const inject = ['llm'];
export const Config = z.object({
    baseUrl: z.string().default('http://127.0.0.1:11434'),
    apiKey: z.string().default(''),
    contextWindow: z.number().default(32768),
    maxTokens: z.number().default(8192),
});
/** 设置命名空间（模型设置页的 section 归属）。DSH 1.0.3+ 起为普通字符串。 */
const NS = 'llm-ollama';
export function apply(ctx, config) {
    // 配置以 getter 交给 adapter。设置页保存后内核重载 profile（app-boot/config-reload），
    // 本条目重新 apply，闭包捕获到的就是新的 config —— 因此不需要旧的 setSource 间接层。
    const adapter = new OllamaAdapter(() => config);
    const registration = ctx.llm.registerAdapter(['ollama'], adapter);
    // 声明为可配置 provider → UI 模型选择器/模型设置页可见
    ctx.llm.registerConfigurableProviders([{
            provider: 'ollama',
            displayName: 'Ollama 本地',
            settingsNs: NS,
            settingsPath: [],
        }]);
    ctx.effect(() => () => {
        try {
            registration();
        }
        catch { /* 卸载容错 */ }
    });
    ctx.logger?.info?.(`[dsh-llm-ollama] provider 'ollama' configurable (baseUrl=${config.baseUrl}, contextWindow=${config.contextWindow})`);
}
//# sourceMappingURL=index.js.map