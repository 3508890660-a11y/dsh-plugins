/**
 * @dsh-external/dsh-novel-writer - 自动化长篇小说写作系统（DSH 插件）。
 *
 * 模型层：复用 DSH 模型服务（ctx.llm.stream，捕获主会话路由），可经 Config 覆盖 provider/model。
 * 故事管理：结构化大纲（卷/章/情节拍）+ 伏笔 + 人物档案 + 世界观，全部持久化。
 * 记忆引擎：每章生成后自动提取摘要/事件/人物变化/伏笔变化并更新状态；生成新章自动拼接。
 * 工具链：novel_* 系列 15 个工具（ctx.tools.register）。
 * UI：conversation.view 面板（client/index.ts，经 /@dsh-external/dsh-novel-writer/api 拉数据）。
 */
import type { Context } from '@deepseek-ai/cordis';
import type LlmService from '@deepseek-ai/dsh-llm';
import type { WebServer } from '@deepseek-ai/dsh-host-webserver';
import z from '@deepseek-ai/schemastery';
type AppContext = Context & {
    llm: LlmService;
    webServer: WebServer;
};
export declare const name = "@dsh-external/dsh-novel-writer";
export declare const inject: string[];
export interface Config {
    /**
     * 数据目录（空=自动解析，优先级：NOVEL_DATA_DIR env -> 插件真实所在的工作目录/novel-writer-data -> DSH_HOME 兜底）。
     * 插件经 junction 链接加载时，realpath 解析到源码目录（本部署位于 F:\producing\tool\writer），
     * 数据默认落在工作目录下，避免占用 C 盘。
     */
    dataDir: string;
    /** 显式模型路由（空=跟随主会话捕获的路由；默认指向本地 ollama / novel-lora-qwen3-32k，32k 上下文防长文截断） */
    provider: string;
    model: string;
    /** 润色专用模型路由（默认 ollama/novel-polish-qwen3-32k，独立于写作路由） */
    polishProvider: string;
    polishModel: string;
    temperature: number;
    maxTokens: number;
    /** 设定导入：超过此字符数启用分块解析（默认 20000） */
    importLongThreshold: number;
    /** 设定导入：分块解析每块字符数（默认 15000） */
    importChunkChars: number;
    /** 设定导入：分块解析使用的云端大模型 provider（默认 deepseek-official，不可用则回退当前路由） */
    importCloudProvider: string;
    /** 设定导入：分块解析使用的云端大模型 model */
    importCloudModel: string;
    /** 地图插件（dsh-map-forge）数据目录（空=自动解析：MAPFORGE_DATA_DIR env -> 工作区 map/dsh-map-forge/out/mapforge-data） */
    mapForgeDataDir: string;
    /** 文风知识库根目录（含 cards/ 子目录；空=自动解析：STYLE_KB_DIR env -> 插件工作目录/style-kb） */
    styleKbDir: string;
}
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    dataDir: z<string, string, "defined">;
    provider: z<string, string, "defined">;
    model: z<string, string, "defined">;
    polishProvider: z<string, string, "defined">;
    polishModel: z<string, string, "defined">;
    temperature: z<number, number, "defined">;
    maxTokens: z<number, number, "defined">;
    importLongThreshold: z<number, number, "defined">;
    importChunkChars: z<number, number, "defined">;
    importCloudProvider: z<string, string, "defined">;
    importCloudModel: z<string, string, "defined">;
    mapForgeDataDir: z<string, string, "defined">;
    styleKbDir: z<string, string, "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    dataDir: z<string, string, "defined">;
    provider: z<string, string, "defined">;
    model: z<string, string, "defined">;
    polishProvider: z<string, string, "defined">;
    polishModel: z<string, string, "defined">;
    temperature: z<number, number, "defined">;
    maxTokens: z<number, number, "defined">;
    importLongThreshold: z<number, number, "defined">;
    importChunkChars: z<number, number, "defined">;
    importCloudProvider: z<string, string, "defined">;
    importCloudModel: z<string, string, "defined">;
    mapForgeDataDir: z<string, string, "defined">;
    styleKbDir: z<string, string, "defined">;
}>>, "plain">;
export declare function apply(ctx: AppContext, config: Config): void;
export {};
