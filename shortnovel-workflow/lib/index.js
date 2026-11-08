import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import z from '@deepseek-ai/schemastery';
import { ShortNovelStore } from './store.js';
import { WorkflowGenerator } from './generator.js';
import { StyleKb } from './style-kb.js';
import { buildTools } from './tools.js';
export const name = '@dsh-external/shortnovel-workflow';
export const inject = ['tools', 'llm'];
export const Config = z.object({
    dataDir: z.string().default(''),
    provider: z.string().default(''),
    model: z.string().default(''),
    temperature: z.number().min(0).max(2).default(0.8),
    maxTokens: z.number().min(256).max(65536).default(8192),
    reasoningEffort: z.string().default('off'),
    targetChars: z.number().min(5000).max(100000).default(15000),
    styleKbDir: z.string().default(''),
});
/** 数据目录解析：config -> SHORTNOVEL_DATA_DIR env -> 插件工作目录（realpath 推导）-> DSH_HOME 兜底 */
function resolveDataDir(configDataDir) {
    if (configDataDir)
        return configDataDir;
    const envDir = process.env.SHORTNOVEL_DATA_DIR;
    if (envDir)
        return envDir;
    try {
        const here = dirname(fileURLToPath(import.meta.url));
        const pkgRoot = realpathSync(join(here, '..'));
        return join(dirname(pkgRoot), 'shortnovel-data');
    }
    catch { /* realpath 失败（非 junction/拷贝部署）走兜底 */ }
    return join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'shortnovel-data');
}
/** 文风知识库根目录解析：config -> STYLE_KB_DIR env -> 插件工作目录 + style-kb */
function resolveStyleKbDir(configStyleKbDir) {
    if (configStyleKbDir)
        return configStyleKbDir;
    const envDir = process.env.STYLE_KB_DIR;
    if (envDir)
        return envDir;
    try {
        const here = dirname(fileURLToPath(import.meta.url));
        const pkgRoot = realpathSync(join(here, '..'));
        return join(dirname(pkgRoot), 'style-kb');
    }
    catch { /* 兜底 */ }
    return join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'style-kb');
}
export function apply(ctx, config) {
    // 数据目录解析（C 盘紧张：默认落在工作目录）
    const dataDir = resolveDataDir(config.dataDir);
    mkdirSync(dataDir, { recursive: true });
    // 文风知识库（文风卡/手法卡）适配
    const styleKb = new StyleKb(resolveStyleKbDir(config.styleKbDir));
    const store = new ShortNovelStore(dataDir);
    const generator = new WorkflowGenerator(ctx, {
        provider: config.provider || undefined,
        model: config.model || undefined,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        reasoningEffort: config.reasoningEffort,
        styleKb,
    });
    // 观察主会话模型路由（waterfall 必须 next() 委托）--复用 DSH 模型服务的关键
    ctx.on('llm/stream', (options, next) => {
        generator.lastSessionRoute = { provider: options.provider, model: options.model };
        return next();
    });
    // 注册 shortnovel_* 工具链
    const disposers = [];
    for (const tool of buildTools({ store, generator, dataDir })) {
        // 同名工具冲突护栏：若某工具名已被其它插件注册，本插件跳过该条以避免 apply 抛错
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
    ctx.logger?.info?.(`[${name}] 墨安式爆款短篇创作工作流就绪（数据目录: ${dataDir}，文风知识库: ${styleKb.available ? styleKb.rootDir : '不可达(未注入文风卡)'}，工具 ${disposers.length} 已注册）`);
}
//# sourceMappingURL=index.js.map