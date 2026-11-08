/**
 * @dsh-external/shortnovel-workflow - 墨安式爆款短篇创作工作流（DSH 插件）。
 *
 * 工作流：主题/脑洞 -> 脑洞(5个) -> 导语(5条爆款导语) -> 大纲(10章×10剧情点, 按题材公式)
 * -> 正文(强去AI味, 一句一行, ~1.2万字) -> 审稿(付费点+修改方案+改后全文)。
 * 严格分步：每阶段生成内容后由 AI 助手询问用户是否满意；满意 advance 推进，不满意 revise 重生成。
 * 模型层：复用 DSH 模型服务（ctx.llm.stream，捕获主会话路由），可经 Config 覆盖 provider/model。
 * 文风卡：可经 `shortnovel_style_kb` 给项目绑定/启用 style-kb 文风卡，生成时自动注入各阶段。
 * 工具链：shortnovel_* 系列 8 个工具（start/generate/advance/revise/status/list/delete/style_kb）。
 */
import type { Context } from '@deepseek-ai/cordis';
import type LlmService from '@deepseek-ai/dsh-llm';
import z from '@deepseek-ai/schemastery';
type AppContext = Context & {
    llm: LlmService;
};
export declare const name = "@dsh-external/shortnovel-workflow";
export declare const inject: string[];
export interface Config {
    /** 数据目录（空=自动解析，优先级：SHORTNOVEL_DATA_DIR env -> 插件工作目录/shortnovel-data -> DSH_HOME 兜底） */
    dataDir: string;
    /** 显式模型路由（空=跟随主会话捕获的路由） */
    provider: string;
    model: string;
    temperature: number;
    maxTokens: number;
    /** 思考档位（默认 off=关闭思考）。若当前路由模型不支持，会自动降级为省略该参数。 */
    reasoningEffort: string;
    /** 目标字数（每个新项目的默认目标） */
    targetChars: number;
    /** 文风知识库根目录（含 cards/ 子目录；空=自动解析：STYLE_KB_DIR env -> 插件工作目录 + style-kb） */
    styleKbDir: string;
}
export declare const Config: z<Schemastery.ObjectS<{
    dataDir: z<string, string>;
    provider: z<string, string>;
    model: z<string, string>;
    temperature: z<number, number>;
    maxTokens: z<number, number>;
    reasoningEffort: z<string, string>;
    targetChars: z<number, number>;
    styleKbDir: z<string, string>;
}>, Schemastery.ObjectT<{
    dataDir: z<string, string>;
    provider: z<string, string>;
    model: z<string, string>;
    temperature: z<number, number>;
    maxTokens: z<number, number>;
    reasoningEffort: z<string, string>;
    targetChars: z<number, number>;
    styleKbDir: z<string, string>;
}>>;
export declare function apply(ctx: AppContext, config: Config): void;
export {};
