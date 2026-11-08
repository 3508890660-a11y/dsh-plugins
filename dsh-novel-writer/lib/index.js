import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync, realpathSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import z from '@deepseek-ai/schemastery';
import { Store } from './store.js';
import { Generator } from './generator.js';
import { buildTools } from './tools.js';
import { registerRoutes } from './routes.js';
export const name = '@dsh-external/dsh-novel-writer';
export const inject = ['tools', 'llm', 'webServer'];
export const Config = z.object({
    dataDir: z.string().default(''),
    provider: z.string().default('ollama'),
    model: z.string().default('novel-lora-qwen3-32k'),
    polishProvider: z.string().default('ollama'),
    polishModel: z.string().default('novel-polish-qwen3-32k'),
    temperature: z.number().min(0).max(2).default(0.8),
    maxTokens: z.number().min(256).max(65536).default(8192),
    importLongThreshold: z.number().min(4000).max(100000).default(20000),
    importChunkChars: z.number().min(4000).max(40000).default(15000),
    importCloudProvider: z.string().default('deepseek-official'),
    importCloudModel: z.string().default('deepseek-v4-flash'),
    mapForgeDataDir: z.string().default(''),
    styleKbDir: z.string().default(''),
});
/** 数据目录解析：config -> NOVEL_DATA_DIR env -> 插件工作目录（realpath 推导）-> DSH_HOME 兜底 */
function resolveDataDir(configDataDir) {
    if (configDataDir)
        return configDataDir;
    const envDir = process.env.NOVEL_DATA_DIR;
    if (envDir)
        return envDir;
    try {
        // __dirname 推导（ESM）：lib/ -> 包根 -> 包根上级 = 工作目录
        const here = dirname(fileURLToPath(import.meta.url));
        const pkgRoot = realpathSync(join(here, '..'));
        return join(dirname(pkgRoot), 'novel-writer-data');
    }
    catch { /* realpath 失败（非 junction/拷贝部署）走兜底 */ }
    return join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'novel-writer-data');
}
/** 文风知识库根目录：config -> STYLE_KB_DIR env -> 插件工作目录（realpath 推导）+ style-kb */
function resolveStyleKbDir(configDir) {
    if (configDir)
        return configDir;
    const envDir = process.env.STYLE_KB_DIR;
    if (envDir)
        return envDir;
    try {
        const here = dirname(fileURLToPath(import.meta.url));
        const pkgRoot = realpathSync(join(here, '..'));
        return join(dirname(pkgRoot), 'style-kb');
    }
    catch { /* realpath 失败走兜底 */ }
    return '';
}
/** 地图插件数据目录：config -> MAPFORGE_DATA_DIR env -> 工作区 map/dsh-map-forge/out/mapforge-data 启发式 -> 空（不可达） */
function resolveMapForgeDataDir(configDir) {
    if (configDir)
        return configDir;
    const envDir = process.env.MAPFORGE_DATA_DIR;
    if (envDir)
        return envDir;
    try {
        // 工作区布局：writer/novel-writer-data 的同级 map/dsh-map-forge（F:\producing\tool\map）
        const here = dirname(fileURLToPath(import.meta.url));
        const pkgRoot = realpathSync(join(here, '..'));
        const workspace = dirname(dirname(pkgRoot)); // writer -> F:\producing\tool
        const candidate = join(workspace, 'map', 'dsh-map-forge', 'out', 'mapforge-data');
        if (existsSync(join(candidate, 'maps.json')))
            return candidate;
    }
    catch { /* realpath 失败走兜底 */ }
    return '';
}
export function apply(ctx, config) {
    // 数据目录解析（C 盘紧张：默认落在工作目录）
    const dataDir = resolveDataDir(config.dataDir);
    mkdirSync(dataDir, { recursive: true });
    // 文风知识库目录（含 cards/，缺则写作不注入文风卡）
    const styleKbDir = resolveStyleKbDir(config.styleKbDir);
    const store = new Store(dataDir);
    const generator = new Generator(ctx, {
        provider: config.provider || undefined,
        model: config.model || undefined,
        polishProvider: config.polishProvider || undefined,
        polishModel: config.polishModel || undefined,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        importLongThreshold: config.importLongThreshold,
        importChunkChars: config.importChunkChars,
        importCloudProvider: config.importCloudProvider,
        importCloudModel: config.importCloudModel,
        styleKbDir,
    });
    // 观察主会话模型路由（waterfall 必须 next() 委托）--复用 DSH 模型服务的关键
    ctx.on('llm/stream', (options, next) => {
        generator.lastSessionRoute = { provider: options.provider, model: options.model };
        return next();
    });
    // 注册 novel_* 工具链
    const disposers = [];
    const mapForgeDataDir = resolveMapForgeDataDir(config.mapForgeDataDir);
    for (const tool of buildTools({ store, generator, dataDir, mapForgeDataDir, styleKbDir })) {
        // 同名工具冲突护栏：若某工具名已被其它插件（如旧版 dsh-novel-writer）注册，
        // 本插件跳过该条以避免 apply 抛错（工具注册对重名直接报错）。新版更完整，
        // 旧版退场后（重启生效）本插件将独占全部 novel_* 名。
        if (ctx.tools.get(tool.name))
            continue;
        disposers.push(ctx.tools.register(tool));
    }
    // 注册 HTTP API（UI 面板数据源）
    disposers.push(registerRoutes(route => ctx.webServer.register(route), { store, generator, dataDir, styleKbDir }));
    ctx.effect(() => () => {
        for (const d of disposers.splice(0)) {
            try {
                d();
            }
            catch { /* 卸载容错 */ }
        }
    });
    ctx.logger?.info?.(`[${name}] 长篇小说写作系统就绪（数据目录: ${dataDir}，工具 ${disposers.length} 已注册）`);
}
//# sourceMappingURL=index.js.map