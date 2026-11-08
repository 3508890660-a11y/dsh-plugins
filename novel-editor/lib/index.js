import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import z from '@deepseek-ai/schemastery';
import { MiniStore } from './store.js';
import { EditorEngine } from './editor.js';
import { buildTools } from './tools.js';
export const name = '@dsh-external/novel-editor';
export const inject = ['tools', 'llm'];
export const Config = z.object({
    dataDir: z.string().default(''),
    editorProvider: z.string().default('ollama'),
    editorModel: z.string().default('novel-editor'),
    temperature: z.number().min(0).max(2).default(0.3),
    maxTokens: z.number().min(256).max(65536).default(8192),
    maxChars: z.number().min(1000).max(40000).default(8000),
    fallbackToSession: z.boolean().default(true),
    ollamaUrl: z.string().default('http://127.0.0.1:11434'),
});
/** 数据目录解析：config -> NOVEL_DATA_DIR env -> 插件工作目录（realpath 推导）-> DSH_HOME 兜底（与 dsh-novel-writer resolveDataDir 同规则） */
function resolveDataDir(configDataDir) {
    if (configDataDir)
        return configDataDir;
    const envDir = process.env.NOVEL_DATA_DIR;
    if (envDir)
        return envDir;
    try {
        const here = dirname(fileURLToPath(import.meta.url));
        const pkgRoot = realpathSync(join(here, '..'));
        return join(dirname(pkgRoot), 'novel-writer-data');
    }
    catch { /* realpath 失败（非 junction/拷贝部署）走兜底 */ }
    return join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'novel-writer-data');
}
export function apply(ctx, config) {
    const dataDir = resolveDataDir(config.dataDir);
    mkdirSync(dataDir, { recursive: true });
    const store = new MiniStore(dataDir);
    const editor = new EditorEngine(ctx, {
        provider: config.editorProvider,
        model: config.editorModel,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        maxChars: config.maxChars,
        fallbackToSession: config.fallbackToSession,
    });
    // 观察主会话模型路由（waterfall 必须 next() 委托）：本地编辑模型离线时回退用当前会话模型。
    ctx.on('llm/stream', (options, next) => {
        editor.setSessionRoute({ provider: options.provider, model: options.model });
        return next();
    });
    const disposers = [];
    for (const tool of buildTools({ editor, store, dataDir, ollamaUrl: config.ollamaUrl })) {
        // 同名工具冲突护栏：已被其它插件注册则跳过（避免 apply 抛错）
        if (ctx.tools.get(tool.name))
            continue;
        disposers.push(ctx.tools.register(tool));
    }
    ctx.effect(() => () => {
        for (const d of disposers.splice(0)) {
            try {
                d();
            }
            catch { /* 卸载容错 */ }
        }
    });
    ctx.logger?.info?.(`[${name}] 本地小说编辑引擎就绪（模型: ${config.editorProvider}/${config.editorModel}，数据目录: ${dataDir}，工具 ${disposers.length} 已注册）`);
}
//# sourceMappingURL=index.js.map